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
/// The model is given the items that already exist and told to use one of them wherever it
/// can: a budget with forty near-duplicate items is worse than one with ten honest ones, so
/// a new item is a last resort and the API is what decides whether one is allowed. Nothing
/// is saved here either — the answer is a proposal, and the site applies it to the budget
/// it already holds, which is the only way a save goes through the one path that saves.
/// </summary>
public sealed class CategoriseService(FolioDbContext db, CurrentUser me, DeepSeekClient ai)
{
    /// <summary>
    /// How many transactions one ask may carry. A year of statements is thousands of rows;
    /// the page sends what is selected, and "everything uncategorised" is capped so the
    /// request stays a request rather than a batch nobody is watching.
    /// </summary>
    public const int MaxTransactions = 200;

    /// <summary>
    /// How many items one ask may invent. Enough for a new habit to show up, few enough
    /// that a muddled answer cannot litter the budget.
    /// </summary>
    public const int MaxNewItems = 8;

    private const int NameMaxLength = 100;

    private const string SystemPrompt = """
        You sort personal-budget transactions into budget items.

        You are given the items that already exist, and a list of transactions. For each
        transaction, choose the item it belongs to, judging by the transaction's name and
        by its notes.

        Rules:
        - Prefer an existing item, matched by name exactly as it is written. Reuse is the
          point: if "Groceries" is close enough, use "Groceries".
        - Only invent an item when nothing that exists fits. At most the stated number of
          new items, and each one must be a category a household would keep for months —
          not a merchant, not a one-off, not a sentence.
        - A transaction may be left out when you genuinely cannot tell. Do not guess.
        - A refund and a purchase belong to the same item. Income belongs to whatever item
          describes where it came from.
        - Confidence is a number from 0 to 1.

        Answer with one JSON object, exactly this shape and no other keys:
        {
          "assignments": [ { "id": 12, "item": "Groceries", "new": false, "confidence": 0.92, "why": "supermarket" } ],
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
            return new CategoriseResponse([], [], [], 0, items);

        var answer = await AskAsync(items, candidates, cancellationToken);
        var (assignments, newItems, unmatched) = FromAnswer(answer, candidates, items);

        return new CategoriseResponse(assignments, newItems, unmatched, candidates.Count, items);
    }

    /// <summary>
    /// What was selected, or — when nothing was — everything in this country the site has
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
        IReadOnlyList<CategoriseCandidate> candidates,
        CancellationToken cancellationToken)
    {
        var question = new StringBuilder()
            .AppendLine($"Existing items: {JsonSerializer.Serialize(items.Select(item => new { id = item.Id, name = item.Name }))}")
            .AppendLine($"You may add at most {MaxNewItems} new items.")
            .AppendLine("Transactions:")
            .AppendLine(JsonSerializer.Serialize(candidates.Select(row => new
            {
                id = row.Id,
                name = row.Name,
                notes = row.Notes,
                amount = row.Amount,
                type = row.Type,
                date = row.Date,
            })))
            .ToString();

        return await ai.AskForJsonAsync(SystemPrompt, question, DeepSeekClient.CategoriseTokens, cancellationToken);
    }

    /// <summary>
    /// The model's JSON read against what was actually asked: an id nobody sent is ignored,
    /// a name that is an item by any reasonable spelling becomes that item, and only then
    /// is a new one allowed. Separate from the call so a test can hand it any answer.
    /// </summary>
    internal static (List<CategoriseAssignment> Assignments, List<string> NewItems, List<int> Unmatched) FromAnswer(
        string answer,
        IReadOnlyList<CategoriseCandidate> candidates,
        IReadOnlyList<BudgetItemDto> items)
    {
        ModelAnswer? parsed;

        try
        {
            parsed = JsonSerializer.Deserialize<ModelAnswer>(answer, Reading);
        }
        catch (JsonException)
        {
            return ([], [], candidates.Select(row => row.Id).ToList());
        }

        var known = candidates.Select(row => row.Id).ToHashSet();
        var bySpelling = items
            .GroupBy(item => Spell(item.Name), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        var assignments = new List<CategoriseAssignment>();
        var newItems = new List<string>();
        var taken = new HashSet<int>();

        foreach (var proposed in parsed?.Assignments ?? [])
        {
            if (proposed is null || proposed.Id is not { } id || !known.Contains(id) || !taken.Add(id))
                continue;

            var name = Clean(proposed.Item);

            if (name is null)
                continue;

            if (bySpelling.TryGetValue(Spell(name), out var existing))
            {
                assignments.Add(new CategoriseAssignment(
                    id,
                    existing.Id,
                    existing.Name,
                    IsNew: false,
                    Confidence(proposed.Confidence),
                    Clean(proposed.Why) ?? ""));

                continue;
            }

            // A name nothing matches is only an item if the model said it was inventing
            // one, and only while the budget can still afford another.
            if (proposed.New != true || newItems.Count >= MaxNewItems)
                continue;

            var proposedName = name.Length <= NameMaxLength ? name : name[..NameMaxLength];

            if (newItems.Contains(proposedName, StringComparer.OrdinalIgnoreCase))
            {
                assignments.Add(new CategoriseAssignment(
                    id,
                    null,
                    newItems.First(item => string.Equals(item, proposedName, StringComparison.OrdinalIgnoreCase)),
                    IsNew: true,
                    Confidence(proposed.Confidence),
                    Clean(proposed.Why) ?? ""));

                continue;
            }

            newItems.Add(proposedName);
            assignments.Add(new CategoriseAssignment(
                id,
                null,
                proposedName,
                IsNew: true,
                Confidence(proposed.Confidence),
                Clean(proposed.Why) ?? ""));
        }

        var unmatched = candidates
            .Select(row => row.Id)
            .Where(id => assignments.All(assignment => assignment.TransactionId != id))
            .ToList();

        return (assignments, newItems, unmatched);
    }

    private static readonly JsonSerializerOptions Reading = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>A name with its case, spacing and punctuation taken out, for matching only.</summary>
    private static string Spell(string name) =>
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

    private sealed record ModelAnswer(List<ModelAssignment?>? Assignments, List<string?>? NewItems);

    private sealed record ModelAssignment(int? Id, string? Item, bool? New, decimal? Confidence, string? Why);
}

// ── The wire shapes ────────────────────────────────────────────────────────────────────

public sealed record CategoriseRequest(List<CategoriseInput?>? Transactions, List<BudgetItemDto?>? Items);

public sealed record CategoriseInput(int Id, string? Name, string? Notes, decimal Amount, string? Type, DateOnly Date);

public sealed record CategoriseCandidate(int Id, string Name, string Notes, decimal Amount, string Type, string Date);

public sealed record CategoriseResponse(
    List<CategoriseAssignment> Assignments,
    List<string> NewItems,
    List<int> Unmatched,
    int Considered,
    List<BudgetItemDto> Items);

public sealed record CategoriseAssignment(
    int TransactionId,
    int? ItemId,
    string ItemName,
    bool IsNew,
    decimal Confidence,
    string Why);
