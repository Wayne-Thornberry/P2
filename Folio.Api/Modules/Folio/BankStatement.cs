using System.Globalization;

namespace Folio.Api.Modules.Folio;

// ── Bank statements ────────────────────────────────────────────────────────────────────
// A statement PDF is not a file the browser can read as CSV: the transactions are a table
// drawn on a page, and which column an amount is in is the only thing that says whether it
// is money in or money out.
//
// So the browser lifts the words and where they sit (pdf.js does that; a PDF is laid out,
// not written), and the rules that turn a layout into transactions are here: which
// headings are the column boundaries, what a date looks like, which lines are a statement's
// furniture rather than its transactions, and how a balance carries across rows that do not
// print one. Those are the rules a person had to apply by hand with a script, and they
// belong on the server for the same reason the budget arithmetic does.
//
// Bank of Ireland only, for now: its layout is the one the tool this replaces understood.
// Another bank is another set of headings, and it goes here rather than in the site.

/// <summary>One word on a page, with the box it was drawn in, in PDF points from the top left.</summary>
public sealed record StatementWord(string Text, double X0, double X1, double Top);

/// <summary>A page's words. Pages are separate because a page's layout starts again at the top.</summary>
public sealed record StatementPage(List<StatementWord>? Words);

/// <summary>One statement file: the pages it has, in the order they were printed.</summary>
public sealed record StatementFile(string FileName, List<StatementPage>? Pages);

/// <summary>What the site sends: the statements it was given, and which bank wrote them.</summary>
public sealed record StatementRequest(string? Bank, List<StatementFile>? Files);

/// <summary>A transaction, named the way the site's CSV rows are named, so both fit one dialog.</summary>
public sealed record StatementRow(string IsoDate, string YearMonth, string Details, decimal Amount, string Type, decimal? Balance);

/// <summary>A balance that jumped between two statements, which needs a row of its own.</summary>
public sealed record StatementGap(string Date, decimal Amount, string Type, string Label);

/// <summary>What one file came to, for the summary the dialog shows.</summary>
public sealed record StatementFileSummary(
    string FileName,
    int RowCount,
    string OldestDate,
    string NewestDate,
    decimal? OpeningBalance,
    decimal? ClosingBalance);

/// <summary>
/// Every transaction in the statements, oldest first, with the balances either end.
/// </summary>
public sealed record StatementAnswer(
    string Bank,
    string BankName,
    string Currency,
    List<StatementRow> Rows,
    decimal? OpeningBalance,
    string OpeningDate,
    decimal? ClosingBalance,
    List<StatementGap> Gaps,
    List<StatementFileSummary> Files);

public static class BankStatement
{
    public const string Boi = "boi";

    /// <summary>Words within this many points of each other are on the same line.</summary>
    private const double LineTolerance = 3;

    /// <summary>Two balances closer than this are the same balance.</summary>
    private const decimal SameBalance = 0.005m;

    /// <summary>
    /// How long a transaction's description can be. A statement truncates its own at about
    /// twenty characters, so anything longer is not a description: it is the small print at
    /// the foot of the page, which a line with no amount is otherwise indistinguishable from.
    /// </summary>
    private const int MaxDescription = 120;

    private static readonly string[] Months =
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /// <summary>
    /// The furniture of a Bank of Ireland statement: headings, addresses, the account's own
    /// numbers, and the totals that are not transactions. A line containing any of these is
    /// not a row — but it can still be the line that a date carries down from.
    /// </summary>
    private static readonly string[] Furniture =
    [
        "Transaction details", "Opening Balance", "Closing Balance",
        "Bank of Ireland", "Sort Code", "IBAN", "BIC", "Account Number",
        "SUBTOTAL", "Page ", "Registered No", "Tel (", "Fax (",
        "Branch code", "Bank Identifier Code", "Your account name",
        "3RD LEVEL ACCOUNT", "Statement date", "Your Current Account Statement",
        "Account number", "MR WAYNE THORNBERRY",
        "Deposit Guarantee Scheme", "Depositor Information Sheet",
        "bankofireland.com", "eligible deposit",
        "Registered Office", "Head Office", "Mespil Road",
        "BALANCE FORWARD", "INTEREST RATE PAYABLE FROM DATE",
        "Interest Rates payable are quoted gross on Cleared Credit Balances",
    ];

    /// <summary>Why this request cannot be read, or null when it can.</summary>
    public static string? Refusal(StatementRequest request)
    {
        var bank = (request.Bank ?? Boi).Trim().ToLowerInvariant();

        if (bank != Boi)
            return "Only a Bank of Ireland statement can be read: ?bank=boi.";

        if (request.Files is not { Count: > 0 })
            return "A statement is needed.";

        if (request.Files.Any(file => (file.Pages ?? []).All(page => (page.Words ?? []).Count == 0)))
            return $"Nothing could be read from {FirstEmpty(request)}.";

        return null;
    }

    private static string FirstEmpty(StatementRequest request) =>
        request.Files!.First(file => (file.Pages ?? []).All(page => (page.Words ?? []).Count == 0)).FileName;

    /// <summary>Every file's rows, merged into one answer.</summary>
    public static StatementAnswer Read(StatementRequest request)
    {
        var files = (request.Files ?? [])
            .Select(file => ReadFile(file))
            .OrderBy(file => file.Rows.Count == 0 ? "9999-99-99" : file.Rows[0].IsoDate, StringComparer.Ordinal)
            .ToList();

        var rows = Merge(files);
        var first = files.FirstOrDefault(file => file.Rows.Count > 0);

        // Statements printed on the same day overlap: a balance that does not run on from
        // the one before it is money that moved while no statement was being printed.
        var gaps = new List<StatementGap>();

        for (var index = 0; index < files.Count - 1; index++)
        {
            var previous = files[index];
            var next = files[index + 1];

            if (previous.ClosingBalance is not { } closing || next.OpeningBalance is not { } opening)
                continue;

            var difference = closing - opening;

            if (Math.Abs(difference) <= SameBalance)
                continue;

            gaps.Add(new StatementGap(
                next.Rows[0].IsoDate,
                Math.Abs(difference),
                difference > 0 ? "out" : "in",
                $"Balance adjustment between {previous.FileName} and {next.FileName}"));
        }

        return new StatementAnswer(
            Boi,
            "Bank of Ireland",
            "EUR",
            rows,
            first?.OpeningBalance,
            first is { Rows.Count: > 0 } ? DayBefore(first.Rows[0].IsoDate) : "",
            files.LastOrDefault(file => file.Rows.Count > 0)?.ClosingBalance,
            gaps,
            files.Select(file => new StatementFileSummary(
                file.FileName,
                file.Rows.Count,
                file.Rows.Count > 0 ? file.Rows[0].IsoDate : "",
                file.Rows.Count > 0 ? file.Rows[^1].IsoDate : "",
                file.OpeningBalance,
                file.ClosingBalance)).ToList());
    }

    private sealed record FileRows(string FileName, List<StatementRow> Rows, decimal? OpeningBalance, decimal? ClosingBalance);

    /// <summary>One statement: its transactions oldest first, and the balances either end.</summary>
    private static FileRows ReadFile(StatementFile file)
    {
        var columns = new Columns(null, null);
        var rows = new List<Row>();

        // The day, and any description that has not found its amount yet, run on from one
        // page to the next: a page break is not the end of a transaction.
        string? date = null;
        var pending = new List<string>();

        foreach (var page in file.Pages ?? [])
        {
            var lines = Lines(page.Words ?? []);

            // The headings are printed again on each page, but not always: a page without
            // them inherits the boundaries of the page before it.
            if (FindColumns(lines) is { } found)
                columns = found;

            ReadLines(lines, columns, rows, ref date, pending);
        }

        var ordered = rows.OrderBy(row => row.Date).ToList();
        var balances = Propagate(ordered);

        var statement = ordered
            .Select((row, index) => new StatementRow(
                row.Date,
                row.Date[..7],
                row.Details,
                row.Amount,
                row.Type,
                balances[index]))
            .ToList();

        decimal? opening = null;
        decimal? closing = null;

        if (statement.Count > 0)
        {
            closing = statement[^1].Balance;

            opening = statement[0].Balance is { } first
                ? statement[0].Type == "in" ? first - statement[0].Amount : first + statement[0].Amount
                : null;
        }

        return new FileRows(file.FileName, statement, opening, closing);
    }

    /// <summary>
    /// A balance on every row, worked out from the ones the statement prints.
    ///
    /// A statement prints the balance after a transaction, so a row without one is the next
    /// printed balance with the transactions since it taken back off. Rows older than the
    /// first printed balance are worked the other way.
    /// </summary>
    private static decimal?[] Propagate(List<Row> rows)
    {
        var balances = new decimal?[rows.Count];
        var anchor = rows.FindIndex(row => row.Balance is not null);

        if (anchor < 0)
            return balances;

        balances[anchor] = rows[anchor].Balance;

        for (var index = anchor + 1; index < rows.Count; index++)
            balances[index] = Math.Round(balances[index - 1]!.Value + Signed(rows[index]), 2);

        for (var index = anchor - 1; index >= 0; index--)
            balances[index] = Math.Round(balances[index + 1]!.Value - Signed(rows[index + 1]), 2);

        return balances;
    }

    private static decimal Signed(Row row) => row.Type == "in" ? row.Amount : -row.Amount;

    /// <summary>
    /// The rows of all the files together, with the same transaction in two statements kept
    /// once.
    ///
    /// Counted rather than de-duplicated by key: two coffees on the same day for the same
    /// money are two coffees, so a key is only a duplicate for as many times as the earlier
    /// file already had it.
    /// </summary>
    private static List<StatementRow> Merge(List<FileRows> files)
    {
        var merged = new List<StatementRow>();
        var seen = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var file in files)
        {
            var consumed = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var row in file.Rows)
            {
                var key = $"{row.IsoDate}|{row.Details}|{row.Amount}|{row.Type}";

                consumed.TryGetValue(key, out var taken);
                consumed[key] = taken + 1;

                seen.TryGetValue(key, out var already);

                if (taken < already)
                    continue;

                merged.Add(row);
                seen[key] = already + 1;
            }
        }

        return merged;
    }

    private sealed record Row(string Date, string Details, decimal Amount, string Type, decimal? Balance);

    /// <summary>Column boundaries, as the x a right-aligned amount ends before.</summary>
    private sealed record Columns(double? Debit, double? Credit);

    /// <summary>
    /// Where the money columns begin, read off the headings.
    ///
    /// "Payments out" and "Payments in" are two headings, so the second "Payments" is where
    /// the second column starts, and "Balance" is where the third does. Amounts are
    /// right-aligned, so a column's left edge is the fence the amount before it ends at.
    /// </summary>
    private static Columns? FindColumns(List<List<StatementWord>> lines)
    {
        foreach (var line in lines)
        {
            var text = string.Join(' ', line.Select(word => word.Text));

            if (!text.Contains("Balance", StringComparison.Ordinal) || !text.Contains("Payments", StringComparison.Ordinal))
                continue;

            var payments = line.Where(word => word.Text == "Payments").ToList();
            var balance = line.FirstOrDefault(word => word.Text == "Balance");

            if (payments.Count >= 2 && balance is not null)
                return new Columns(payments[1].X0, balance.X0);
        }

        return null;
    }

    /// <summary>A word that is an amount, and nothing else: "1,234.56", not "25.00@1.14626".</summary>
    private static bool IsAmount(string text)
    {
        var separator = text.IndexOf('.');

        if (separator < 1 || text.Length - separator != 3)
            return false;

        var fraction = text[(separator + 1)..];

        if (!fraction.All(char.IsAsciiDigit))
            return false;

        var groups = text[..separator].Split(',');

        if (!groups.All(group => group.Length > 0 && group.All(char.IsAsciiDigit)))
            return false;

        return groups.Length == 1 || (groups[0].Length <= 3 && groups.Skip(1).All(group => group.Length == 3));
    }

    private static decimal? Amount(string text)
    {
        if (!IsAmount(text))
            return null;

        return decimal.TryParse(
            text.Replace(",", "", StringComparison.Ordinal),
            NumberStyles.Number,
            CultureInfo.InvariantCulture,
            out var value)
            ? value
            : null;
    }

    /// <summary>Which column an amount ended in, by how far right it reaches.</summary>
    private static string Column(StatementWord word, Columns columns) =>
        columns.Debit is { } debit && word.X1 <= debit ? "debit"
        : columns.Credit is { } credit && word.X1 <= credit ? "credit"
        : "balance";

    /// <summary>
    /// The lines of a page, top to bottom, each left to right.
    ///
    /// Words are grouped by the line they sit on rather than by what a PDF calls a line: a
    /// table row is not one, and a description can be several.
    /// </summary>
    private static List<List<StatementWord>> Lines(List<StatementWord> words) =>
        words
            .GroupBy(word => Math.Round(word.Top / LineTolerance) * LineTolerance)
            .OrderBy(line => line.Key)
            .Select(line => line.OrderBy(word => word.X0).ToList())
            .ToList();

    private static void ReadLines(
        List<List<StatementWord>> lines,
        Columns columns,
        List<Row> rows,
        ref string? date,
        List<string> pending)
    {
        foreach (var line in lines)
        {
            var text = string.Join(' ', line.Select(word => word.Text));
            var start = 0;

            // The date comes first, before the line is judged: a "BALANCE FORWARD" line is
            // the beginning of a day, and the transactions under it belong to that day.
            if (line.Count >= 1 && DateOfTokens(line.Take(1).Select(word => word.Text)) is { } single)
            {
                date = single;
                start = 1;
                pending.Clear();
            }
            else if (line.Count >= 3 && DateOfTokens(line.Take(3).Select(word => word.Text)) is { } three)
            {
                date = three;
                start = 3;
                pending.Clear();
            }

            if (Furniture.Any(phrase => text.Contains(phrase, StringComparison.Ordinal)))
            {
                pending.Clear();
                continue;
            }

            if (date is null)
                continue;

            var details = new List<string>();
            decimal? debit = null;
            decimal? credit = null;
            decimal? balance = null;

            foreach (var word in line.Skip(start))
            {
                if (Amount(word.Text) is not { } amount)
                {
                    details.Add(word.Text);
                    continue;
                }

                switch (Column(word, columns))
                {
                    case "debit":
                        debit = amount;
                        break;
                    case "credit":
                        credit = amount;
                        break;
                    default:
                        balance = amount;
                        break;
                }
            }

            var moneyIn = credit is not null;
            var moneyOut = debit is not null;

            if (!moneyIn && !moneyOut)
            {
                // A line with nothing to move. Only a line that carries a date can be the
                // beginning of a transaction -- a description whose amount is printed
                // underneath it. Anything else is the statement talking to itself: an
                // address, a heading, the small print at the foot of the page.
                if (start > 0 && details.Count > 0)
                {
                    pending.Clear();
                    pending.AddRange(details);
                }

                continue;
            }

            if (pending.Count > 0)
            {
                details.InsertRange(0, pending);
                pending.Clear();
            }

            rows.Add(new Row(
                date,
                Fit(Joined(details)),
                (moneyOut ? debit : credit)!.Value,
                moneyOut ? "out" : "in",
                balance));
        }
    }

    /// <summary>A description, as the statement printed it: one line of words, joined.</summary>
    private static string Joined(IEnumerable<string> words) => string.Join(' ', words).Trim();

    private static string Fit(string text) => text.Length <= MaxDescription ? text : text[..MaxDescription].TrimEnd();

    /// <summary>
    /// A date, as the statement prints one: "03 Oct 2018" in three words, or "03-Oct-2018" in
    /// one. Anything else, including an empty run of tokens, is not a date.
    /// </summary>
    private static string? DateOfTokens(IEnumerable<string> tokens)
    {
        var parts = tokens.ToList();

        if (parts.Count == 3)
            return Date($"{parts[0]} {parts[1]} {parts[2]}");

        if (parts.Count == 1)
            return Date(parts[0].Replace('-', ' '));

        return null;
    }

    private static string? Date(string text)
    {
        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        if (parts.Length != 3)
            return null;

        if (parts[0].Length is < 1 or > 2 || !parts[0].All(char.IsAsciiDigit))
            return null;

        var month = Array.FindIndex(Months, name => string.Equals(name, parts[1], StringComparison.OrdinalIgnoreCase)) + 1;

        if (month == 0)
            return null;

        if (parts[2].Length is not (2 or 4) || !parts[2].All(char.IsAsciiDigit))
            return null;

        var year = int.Parse(parts[2], CultureInfo.InvariantCulture);

        if (parts[2].Length == 2)
            year += year < 70 ? 2000 : 1900;

        var day = int.Parse(parts[0], CultureInfo.InvariantCulture);

        if (day < 1 || day > DateTime.DaysInMonth(year, month))
            return null;

        return $"{year:D4}-{month:D2}-{day:D2}";
    }

    private static string DayBefore(string date) =>
        DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(-1).ToString("yyyy-MM-dd");
}
