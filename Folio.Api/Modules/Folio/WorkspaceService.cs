using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// Reads and writes the site's own collections.
///
/// The site keeps each area of its state as one aggregate -- accounts, transactions, the
/// budget, and so on -- and writes the whole aggregate when it changes, so this is where
/// an aggregate becomes rows and rows become an aggregate again. Every write replaces the
/// rows for one country inside a transaction, which is the only way a save that
/// half-succeeded could exist.
///
/// One file per collection, so a collection's mapping has somewhere to grow:
///
///   WorkspaceService.Settings.cs        the settings row, which is one per user
///   WorkspaceService.Workspace.cs       the whole workspace, and the list of countries
///   WorkspaceService.Accounts.cs        accounts, and the counters that number them
///   WorkspaceService.Transactions.cs    the transaction log
///   WorkspaceService.Upcoming.cs        transactions that have not happened yet
///   WorkspaceService.Budget.cs          items, their month and what is assigned to them
///   WorkspaceService.Template.cs        the budget template a new month is drawn from
///   WorkspaceService.SavingsGoals.cs    goals and their contributions
///   WorkspaceService.Finance.cs         loans and savings records
///   WorkspaceService.Planner.cs         the planner and its simulations
///   WorkspaceService.ImportHistory.cs   what was imported, and when
///   WorkspaceService.Shared.cs          the helpers every one of them uses
/// </summary>
public sealed partial class WorkspaceService(FolioDbContext db)
{
}