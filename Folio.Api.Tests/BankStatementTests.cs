using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// A statement PDF, as far as the rules are concerned: words and where they sit.
///
/// The x positions are the ones a real Bank of Ireland statement uses, because the only
/// thing that says whether an amount is money in or money out is which column it reaches
/// into. Nothing here is anybody's statement: the words are made up.
/// </summary>
public sealed class BankStatementTests
{
    private const double Heading = 222;
    private const double DebitEnd = 383;      // right edge of the "Payments out" column
    private const double CreditEnd = 483;     // right edge of the "Payments in" column
    private const double BalanceEnd = 543;    // right edge of the "Balance" column

    /// <summary>The headings, at the x positions a Bank of Ireland statement prints them.</summary>
    private static StatementWord[] Header(double top) =>
    [
        new("Date", 79.20, 96.48, top),
        new("Transaction", 143.76, 188.90, top),
        new("details", 191.11, 216.33, top),
        new("Payments", 325.44, 363.09, top),
        new("out", 370.16, 382.56, top),
        new("Payments", 415.68, 453.33, top),
        new("in", 460.40, 467.50, top),
        new("Balance", 510.72, 541.28, top),
    ];

    /// <summary>An amount in one of the three money columns: right-aligned, so its right edge decides.</summary>
    private static StatementWord Money(string text, double ends, double top) =>
        new(text, ends - (text.Length * 4), ends, top);

    /// <summary>A date printed as three words: day, month, year.</summary>
    private static StatementWord[] DateWords(string day, string month, string year, double top) =>
    [
        new(day, 79, 88, top),
        new(month, 90, 104, top),
        new(year, 106, 124, top),
    ];

    private static StatementWord Description(string text, double top) =>
        new(text, 144, 144 + (text.Length * 4), top);

    private static StatementAnswer Read(params StatementFile[] files) =>
        BankStatement.Read(new StatementRequest("boi", [.. files]));

    private static StatementFile One(params StatementWord[][] lines) =>
        Named("statement.pdf", lines);

    private static StatementFile Named(string fileName, params StatementWord[][] lines) =>
        new(fileName, [new StatementPage([.. lines.SelectMany(line => line)])]);

    [Fact]
    public void A_statement_is_read_column_by_column_into_transactions()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description("POS 02OCT SHOP", 252), Money("5.50", DebitEnd, 252)],
            [Description("365 Online TRANSFER", 264), Money("20.00", DebitEnd, 264), Money("102.68", BalanceEnd, 264)],
            [.. DateWords("06", "Oct", "2018", 276), Description("SALARY ACME", 276), Money("1,000.00", CreditEnd, 276), Money("1,090.18", BalanceEnd, 276)]));

        Assert.Equal(3, answer.Rows.Count);

        // Oldest first, and the money going out is a debit rather than a negative credit.
        Assert.Equal("2018-10-04", answer.Rows[0].IsoDate);
        Assert.Equal("POS 02OCT SHOP", answer.Rows[0].Details);
        Assert.Equal(5.50m, answer.Rows[0].Amount);
        Assert.Equal("out", answer.Rows[0].Type);

        Assert.Equal("2018-10-04", answer.Rows[1].IsoDate);
        Assert.Equal(20m, answer.Rows[1].Amount);
        Assert.Equal(102.68m, answer.Rows[1].Balance);

        Assert.Equal("2018-10-06", answer.Rows[2].IsoDate);
        Assert.Equal(1000m, answer.Rows[2].Amount);
        Assert.Equal("in", answer.Rows[2].Type);
        Assert.Equal("2018-10", answer.Rows[2].YearMonth);
    }

    [Fact]
    public void A_row_without_a_balance_takes_the_one_the_next_row_prints()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description("POS SHOP", 252), Money("5.50", DebitEnd, 252)],
            [Description("365 Online TRANSFER", 264), Money("20.00", DebitEnd, 264), Money("102.68", BalanceEnd, 264)]));

        // 102.68 is after the second row; the first row was 5.50 earlier, so 122.68.
        Assert.Equal(122.68m, answer.Rows[0].Balance);
        Assert.Equal(102.68m, answer.Rows[1].Balance);
    }

    [Fact]
    public void The_opening_balance_is_the_oldest_row_with_its_transaction_taken_off()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description("POS SHOP", 252), Money("5.50", DebitEnd, 252), Money("122.68", BalanceEnd, 252)],
            [.. DateWords("06", "Oct", "2018", 276), Description("SALARY ACME", 276), Money("100.00", CreditEnd, 276), Money("222.68", BalanceEnd, 276)]));

        Assert.Equal(128.18m, answer.OpeningBalance);
        Assert.Equal("2018-10-03", answer.OpeningDate);
        Assert.Equal(222.68m, answer.ClosingBalance);
    }

    [Fact]
    public void A_balance_forward_line_is_furniture_but_still_begins_a_day()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("03", "Oct", "2018", 240), Description("BALANCE FORWARD", 240), Money("128.18", BalanceEnd, 240)],
            [Description("POS SHOP", 252), Money("5.50", DebitEnd, 252), Money("122.68", BalanceEnd, 252)]));

        var row = Assert.Single(answer.Rows);

        Assert.Equal("2018-10-03", row.IsoDate);
        Assert.Equal("POS SHOP", row.Details);
        Assert.Equal(5.50m, row.Amount);
    }

    [Theory]
    [InlineData("Statement date 23 Apr 2019 Number 11")]
    [InlineData("IBAN IE73 BOFI 9034 4566 7034 97")]
    [InlineData("Bank of Ireland")]
    [InlineData("Registered Office Head Office Mespil Road")]
    [InlineData("SUBTOTAL")]
    public void The_furniture_of_a_statement_is_not_a_transaction(string text)
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description(text, 252)],
            [Description("POS SHOP", 264), Money("5.50", DebitEnd, 264), Money("122.68", BalanceEnd, 264)]));

        Assert.Single(answer.Rows);
        Assert.Equal("POS SHOP", answer.Rows[0].Details);
    }

    [Fact]
    public void A_description_that_runs_onto_the_next_line_belongs_to_its_row()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description("POS 02OCT", 252)],
            [Description("DAYBREAK KELLS", 264), Money("5.50", DebitEnd, 264), Money("122.68", BalanceEnd, 264)]));

        var row = Assert.Single(answer.Rows);

        Assert.Equal("POS 02OCT DAYBREAK KELLS", row.Details);
    }

    [Fact]
    public void An_amount_with_a_rate_stuck_to_it_is_part_of_the_description()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("05", "Oct", "2018", 252), Description("CARD IN USD", 252), Description("25.00@1.14626", 252),
             Money("21.81", DebitEnd, 252), Money("80.43", BalanceEnd, 252)]));

        var row = Assert.Single(answer.Rows);

        Assert.Equal("CARD IN USD 25.00@1.14626", row.Details);
        Assert.Equal(21.81m, row.Amount);
    }

    [Fact]
    public void A_page_without_headings_uses_the_columns_of_the_page_before_it()
    {
        var first = new StatementPage([.. Header(Heading), .. DateWords("04", "Oct", "2018", 252), Description("POS SHOP", 252), Money("5.50", DebitEnd, 252), Money("122.68", BalanceEnd, 252)]);
        var second = new StatementPage([.. DateWords("05", "Oct", "2018", 20), Description("POS BAKERY", 20), Money("3.00", DebitEnd, 20), Money("119.68", BalanceEnd, 20)]);

        var answer = Read(new StatementFile("statement.pdf", [first, second]));

        Assert.Equal(2, answer.Rows.Count);
        Assert.Equal("out", answer.Rows[1].Type);
        Assert.Equal(3.00m, answer.Rows[1].Amount);
    }

    [Fact]
    public void A_two_digit_year_is_read_as_this_century()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "19", 252), Description("POS SHOP", 252), Money("5.50", DebitEnd, 252), Money("122.68", BalanceEnd, 252)]));

        Assert.Equal("2019-10-04", answer.Rows[0].IsoDate);
    }

    [Fact]
    public void Two_statements_that_overlap_do_not_double_count()
    {
        var january = One(
            [.. Header(Heading)],
            [.. DateWords("31", "Jan", "2026", 252), Description("TESCO", 252), Money("30.00", DebitEnd, 252), Money("955.00", BalanceEnd, 252)],
            [.. DateWords("01", "Jan", "2026", 264), Description("SALARY", 264), Money("1,000.00", CreditEnd, 264), Money("1000.00", BalanceEnd, 264)]);

        var overlap = One(
            [.. Header(Heading)],
            [.. DateWords("31", "Jan", "2026", 252), Description("TESCO", 252), Money("30.00", DebitEnd, 252), Money("955.00", BalanceEnd, 252)],
            [.. DateWords("15", "Jan", "2026", 264), Description("NETFLIX", 264), Money("15.00", DebitEnd, 264), Money("985.00", BalanceEnd, 264)],
            [.. DateWords("01", "Jan", "2026", 276), Description("SALARY", 276), Money("1,000.00", CreditEnd, 276), Money("1000.00", BalanceEnd, 276)]);

        var answer = Read(january, overlap);

        // The salary and the Tesco shop are in both statements; the Netflix is only in one.
        Assert.Equal(3, answer.Rows.Count);
        Assert.Equal(0m, answer.OpeningBalance);
        Assert.Equal("2025-12-31", answer.OpeningDate);
        Assert.Equal(955m, answer.ClosingBalance);
    }

    [Fact]
    public void The_same_coffee_twice_on_a_day_is_two_coffees()
    {
        StatementFile Coffee(string fileName, double firstTop, double secondTop) => One(
            [.. Header(Heading)],
            [.. DateWords("05", "Jan", "2026", firstTop), Description("COFFEE", firstTop), Money("5.00", DebitEnd, firstTop), Money("95.00", BalanceEnd, firstTop)],
            [.. DateWords("05", "Jan", "2026", secondTop), Description("COFFEE", secondTop), Money("5.00", DebitEnd, secondTop), Money("90.00", BalanceEnd, secondTop)],
            [.. DateWords("10", "Jan", "2026", 300), Description("SALARY", 300), Money("500.00", CreditEnd, 300), Money("590.00", BalanceEnd, 300)]);

        var answer = Read(Coffee("a.pdf", 252, 264), Coffee("b.pdf", 252, 264));

        Assert.Equal(2, answer.Rows.Count(row => row.Details == "COFFEE"));
        Assert.Equal(3, answer.Rows.Count);
    }

    [Fact]
    public void A_gap_between_two_statements_is_named_so_it_can_be_bridged()
    {
        // January closes at 70, February's first row says it opened at 330: 260 went missing.
        var january = Named("january.pdf",
            [.. Header(Heading)],
            [.. DateWords("31", "Jan", "2026", 252), Description("TESCO", 252), Money("30.00", DebitEnd, 252), Money("70.00", BalanceEnd, 252)]);

        var february = Named("february.pdf",
            [.. Header(Heading)],
            [.. DateWords("01", "Feb", "2026", 252), Description("SALARY", 252), Money("1,000.00", CreditEnd, 252), Money("1,330.00", BalanceEnd, 252)]);

        var answer = Read(february, january);

        var gap = Assert.Single(answer.Gaps);
        Assert.Equal("2026-02-01", gap.Date);
        Assert.Equal(260m, gap.Amount);
        Assert.Equal("in", gap.Type);
        Assert.Contains("january", gap.Label, StringComparison.Ordinal);
    }

    [Fact]
    public void Two_statements_that_run_on_from_each_other_have_no_gap()
    {
        var january = One(
            [.. Header(Heading)],
            [.. DateWords("31", "Jan", "2026", 252), Description("TESCO", 252), Money("30.00", DebitEnd, 252), Money("70.00", BalanceEnd, 252)]);

        var february = One(
            [.. Header(Heading)],
            [.. DateWords("01", "Feb", "2026", 252), Description("SALARY", 252), Money("1,000.00", CreditEnd, 252), Money("1,070.00", BalanceEnd, 252)]);

        Assert.Empty(Read(january, february).Gaps);
    }

    [Fact]
    public void Every_file_says_what_it_came_to()
    {
        var answer = Read(One(
            [.. Header(Heading)],
            [.. DateWords("04", "Oct", "2018", 252), Description("POS SHOP", 252), Money("5.50", DebitEnd, 252), Money("122.68", BalanceEnd, 252)],
            [.. DateWords("06", "Oct", "2018", 276), Description("SALARY ACME", 276), Money("100.00", CreditEnd, 276), Money("222.68", BalanceEnd, 276)]));

        var file = Assert.Single(answer.Files);

        Assert.Equal("statement.pdf", file.FileName);
        Assert.Equal(2, file.RowCount);
        Assert.Equal("2018-10-04", file.OldestDate);
        Assert.Equal("2018-10-06", file.NewestDate);
        Assert.Equal(128.18m, file.OpeningBalance);
        Assert.Equal(222.68m, file.ClosingBalance);
        Assert.Equal("EUR", answer.Currency);
        Assert.Equal("boi", answer.Bank);
    }

    [Fact]
    public void A_statement_with_nothing_on_it_answers_with_nothing()
    {
        var answer = Read(One([.. Header(Heading)]));

        Assert.Empty(answer.Rows);
        Assert.Null(answer.OpeningBalance);
        Assert.Null(answer.ClosingBalance);
        Assert.Equal("", answer.OpeningDate);
    }

    [Fact]
    public void A_request_that_is_not_a_bank_of_ireland_statement_is_refused_with_a_reason()
    {
        Assert.Contains("Bank of Ireland", BankStatement.Refusal(new StatementRequest("revolut", [One([.. Header(Heading)])])));
        Assert.Contains("statement is needed", BankStatement.Refusal(new StatementRequest("boi", [])));
        Assert.Contains("Nothing could be read", BankStatement.Refusal(new StatementRequest("boi", [new StatementFile("empty.pdf", [new StatementPage([])])])));
        Assert.Null(BankStatement.Refusal(new StatementRequest(null, [One([.. Header(Heading)])])));
    }
}
