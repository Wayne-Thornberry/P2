using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Folio.Api.Ai;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Folio.Api.Tests;

/// <summary>The AI as a page without a key sees it: no button, and a plain refusal.</summary>
public sealed class AiOffApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Country = "ireland";
    [DatabaseFact]
    public async Task Nothing_offers_the_ai_until_a_key_is_configured()
    {
        var client = await factory.CreateSignedInClientAsync();

        var status = await client.GetFromJsonAsync<JsonElement>("/api/folio/ai");
        var analysis = await client.PostAsJsonAsync($"/api/folio/analysis?country={Country}", new { months = 12 });
        var categories = await client.PostAsJsonAsync($"/api/folio/categorise?country={Country}", new
        {
            transactions = new[] { new { id = 1, name = "Tesco", notes = "", amount = 10m, type = "out", date = "2026-02-01" } },
        });

        Assert.False(status.GetProperty("available").GetBoolean());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, analysis.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, categories.StatusCode);
    }

    [DatabaseFact]
    public async Task The_ai_is_behind_the_sign_in_like_everything_else()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/folio/ai")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsJsonAsync(
            "/api/folio/analysis", new { months = 12 })).StatusCode);
    }
}

/// <summary>An API with a key, and a DeepSeek that answers from a string in the test.</summary>
public sealed class AiFactory : ApiFactory
{
    public FakeDeepSeek DeepSeek { get; } = new();

    protected override void ConfigureSettings(IWebHostBuilder builder)
    {
        builder.UseSetting("Ai:DeepSeek:ApiKey", "test-key");
        builder.UseSetting("Ai:DeepSeek:BaseUrl", "https://ai.test");

        builder.ConfigureTestServices(services =>
            services.AddHttpClient<DeepSeekClient>()
                .ConfigurePrimaryHttpMessageHandler(() => DeepSeek));
    }
}

/// <summary>
/// Stands in for DeepSeek: it remembers the request, and answers with whatever the test
/// put in <see cref="Answer"/>.
/// </summary>
public sealed class FakeDeepSeek : HttpMessageHandler
{
    /// <summary>A report with every part filled in, which is what a good answer looks like.</summary>
    public const string GoodReport = """
        {
          "headline": "Groceries is the biggest line at 42% of spending.",
          "summary": "Money out ran ahead of money in over the period, leaving a small deficit.",
          "findings": [
            { "title": "Groceries dominates", "detail": "Twelve shops came to 420.00 EUR.", "severity": "high" },
            { "title": "One heavy month", "detail": "February was the peak at 300.00 EUR.", "severity": "medium" }
          ],
          "patterns": [ "Most spending lands on a Saturday." ],
          "risks": [ "The deficit repeats if nothing changes." ],
          "actions": [ "Cap groceries at 400.00 EUR a month." ]
        }
        """;

    public const string GoodAssignment = """
        {
          "assignments": [
            { "id": 1, "item": "groceries", "new": false, "confidence": 0.94, "why": "supermarket" },
            { "id": 2, "item": "Subscriptions", "new": true, "confidence": 0.8, "why": "monthly streaming" }
          ],
          "newItems": [ "Subscriptions" ]
        }
        """;

    public HttpRequestMessage? Request { get; private set; }

    /// <summary>The request body, read while the request is still alive.</summary>
    public string? Body { get; private set; }

    /// <summary>The content of the chat completion this answers with.</summary>
    public string Answer { get; set; } = GoodReport;

    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;

    /// <summary>Back to a good day, before a test changes it.</summary>
    public void Reset()
    {
        Request = null;
        Body = null;
        Answer = GoodReport;
        Status = HttpStatusCode.OK;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        Request = request;
        Body = request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken);

        var completion = JsonSerializer.Serialize(new
        {
            choices = new[] { new { message = new { content = Answer } } },
        });

        return new HttpResponseMessage(Status)
        {
            Content = new StringContent(completion, Encoding.UTF8, "application/json"),
        };
    }
}

/// <summary>
/// The two AI features over HTTP. What is proved is the split: the numbers come from the
/// budget, the words come from the model, and an answer that cannot be read is refused
/// rather than half-applied.
/// </summary>
public sealed class AiApiTests(AiFactory factory) : IClassFixture<AiFactory>
{
    private const string Country = "ireland";

    [DatabaseFact]
    public async Task A_configured_box_says_which_model_would_write_the_report()
    {
        var client = await factory.CreateSignedInClientAsync();

        var status = await client.GetFromJsonAsync<JsonElement>("/api/folio/ai");

        Assert.True(status.GetProperty("available").GetBoolean());
        Assert.Equal("deepseek-flash", status.GetProperty("model").GetString());
    }

    [DatabaseFact]
    public async Task The_report_carries_the_budgets_own_numbers_and_the_models_words()
    {
        factory.DeepSeek.Reset();
        factory.DeepSeek.Answer = FakeDeepSeek.GoodReport;

        var client = await factory.CreateSignedInClientAsync();

        // Inside the window a report looks at, which is the last N months to today.
        var thisMonth = DateOnly.FromDateTime(DateTime.Now);
        var lastMonth = thisMonth.AddMonths(-1);

        await client.PutAsJsonAsync($"/api/folio/transactions?country={Country}", new
        {
            transactions = new object[]
            {
                Spending(1, "Tesco", lastMonth.ToString("yyyy-MM-dd"), 120m),
                Spending(2, "Tesco", thisMonth.ToString("yyyy-MM-dd"), 300m),
                new
                {
                    id = 3,
                    name = "Salary",
                    date = thisMonth.ToString("yyyy-MM-dd"),
                    createdAt = $"{thisMonth:yyyy-MM-dd}T08:00:00.000Z",
                    amount = 3000m,
                    type = "in",
                },
            },
            nextId = 4,
        });

        var response = await client.PostAsJsonAsync($"/api/folio/analysis?country={Country}", new { months = 2 });

        response.EnsureSuccessStatusCode();

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var facts = body.RootElement.GetProperty("facts");

        // The arithmetic is the API's: 420 out, 3000 in, and neither is something the
        // model was asked to work out.
        Assert.Equal(420m, facts.GetProperty("totals").GetProperty("out").GetDecimal());
        Assert.Equal(3000m, facts.GetProperty("totals").GetProperty("in").GetDecimal());
        Assert.Equal(3, facts.GetProperty("totals").GetProperty("transactions").GetInt32());
        Assert.Equal(2, body.RootElement.GetProperty("period").GetProperty("months").GetInt32());

        // The words are the model's, read back as the shape the page renders.
        var report = body.RootElement.GetProperty("report");
        Assert.Equal("Groceries is the biggest line at 42% of spending.", report.GetProperty("headline").GetString());
        Assert.Equal(2, report.GetProperty("findings").GetArrayLength());
        Assert.Equal("high", report.GetProperty("findings")[0].GetProperty("severity").GetString());

        // What was sent was the worked-out facts, not the rows: the model never sees a
        // createdAt, and it is given the merchant it is meant to talk about.
        Assert.Contains("Tesco", factory.DeepSeek.Body ?? "", StringComparison.Ordinal);
        Assert.DoesNotContain("createdAt", factory.DeepSeek.Body ?? "", StringComparison.Ordinal);
    }

    [DatabaseFact]
    public async Task An_answer_that_is_not_a_report_is_refused_rather_than_shown()
    {
        factory.DeepSeek.Reset();
        factory.DeepSeek.Answer = "I could not find anything interesting.";

        var client = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync($"/api/folio/analysis?country={Country}", new { months = 6 });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [DatabaseFact]
    public async Task A_model_that_answers_with_an_error_is_the_same_refusal()
    {
        factory.DeepSeek.Reset();
        factory.DeepSeek.Status = HttpStatusCode.TooManyRequests;

        var client = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync($"/api/folio/categorise?country={Country}", new
        {
            transactions = new[] { new { id = 1, name = "Tesco", notes = "", amount = 12.5m, type = "out", date = "2026-02-01" } },
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [DatabaseFact]
    public async Task Categorising_prefers_an_item_that_exists_and_allows_one_that_does_not()
    {
        factory.DeepSeek.Reset();
        factory.DeepSeek.Answer = FakeDeepSeek.GoodAssignment;

        var client = await factory.CreateSignedInClientAsync();

        // The budget the page would send: one item, spelled with a capital.
        var response = await client.PostAsJsonAsync($"/api/folio/categorise?country={Country}", new
        {
            transactions = new object[]
            {
                new { id = 1, name = "TESCO STORES 1234", notes = "", amount = 42.35m, type = "out", date = "2026-02-01" },
                new { id = 2, name = "NETFLIX.COM", notes = "", amount = 15.99m, type = "out", date = "2026-02-02" },
            },
            items = new object[] { new { id = 3201, name = "Groceries" } },
        });

        response.EnsureSuccessStatusCode();

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var assignments = body.RootElement.GetProperty("assignments");

        // "groceries" in the answer is "Groceries" in the budget: the same item, by its own
        // spelling and its own id.
        var first = assignments.EnumerateArray().First(row => row.GetProperty("transactionId").GetInt32() == 1);
        Assert.Equal(3201, first.GetProperty("itemId").GetInt32());
        Assert.Equal("Groceries", first.GetProperty("itemName").GetString());
        Assert.False(first.GetProperty("isNew").GetBoolean());

        // Nothing existing fits, so the second is a proposal with no id yet: the page adds
        // the item and assigns it, in one save.
        var second = assignments.EnumerateArray().First(row => row.GetProperty("transactionId").GetInt32() == 2);
        Assert.False(
            second.TryGetProperty("itemId", out var itemId) && itemId.ValueKind != JsonValueKind.Null,
            "a proposed new item has no id until the page adds it");
        Assert.Equal("Subscriptions", second.GetProperty("itemName").GetString());
        Assert.True(second.GetProperty("isNew").GetBoolean());

        Assert.Equal("Subscriptions", body.RootElement.GetProperty("newItems")[0].GetString());
    }

    [DatabaseFact]
    public async Task With_nothing_selected_the_api_picks_the_ones_nothing_has_categorised()
    {
        factory.DeepSeek.Reset();
        factory.DeepSeek.Answer = FakeDeepSeek.GoodAssignment;

        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync($"/api/folio/transactions?country={Country}", new
        {
            transactions = new object[]
            {
                new
                {
                    id = 11,
                    name = "Aldi",
                    date = "2026-03-01",
                    createdAt = "2026-03-01T10:00:00.000Z",
                    amount = 30m,
                    type = "out",
                    itemId = (int?)null,
                },
                new
                {
                    id = 12,
                    name = "Already sorted",
                    date = "2026-03-02",
                    createdAt = "2026-03-02T10:00:00.000Z",
                    amount = 10m,
                    type = "out",
                    itemId = 3201,
                },
            },
            nextId = 13,
        });

        var response = await client.PostAsJsonAsync($"/api/folio/categorise?country={Country}", new { });
        response.EnsureSuccessStatusCode();

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var considered = body.RootElement.GetProperty("considered").GetInt32();

        // One uncategorised transaction, not the two: the one that already has an item is
        // not asked about again.
        Assert.Equal(1, considered);
        Assert.Contains("Aldi", factory.DeepSeek.Body ?? "", StringComparison.Ordinal);
        Assert.DoesNotContain("Already sorted", factory.DeepSeek.Body ?? "", StringComparison.Ordinal);
    }

    private static object Spending(int id, string name, string date, decimal amount) => new
    {
        id,
        name,
        date,
        createdAt = $"{date}T10:00:00.000Z",
        amount,
        type = "out",
    };
}
