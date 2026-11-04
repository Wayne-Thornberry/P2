using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Savings goals ──────────────────────────────────────────────────────────────────

    private async Task<SavingsGoalsBlob?> ReadSavingsGoalsAsync(string country, CancellationToken cancellationToken)
    {
        var goals = await db.SavingsGoals.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var contributions = await db.SavingsContributions.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (goals.Count == 0)
            return null;

        var byGoal = contributions
            .GroupBy(row => row.GoalId)
            .ToDictionary(group => group.Key, group => group
                .Select(row => new ContributionDto(row.Id, row.Date, row.Amount, row.Note))
                .ToList());

        var dtos = goals
            .Select(row => new SavingsGoalDto(
                row.Id,
                row.Name,
                row.TargetAmount,
                row.Deadline,
                row.Color,
                row.LinkedAccountId,
                byGoal.TryGetValue(row.Id, out var list) ? list : [],
                Utc(row.CreatedAt),
                row.Archived))
            .ToList();

        return new SavingsGoalsBlob(
            dtos,
            await ReadCounterAsync(country, CounterNames.SavingsGoals, cancellationToken),
            await ReadCounterAsync(country, CounterNames.SavingsContributions, cancellationToken));
    }

    public async Task SaveSavingsGoalsAsync(string country, SavingsGoalsBlob blob, CancellationToken cancellationToken)
    {
        var goals = (blob.Goals ?? [])
            .Select((goal, index) => new SavingsGoal
            {
                UserId = me.Id,
                Country = country,
                Id = goal.Id,
                Name = Text(goal.Name, "Goal", 100),
                TargetAmount = goal.TargetAmount,
                Deadline = goal.Deadline,
                Color = Text(goal.Color, "#6366f1", 32),
                LinkedAccountId = Optional(goal.LinkedAccountId, 32),
                CreatedAt = UtcInput(goal.CreatedAt),
                Archived = goal.Archived,
                SortOrder = index,
            })
            .ToList();

        var contributions = (blob.Goals ?? [])
            .SelectMany(goal => (goal.Contributions ?? []).Select((contribution, index) => new SavingsContribution
            {
                UserId = me.Id,
                Country = country,
                Id = contribution.Id,
                GoalId = goal.Id,
                Date = contribution.Date,
                Amount = contribution.Amount,
                Note = Optional(contribution.Note, 500),
                SortOrder = index,
            }))
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // The contributions point at the goals, so they go first.
        await db.SavingsContributions.Where(row => row.UserId == me.Id && row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.SavingsGoals.Where(row => row.UserId == me.Id && row.Country == country), goals, cancellationToken);

        db.SavingsContributions.AddRange(contributions);
        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(country, CounterNames.SavingsGoals, blob.NextGoalId, cancellationToken);
        await SetCounterAsync(country, CounterNames.SavingsContributions, blob.NextContribId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }
}
