using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Planner ─────────────────────────────────────────────────────────────────────────

    private async Task<PlannerBlob?> ReadPlannerAsync(string country, CancellationToken cancellationToken)
    {
        var state = await db.PlannerState.AsNoTracking()
            .FirstOrDefaultAsync(row => row.Country == country, cancellationToken);

        var items = await db.PlannerItems.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var simulations = await db.PlannerSimulations.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var simulationItems = await db.PlannerSimulationItems.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (state is null && items.Count == 0 && simulations.Count == 0)
            return null;

        var bySimulation = simulationItems
            .GroupBy(row => row.SimulationId)
            .ToDictionary(group => group.Key, group => group
                .Select(row => new SimulationItemDto(
                    row.Id,
                    row.Name,
                    row.Amount,
                    row.Kind,
                    row.Source,
                    row.TransactionId,
                    row.PlannerItemId))
                .ToList());

        return new PlannerBlob(
            state?.Income,
            items.Select(row => new PlannerItemDto(row.Id, row.Name, row.Amount)).ToList(),
            simulations.Select(row => new SimulationDto(
                row.Id,
                row.Name,
                row.Month,
                bySimulation.TryGetValue(row.Id, out var list) ? list : [])).ToList(),
            state?.IdealSimulationId,
            await ReadCounterAsync(country, CounterNames.Planner, cancellationToken),
            await ReadCounterAsync(country, CounterNames.Simulations, cancellationToken),
            await ReadCounterAsync(country, CounterNames.SimulationItems, cancellationToken));
    }

    public async Task SavePlannerAsync(string country, PlannerBlob blob, CancellationToken cancellationToken)
    {
        var items = (blob.Items ?? [])
            .Select((item, index) => new PlannerItem
            {
                Country = country,
                Id = item.Id,
                Name = Text(item.Name, "Item", 100),
                Amount = item.Amount,
                SortOrder = index,
            })
            .ToList();

        var simulations = (blob.Simulations ?? [])
            .Select((simulation, index) => new PlannerSimulation
            {
                Country = country,
                Id = simulation.Id,
                Name = Text(simulation.Name, "Scenario", 100),
                Month = Text(simulation.Month, "0000-00", 7),
                SortOrder = index,
            })
            .ToList();

        var simulationItems = (blob.Simulations ?? [])
            .SelectMany(simulation => (simulation.Items ?? []).Select((item, index) => new PlannerSimulationItem
            {
                Country = country,
                Id = item.Id,
                SimulationId = simulation.Id,
                Name = Text(item.Name, "Item", 100),
                Amount = item.Amount,
                Kind = item.Kind == "income" ? "income" : "expense",
                Source = item.Source is "transaction" or "planner" or "custom" ? item.Source : "custom",
                TransactionId = item.TransactionId,
                PlannerItemId = item.PlannerItemId,
                SortOrder = index,
            }))
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.PlannerSimulationItems.Where(row => row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.PlannerSimulations.Where(row => row.Country == country), simulations, cancellationToken);
        await ReplaceAsync(db.PlannerItems.Where(row => row.Country == country), items, cancellationToken);

        db.PlannerSimulationItems.AddRange(simulationItems);

        var state = await db.PlannerState.FirstOrDefaultAsync(
            row => row.Country == country, cancellationToken);

        if (state is null)
        {
            state = new PlannerState { Country = country };
            db.PlannerState.Add(state);
        }

        state.Income = blob.Income ?? 0;
        state.IdealSimulationId = blob.IdealSimulationId;

        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(country, CounterNames.Planner, blob.NextId, cancellationToken);
        await SetCounterAsync(country, CounterNames.Simulations, blob.NextSimId, cancellationToken);
        await SetCounterAsync(country, CounterNames.SimulationItems, blob.NextSimItemId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }
}
