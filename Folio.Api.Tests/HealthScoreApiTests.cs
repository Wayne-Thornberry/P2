using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Folio.Api.Tests;

/// <summary>
/// The health score over HTTP, against a database of its own.
///
/// A class of its own rather than a test in FolioApiTests: the score depends on the
/// settings row, and another test in that class stores a billable month that starts on the
/// 25th. One fixture per class is one database per class, so nothing here is at the mercy
/// of what ran before it.
/// </summary>
public sealed class HealthScoreApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    /// <summary>
    /// The health score over HTTP: saved rows in, a worked-out score back.
    ///
    /// The months are built around today, because the score is about the months that have
    /// finished, and a fixed date would stop being one.
    /// </summary>
    [DatabaseFact]
    public async Task A_saved_budget_is_scored_by_the_api()
    {
        const string scored = "scotland";
        var client = factory.CreateClient();

        var thisMonth = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

        var transactions = Enumerable.Range(1, 3)
            .SelectMany(offset =>
            {
                var day = thisMonth.AddMonths(-offset).AddDays(9);
                var date = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

                return new object[]
                {
                    new { id = offset * 2, name = "Salary", date, createdAt = day, amount = 1000m, type = "in", itemId = (int?)null },
                    new { id = offset * 2 + 1, name = "Rent", date, createdAt = day, amount = 700m, type = "out", itemId = (int?)1 },
                };
            })
            .ToArray();

        await client.PutAsJsonAsync($"/api/folio/transactions?country={scored}", new { transactions, nextId = 10 });

        await client.PutAsJsonAsync($"/api/folio/budget?country={scored}", new
        {
            globalItems = new[] { new { id = 1, name = "Rent" } },
            monthlyEntries = new Dictionary<string, Dictionary<string, object[]>>
            {
                [DateTime.Today.Year.ToString()] = new()
                {
                    [DateTime.Today.Month.ToString()] = [new { itemId = 1, assigned = 1000m, category = "Housing" }],
                },
            },
            nextId = 2,
        });

        var report = await client.GetFromJsonAsync<JsonElement>($"/api/folio/health?country={scored}");

        Assert.Equal(1000m, report.GetProperty("rolling3").GetProperty("income").GetDecimal());
        Assert.Equal(700m, report.GetProperty("rolling3").GetProperty("expenses").GetDecimal());
        Assert.Equal(30, report.GetProperty("rolling3").GetProperty("savingsRate").GetInt32());
        // 900 saved across the three months, over 700 a month of spending.
        Assert.Equal(1.3m, report.GetProperty("reserveMonths").GetDecimal());
        Assert.Equal(1, report.GetProperty("budgetAdherence").GetProperty("total").GetInt32());
        Assert.Equal(0, report.GetProperty("budgetAdherence").GetProperty("over").GetInt32());
        Assert.Equal(3, report.GetProperty("incomeConsistency").GetInt32());

        // 35 for the savings rate, 12 for a reserve of a month and a bit, 20 for a budget
        // kept, 15 for three months of income.
        Assert.Equal(82, report.GetProperty("score").GetInt32());
        Assert.Equal("B", report.GetProperty("grade").GetProperty("letter").GetString());
    }

    [DatabaseFact]
    public async Task A_month_that_is_not_a_month_is_refused()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/folio/health?country=ireland&month=last-tuesday");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}