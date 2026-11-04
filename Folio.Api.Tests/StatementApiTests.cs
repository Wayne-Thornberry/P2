using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Folio.Api.Tests;

/// <summary>
/// A statement over HTTP: the words a PDF drew, in, and transactions out.
///
/// The words are the x positions a Bank of Ireland statement prints, because that is what
/// decides which column an amount is in. The statement itself is made up.
/// </summary>
public sealed class StatementApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static object Word(string text, double x0, double x1, double top) => new { text, x0, x1, top };

    private static object[] Header(double top) =>
    [
        Word("Date", 79.20, 96.48, top),
        Word("Transaction", 143.76, 188.90, top),
        Word("details", 191.11, 216.33, top),
        Word("Payments", 325.44, 363.09, top),
        Word("out", 370.16, 382.56, top),
        Word("Payments", 415.68, 453.33, top),
        Word("in", 460.40, 467.50, top),
        Word("Balance", 510.72, 541.28, top),
    ];

    private static object Statement()
    {
        List<object> words =
        [
            .. Header(222),
            Word("03", 79, 88, 240), Word("Oct", 90, 104, 240), Word("2018", 106, 124, 240),
            Word("BALANCE", 144, 183, 240), Word("FORWARD", 185, 227, 240), Word("128.18", 518.4, 542.9, 240),
            Word("04", 79, 88, 252), Word("Oct", 90, 104, 252), Word("2018", 106, 124, 252),
            Word("POS 02OCT SHOP", 143.8, 250.2, 252), Word("5.50", 367.2, 382.8, 252),
            Word("06", 79, 88, 264), Word("Oct", 90, 104, 264), Word("2018", 106, 124, 264),
            Word("SALARY ACME", 143.8, 224.0, 264), Word("100.00", 460.4, 483.1, 264), Word("222.68", 518.4, 542.9, 264),
        ];

        return new
        {
            bank = "boi",
            files = new[]
            {
                new { fileName = "statement.pdf", pages = new[] { new { words } } },
            },
        };
    }

    [DatabaseFact]
    public async Task A_statement_is_read_into_transactions()
    {
        var client = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync("/api/folio/import/statement", Statement());
        response.EnsureSuccessStatusCode();

        var answer = await response.Content.ReadFromJsonAsync<JsonElement>();
        var rows = answer.GetProperty("rows");

        Assert.Equal("boi", answer.GetProperty("bank").GetString());
        Assert.Equal(2, rows.GetArrayLength());

        Assert.Equal("2018-10-04", rows[0].GetProperty("isoDate").GetString());
        Assert.Equal("POS 02OCT SHOP", rows[0].GetProperty("details").GetString());
        Assert.Equal(5.5m, rows[0].GetProperty("amount").GetDecimal());
        Assert.Equal("out", rows[0].GetProperty("type").GetString());
        Assert.Equal(122.68m, rows[0].GetProperty("balance").GetDecimal());

        Assert.Equal("in", rows[1].GetProperty("type").GetString());
        Assert.Equal(128.18m, answer.GetProperty("openingBalance").GetDecimal());
        Assert.Equal("2018-10-03", answer.GetProperty("openingDate").GetString());
        Assert.Equal(222.68m, answer.GetProperty("closingBalance").GetDecimal());
    }

    [DatabaseFact]
    public async Task A_statement_from_another_bank_is_refused_in_the_APIs_own_words()
    {
        var client = await factory.CreateSignedInClientAsync();

        var refused = await client.PostAsJsonAsync("/api/folio/import/statement", new
        {
            bank = "revolut",
            files = new[] { new { fileName = "statement.pdf", pages = Array.Empty<object>() } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

        var body = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("Bank of Ireland", body.GetProperty("error").GetString(), StringComparison.Ordinal);
    }
}
