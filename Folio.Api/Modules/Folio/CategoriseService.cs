using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Folio.Api.Ai;
using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// Reading a transaction's name and notes and saying which budget item it belongs to.
///
/// Asked about <b>payees, not rows</b>: a year of statements is thousands of transactions
/// and a few hundred names, and "Tesco" is the same question whether it appears four times
/// or four hundred. That is what makes the answer cost the same for a big budget as for a
/// small one, and it is also how a person would do it.
///
/// Two things are settled without the model at all: a payee the budget has already
/// categorised (the user's own answer, reused), and anything the model is confident about
/// from a name it has already placed. Only what is genuinely unknown is sent, and what
/// comes back is a proposal -- nothing is saved here, because the site applies it to the
/// budget it already holds and saves it the one way a save goes through.
/// </summary>
public sealed class CategoriseService(FolioDbContext db, CurrentUser me, DeepSeekClient ai)
{
    /// <summary>
    /// How many transactions one ask may consider. The work is per payee, so this is a
    /// guard against a runaway request rather than a limit on what the model sees.
    /// </summary>
    public const int MaxTransactions = 5000;

    /// <summary>
    /// How many distinct payees go in one question. Each is one short line of JSON, so a
    /// batch's answer is a few hundred tokens: the whole of a large budget fits in a
    /// handful of calls rather than one that cannot be answered.
    /// </summary>
    public const int PayeesPerAsk = 60;

    /// <summary>
    /// How many items one ask may invent. Enough for a new habit to show up, few enough
    /// that a muddled answer cannot litter the budget.
    /// </summary>
    public const int MaxNewItems = 8;

    private const int NameMaxLength = 100;

    private const string SystemPrompt = """
        You sort personal-budget payees into budget items.

        You are given the items that already exist, and a list of payees. Each payee is the
        name that appears on a bank transaction, with an example of what was bought. For
        each payee, choose the item it belongs to.

        Rules:
        - Prefer an existing item, matched by name exactly as it is written. Reuse is the
          point: if "Groceries" is close enough, use "Groceries".
        - Only invent an item when nothing that exists fits. At most the stated number of
          new items, and each one must be a category a household would keep for months --
          not a merchant, not a one-off, not a sentence.
        - A payee you cannot place may be left out. Do not guess.
        - A refund and a purchase belong to the same item. Income belongs to whatever item
          describes where it came from.
        - Confidence is a number from 0 to 1.

        Answer with one JSON object, exactly this shape and no other keys, with one line
        per payee you can place:
        {
          "assignments": [ { "payee": "TESCO STORES", "item": "Groceries", "new": false, "confidence": 0.92, "why": "supermarket" } ],
          "newItems": [ "Subscriptions" ]
        }
        """;

    public async Task<CategoriseResponse> ReadAsync(
        string country,
        CategoriseRequest request,
        CancellationToken cancellationToken)
    {
        var items = (request.Items ?? [])
            .OfType<BudgetItemDto>()
            .Select(item => new BudgetItemDto(item.Id, (item.Name ?? "").Trim()))
            .Where(item => item.Name.Length > 0)
            .ToList();

        if (items.Count == 0)
        {
            items = await db.BudgetItems.AsNoTracking()
                .Where(row => row.UserId == me.Id && row.Country == country)
                .OrderBy(row => row.SortOrder)
                .Select(row => new BudgetItemDto(row.Id, row.Name))
                .ToListAsync(cancellationToken);
        }

        var candidates = await CandidatesAsync(country, request, cancellationToken);

        if (candidates.Count == 0)
            return new CategoriseResponse([], [], 0, 0, 0, 0, items);

        // One question per payee: the rows that share a name share an item.
        var byPayee = candidates
            .GroupBy(row => Spell(row.Name), StringComparer.Ordinal)
            .Where(group => group.Key.Length > 0)
            .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);

        var alreadyKnown = await AlreadyCategorisedAsync(country, cancellationToken);
        var itemNames = items.ToDictionary(item => item.Id, item => item.Name);

        var groups = new List<CategoriseGroup>();
        var fromHistory = 0;
        var asked = new List<string>();

        foreach (var (payee, rows) in byPayee)
        {
            if (alreadyKnown.TryGetValue(payee, out var itemId) && itemNames.TryGetValue(itemId, out var name))
            {
                groups.Add(new CategoriseGroup(
                    rows[0].Name,
                    itemId,
                    name,
                    IsNew: false,
                    Confidence: 1m,
                    Why: "you have already categorised this payee",
                    [.. rows.Select(row => row.Id)],
                    FromHistory: true));

                fromHistory += rows.Count;

                continue;
            }

            asked.Add(payee);
        }

        var proposed = new List<string>();
        var unreadable = 0;
        var decisions = new List<CategoriseDecision>();

        foreach (var batch in asked.Chunk(PayeesPerAsk))
        {
            var answer = await AskAsync(items, batch, byPayee, cancellationToken);
            var (read, readable) = FromAnswer(answer, batch, items);

            if (!readable)
            {
                unreadable += batch.Length;
                continue;
            }

            decisions.AddRange(read);
            proposed.AddRange(read.Where(row => row.IsNew).Select(row => row.ItemName));
        }

        // One budget, one answer: a name proposed twice is one item, and the allowance is
        // for the whole ask.
        var allowed = proposed
            .Select(name => name.Trim())
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxNewItems)
            .ToList();

        foreach (var decision in decisions)
        {
            if (decision.IsNew && !allowed.Contains(decision.ItemName, StringComparer.OrdinalIgnoreCase))
                continue;

            if (!byPayee.TryGetValue(Spell(decision.Payee), out var rows))
                continue;

            groups.Add(new CategoriseGroup(
                rows[0].Name,
                decision.ItemId,
                decision.ItemName,
                decision.IsNew,
                decision.Confidence,
                decision.Why,
                [.. rows.Select(row => row.Id)],
                FromHistory: false));
        }

        // Every payee unreadable is not "the model had no opinion": it is a call that
        // produced nothing usable, and saying so beats showing an empty proposal.
        if (asked.Count > 0 && unreadable == asked.Count)
            throw new AiUnavailableException("The AI's answer could not be read.");

        return new CategoriseResponse(
            groups,
            allowed,
            candidates.Count,
            byPayee.Count,
            fromHistory,
            unreadable,
            items);
    }

    /// <summary>
    /// What the budget already knows: the item most recently given to each payee. The
    /// user's own answer beats the model's, costs nothing, and is the reason a second import
    /// from the same bank needs almost no AI at all.
    /// </summary>
    private async Task<Dictionary<string, int>> AlreadyCategorisedAsync(string country, CancellationToken cancellationToken)
    {
        var known = await db.Transactions.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country && row.ItemId != null)
            .OrderByDescending(row => row.Date)
            .Select(row => new { row.Name, ItemId = row.ItemId!.Value })
            .ToListAsync(cancellationToken);

        var byPayee = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var row in known)
        {
            var key = Spell(row.Name);

            // Newest first, so the first answer kept is the latest one given.
            if (key.Length > 0)
                byPayee.TryAdd(key, row.ItemId);
        }

        return byPayee;
    }

    /// <summary>
    /// What was selected, or -- when nothing was -- everything in this country the site has
    /// not categorised yet. Choosing that set is the API's job, so the button and the API
    /// agree on what "all of them" means.
    /// </summary>
    private async Task<List<CategoriseCandidate>> CandidatesAsync(
        string country,
        CategoriseRequest request,
        CancellationToken cancellationToken)
    {
        var selected = (request.Transactions ?? [])
            .OfType<CategoriseInput>()
            .Where(row => row.Id > 0 || !string.IsNullOrWhiteSpace(row.Name))
            .ToList();

        var rows = selected.Count > 0
            ? selected.Select(row => new CategoriseCandidate(
                    row.Id,
                    Text(row.Name, 200),
                    Text(row.Notes, 400),
                    Math.Round(row.Amount, 2),
                    row.Type == "in" ? "in" : "out",
                    row.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)))
                .ToList()
            : await db.Transactions.AsNoTracking()
                .Where(row => row.UserId == me.Id && row.Country == country && row.ItemId == null)
                .OrderByDescending(row => row.Date)
                .Take(MaxTransactions)
                .Select(row => new CategoriseCandidate(
                    row.Id,
                    row.Name,
                    row.Notes ?? "",
                    row.Amount,
                    row.Type,
                    ""))
                .ToListAsync(cancellationToken);

        return rows.Take(MaxTransactions).ToList();
    }

    private async Task<string> AskAsync(
        IReadOnlyList<BudgetItemDto> items,
        string[] payees,
        Dictionary<string, List<CategoriseCandidate>> byPayee,
        CancellationToken cancellationToken)
    {
        var question = new StringBuilder()
            .AppendLine($"Existing items: {JsonSerializer.Serialize(items.Select(item => new { id = item.Id, name = item.Name }))}")
            .AppendLine($"You may add at most {MaxNewItems} new items.")
            .AppendLine("Payees:")
            .AppendLine(JsonSerializer.Serialize(payees.Select(payee =>
            {
                var example = byPayee[payee][0];

                return new
                {
                    payee = example.Name,
                    example = example.Notes,
                    amount = example.Amount,
                    type = example.Type,
                    count = byPayee[payee].Count,
                };
            })))
            .ToString();

        return await ai.AskForJsonAsync(SystemPrompt, question, DeepSeekClient.CategoriseTokens, cancellationToken);
    }

    /// <summary>
    /// The model's JSON read against the payees it was asked about: a name nobody sent is
    /// ignored, a name that is an item by any reasonable spelling becomes that item, and
    /// only then is a new one allowed.
    ///
    /// Read by hand rather than through a record, because a model is not a compiler: it
    /// miscapitalises a payee, and calls a field "itemName" when it was shown "item". None
    /// of that is a wrong answer. <c>Readable</c> separates "the model declined" from
    /// "nothing here could be understood" -- the first is a shrug, the second a failed call.
    /// </summary>
    internal static (List<CategoriseDecision> Decisions, bool Readable) FromAnswer(
        string answer,
        IReadOnlyList<string> payees,
        IReadOnlyList<BudgetItemDto> items)
    {
        JsonDocument document;

        try
        {
            document = JsonDocument.Parse(answer);
        }
        catch (JsonException)
        {
            return ([], false);
        }

        using (document)
        {
            var root = document.RootElement;

            // The only shape that counts as an answer: an object with a list of assignments.
            // An empty list is a model that looked and declined, which is readable.
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("assignments", out var proposed)
                || proposed.ValueKind != JsonValueKind.Array)
                return ([], false);

            var asked = payees.Select(Spell).ToHashSet(StringComparer.Ordinal);
            var bySpelling = items
                .GroupBy(item => Spell(item.Name), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

            var decisions = new List<CategoriseDecision>();
            var invented = new List<string>();
            var taken = new HashSet<string>(StringComparer.Ordinal);

            foreach (var entry in proposed.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                    continue;

                var payee = Clean(Text(entry, "payee", "name", "transactionName"));

                if (payee is null)
                    continue;

                var key = Spell(payee);

                if (!asked.Contains(key) || !taken.Add(key))
                    continue;

                var item = Clean(Text(entry, "item", "itemName", "item_name", "category"));

                if (item is null)
                    continue;

                if (bySpelling.TryGetValue(Spell(item), out var existing))
                {
                    decisions.Add(new CategoriseDecision(
                        payee,
                        existing.Id,
                        existing.Name,
                        IsNew: false,
                        Confidence(Number(entry, "confidence")),
                        Clean(Text(entry, "why", "reason")) ?? ""));

                    continue;
                }

                // A name nothing matches is only an item if the model said it was inventing
                // one, and only while the budget can still afford another.
                if (!Flag(entry, "new", "isNew", "is_new") || invented.Count >= MaxNewItems)
                    continue;

                var proposedName = item.Length <= NameMaxLength ? item : item[..NameMaxLength];
                var already = invented.FirstOrDefault(name => string.Equals(name, proposedName, StringComparison.OrdinalIgnoreCase));

                if (already is null)
                {
                    already = proposedName;
                    invented.Add(already);
                }

                decisions.Add(new CategoriseDecision(
                    payee,
                    null,
                    already,
                    IsNew: true,
                    Confidence(Number(entry, "confidence")),
                    Clean(Text(entry, "why", "reason")) ?? ""));
            }

            return (decisions, true);
        }
    }

    private static string? Text(JsonElement entry, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (entry.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String)
                return value.GetString();
        }

        return null;
    }

    private static decimal? Number(JsonElement entry, string key)
    {
        if (!entry.TryGetProperty(key, out var value))
            return null;

        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
            return number;

        return value.ValueKind == JsonValueKind.String
               && decimal.TryParse(value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var written)
            ? written
            : null;
    }

    private static bool Flag(JsonElement entry, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (!entry.TryGetProperty(key, out var value))
                continue;

            return value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String => bool.TryParse(value.GetString(), out var written) && written,
                _ => false,
            };
        }

        return false;
    }

    /// <summary>A name with its case, spacing and punctuation taken out, for matching only.</summary>
    internal static string Spell(string name) =>
        Regex.Replace(name.Trim().ToLowerInvariant(), "[^a-z0-9]+", "");

    private static decimal Confidence(decimal? confidence) =>
        confidence is null ? 0 : Math.Round(Math.Clamp(confidence.Value, 0, 1), 2);

    private static string? Clean(string? text)
    {
        var trimmed = text?.Trim();

        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static string Text(string? value, int maxLength)
    {
        var text = (value ?? "").Trim();

        return text.Length <= maxLength ? text : text[..maxLength];
    }
}

// ── The wire shapes ────────────────────────────────────────────────────────────────────

public sealed record CategoriseRequest(List<CategoriseInput?>? Transactions, List<BudgetItemDto?>? Items);

public sealed record CategoriseInput(int Id, string? Name, string? Notes, decimal Amount, string? Type, DateOnly Date);

public sealed record CategoriseCandidate(int Id, string Name, string Notes, decimal Amount, string Type, string Date);

/// <summary>One payee, the item it goes to, and every transaction that shares its name.</summary>
public sealed record CategoriseGroup(
    string Payee,
    int? ItemId,
    string ItemName,
    bool IsNew,
    decimal Confidence,
    string Why,
    List<int> TransactionIds,
    bool FromHistory);

public sealed record CategoriseResponse(
    List<CategoriseGroup> Groups,
    List<string> NewItems,
    int Considered,
    int Payees,
    int FromHistory,
    int Unreadable,
    List<BudgetItemDto> Items)
{
    /// <summary>How many transactions the proposal covers, which is what the page applies.</summary>
    public int Covered => Groups.Sum(group => group.TransactionIds.Count);
}

/// <summary>One payee placed, before the rows behind it are attached.</summary>
internal sealed record CategoriseDecision(
    string Payee,
    int? ItemId,
    string ItemName,
    bool IsNew,
    decimal Confidence,
    string Why);
