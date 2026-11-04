using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Folio.Api.Tests;

/// <summary>
/// Demo data over HTTP: a request for a budget, and the budget it leaves behind.
///
/// A class of its own because it writes six collections and then counts them, and one
/// fixture per class is one database per class.
/// </summary>
public sealed class DemoApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Country = "demo";

    private static object Quarterly(string persona = "balanced") => new
    {
        persona,
        startYear = 2025,
        startMonth = 1,
        endYear = 2025,
        endMonth = 3,
        monthlyIncome = 3000,
        includeSavingsGoals = true,
        includeFinance = true,
    };

    [DatabaseFact]
    public async Task A_demo_budget_is_written_and_read_back_as_one_workspace()
    {
        var client = await factory.CreateSignedInClientAsync();

        var summary = await PostAsync(client, Quarterly());
        var workspace = await client.GetFromJsonAsync<JsonElement>($"/api/folio/workspace?country={Country}");

        Assert.Equal(summary.GetProperty("accountsCreated").GetInt32(), workspace.GetProperty("folio_accounts").GetProperty("accounts").GetArrayLength());
        Assert.Equal(summary.GetProperty("transactionsAdded").GetInt32(), workspace.GetProperty("folio_transactions").GetProperty("transactions").GetArrayLength());
        Assert.Equal(3, summary.GetProperty("budgetMonths").GetInt32());
        Assert.Equal(2, summary.GetProperty("goalsCreated").GetInt32());
        Assert.Equal(1, summary.GetProperty("loansCreated").GetInt32());
        Assert.Equal(1, summary.GetProperty("financeSavingsCreated").GetInt32());

        // The template and the months came with it, and the counters are past what was written.
        Assert.Equal(13, workspace.GetProperty("folio_template").GetProperty("entries").GetArrayLength());
        Assert.True(workspace.GetProperty("folio_budget").GetProperty("monthlyEntries").TryGetProperty("2025", out _));
        Assert.True(workspace.GetProperty("folio_transactions").GetProperty("nextId").GetInt32() > summary.GetProperty("transactionsAdded").GetInt32());
    }

    [DatabaseFact]
    public async Task Asking_twice_replaces_the_budget_rather_than_doubling_it()
    {
        var client = await factory.CreateSignedInClientAsync();

        var first = await PostAsync(client, Quarterly());
        var second = await PostAsync(client, Quarterly("saver"));

        var workspace = await client.GetFromJsonAsync<JsonElement>($"/api/folio/workspace?country={Country}");

        Assert.Equal(second.GetProperty("accountsCreated").GetInt32(), workspace.GetProperty("folio_accounts").GetProperty("accounts").GetArrayLength());
        Assert.Equal(second.GetProperty("transactionsAdded").GetInt32(), workspace.GetProperty("folio_transactions").GetProperty("transactions").GetArrayLength());
        Assert.NotEqual(first.GetProperty("accountsCreated").GetInt32(), second.GetProperty("accountsCreated").GetInt32());
    }

    [DatabaseFact]
    public async Task An_impossible_request_is_refused_in_the_APIs_own_words()
    {
        var client = await factory.CreateSignedInClientAsync();

        var refused = await client.PostAsJsonAsync(
            $"/api/folio/demo?country={Country}",
            new
            {
                persona = "balanced",
                startYear = 2025,
                startMonth = 1,
                endYear = 2025,
                endMonth = 3,
                monthlyIncome = 10,
                includeSavingsGoals = true,
                includeFinance = true,
            });

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        var body = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("monthly income", body.GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [DatabaseFact]
    public async Task Without_a_country_there_is_nothing_to_fill()
    {
        var client = await factory.CreateSignedInClientAsync();

        var refused = await client.PostAsJsonAsync("/api/folio/demo", Quarterly());

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    }

    private static async Task<JsonElement> PostAsync(HttpClient client, object request)
    {
        var response = await client.PostAsJsonAsync($"/api/folio/demo?country={Country}", request);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
