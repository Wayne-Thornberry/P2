using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Folio.Api.Tests;

/// <summary>
/// The folio module over HTTP, against a database built from the model scripts.
///
/// What is being proved is the round trip: a collection the site writes comes back as the
/// same collection, in the same order, with its id counter -- and only for the country it
/// was written for.
/// </summary>
public sealed class FolioApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Country = "ireland";

    private static string Workspace(string country = Country) => $"/api/folio/workspace?country={country}";

    [DatabaseFact]
    public async Task A_country_that_has_never_been_used_answers_with_nothing_saved()
    {
        var client = await factory.CreateSignedInClientAsync();

        var response = await client.GetAsync(Workspace("nowhere"));

        response.EnsureSuccessStatusCode();

        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        // Every collection is absent rather than empty: the site supplies its own
        // first-run defaults, and an empty object would take them away.
        Assert.Empty(body.RootElement.EnumerateObject());
    }

    [DatabaseFact]
    public async Task Transactions_are_saved_and_come_back_in_order()
    {
        var client = await factory.CreateSignedInClientAsync();

        var saved = new
        {
            transactions = new object[]
            {
                new
                {
                    id = 501,
                    name = "Groceries",
                    date = "2026-01-04",
                    createdAt = "2026-01-04T10:00:00.000Z",
                    amount = 42.35m,
                    type = "out",
                    itemId = 3,
                    accountId = "acc-1",
                    notes = "Weekly shop",
                    locked = false,
                },
                new
                {
                    id = 502,
                    name = "Salary",
                    date = "2026-01-01",
                    createdAt = "2026-01-01T08:30:00.000Z",
                    amount = 3200m,
                    type = "in",
                    itemId = (int?)null,
                    accountId = "acc-1",
                },
            },
            nextId = 503,
        };

        var put = await client.PutAsJsonAsync($"/api/folio/transactions?country={Country}", saved);
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var workspace = await client.GetFromJsonAsync<JsonElement>(Workspace());

        var transactions = workspace.GetProperty("folio_transactions");
        Assert.Equal(503, transactions.GetProperty("nextId").GetInt32());

        var rows = transactions.GetProperty("transactions").EnumerateArray().ToList();
        Assert.Equal(new[] { 501, 502 }, rows.Select(row => row.GetProperty("id").GetInt32()));
        Assert.Equal("Groceries", rows[0].GetProperty("name").GetString());
        Assert.Equal("2026-01-04", rows[0].GetProperty("date").GetString());
        Assert.Equal(42.35m, rows[0].GetProperty("amount").GetDecimal());
        Assert.Equal("2026-01-04T10:00:00Z", rows[0].GetProperty("createdAt").GetDateTime().ToString("yyyy-MM-ddTHH:mm:ssZ"));

        // An item that was never assigned is absent, not zero.
        Assert.False(rows[1].TryGetProperty("itemId", out _));
    }

    [DatabaseFact]
    public async Task Saving_a_collection_again_replaces_what_was_there()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync($"/api/folio/accounts?country={Country}", new
        {
            accounts = new[] { new { id = "acc-1", name = "Current", type = "asset" } },
            nextId = 2,
        });

        await client.PutAsJsonAsync($"/api/folio/accounts?country={Country}", new
        {
            accounts = new[] { new { id = "acc-9", name = "Renamed", type = "liability" } },
            nextId = 10,
        });

        var workspace = await client.GetFromJsonAsync<JsonElement>(Workspace());

        var accounts = workspace.GetProperty("folio_accounts").GetProperty("accounts").EnumerateArray().ToList();
        Assert.Equal("acc-9", Assert.Single(accounts).GetProperty("id").GetString());
        Assert.Equal(10, workspace.GetProperty("folio_accounts").GetProperty("nextId").GetInt32());
    }

    [DatabaseFact]
    public async Task Two_countries_do_not_see_each_others_data()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync("/api/folio/transactions?country=ireland", new
        {
            transactions = new[] { new { id = 1, name = "One", date = "2026-01-01", createdAt = "2026-01-01T00:00:00Z", amount = 1m, type = "out" } },
        });

        var other = await client.GetFromJsonAsync<JsonElement>(Workspace("france"));

        Assert.False(other.TryGetProperty("folio_transactions", out _));
    }

    [DatabaseFact]
    public async Task The_budget_keeps_its_months()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync($"/api/folio/budget?country={Country}", new
        {
            globalItems = new[] { new { id = 1, name = "Groceries" }, new { id = 2, name = "Rent" } },
            monthlyEntries = new Dictionary<string, Dictionary<string, object[]>>
            {
                ["2026"] = new()
                {
                    ["1"] = [new { itemId = 1, assigned = 300m, category = "Living" }],
                    ["2"] = [new { itemId = 1, assigned = 320m, category = "Living" }, new { itemId = 2, assigned = 1200m, category = "Home" }],
                },
            },
            nextId = 3,
        });

        var workspace = await client.GetFromJsonAsync<JsonElement>(Workspace());
        var budget = workspace.GetProperty("folio_budget");

        Assert.Equal(3, budget.GetProperty("nextId").GetInt32());
        Assert.Equal(2, budget.GetProperty("globalItems").GetArrayLength());
        Assert.Equal(2, budget.GetProperty("monthlyEntries").GetProperty("2026").GetProperty("2").GetArrayLength());
        Assert.Equal(1200m, budget.GetProperty("monthlyEntries").GetProperty("2026").GetProperty("2")[1].GetProperty("assigned").GetDecimal());
    }

    [DatabaseFact]
    public async Task Settings_are_saved_without_knowing_a_country()
    {
        var client = await factory.CreateSignedInClientAsync();

        var settings = new
        {
            theme = "light",
            locale = "en-IE",
            currency = "EUR",
            dateStyle = "medium",
            timeStyle = "24h",
            country = Country,
            billableMonthStart = 25,
            balanceCutoffTxId = 12,
        };

        var put = await client.PutAsJsonAsync("/api/folio/settings", settings);
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var saved = await client.GetFromJsonAsync<JsonElement>("/api/folio/settings");

        Assert.Equal("light", saved.GetProperty("theme").GetString());
        Assert.Equal("ireland", saved.GetProperty("country").GetString());
        Assert.Equal(25, saved.GetProperty("billableMonthStart").GetInt32());
        Assert.Equal(12, saved.GetProperty("balanceCutoffTxId").GetInt32());
    }

    [DatabaseFact]
    public async Task Deleting_a_workspace_leaves_nothing_behind()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync($"/api/folio/accounts?country={Country}", new
        {
            accounts = new[] { new { id = "acc-1", name = "Current", type = "asset" } },
        });

        var deleted = await client.DeleteAsync(Workspace());
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);

        var workspace = await client.GetFromJsonAsync<JsonElement>(Workspace());

        Assert.Empty(workspace.EnumerateObject());
    }

    [DatabaseFact]
    public async Task The_countries_that_have_data_are_listed_once_each()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync("/api/folio/accounts?country=ireland", new
        {
            accounts = new[] { new { id = "acc-1", name = "Current" } },
            nextId = 2,
        });

        await client.PutAsJsonAsync("/api/folio/accounts?country=norway", new
        {
            accounts = new[] { new { id = "acc-2", name = "Current" } },
            nextId = 3,
        });

        // Ireland is written again, and must not appear twice.
        await client.PutAsJsonAsync("/api/folio/accounts?country=ireland", new
        {
            accounts = new[] { new { id = "acc-1", name = "Current" } },
            nextId = 2,
        });

        var countries = await client.GetFromJsonAsync<List<string>>("/api/folio/countries");

        Assert.Contains("ireland", countries!);
        Assert.Contains("norway", countries!);
        Assert.Equal(countries!.Distinct(StringComparer.Ordinal).Count(), countries!.Count);
    }

    [DatabaseFact]
    public async Task A_country_is_required()
    {
        var client = await factory.CreateSignedInClientAsync();

        var response = await client.GetAsync("/api/folio/workspace");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [DatabaseFact]
    public async Task Two_countries_can_be_written_at_once()
    {
        var client = await factory.CreateSignedInClientAsync();

        await client.PutAsJsonAsync("/api/folio/accounts?country=ireland", new
        {
            accounts = new[] { new { id = "acc-1", name = "Current" } },
        });

        await client.PutAsJsonAsync("/api/folio/accounts?country=sweden", new
        {
            accounts = new[] { new { id = "acc-1", name = "Swedish account" } },
        });

        var irish = await client.GetFromJsonAsync<JsonElement>(Workspace("ireland"));
        var swedish = await client.GetFromJsonAsync<JsonElement>(Workspace("sweden"));

        Assert.Equal("Current", irish.GetProperty("folio_accounts").GetProperty("accounts")[0].GetProperty("name").GetString());
        Assert.Equal("Swedish account", swedish.GetProperty("folio_accounts").GetProperty("accounts")[0].GetProperty("name").GetString());
    }
}
