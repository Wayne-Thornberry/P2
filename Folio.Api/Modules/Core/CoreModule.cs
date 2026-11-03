namespace Folio.Api.Modules.Core;

/// <summary>
/// The list of apps the site offers.
///
/// This is the only module with no page and no tables of its own: the home page asks what
/// exists, and each answer is drawn by a folder under <c>Folio.Web/src/modules</c>.
///
/// There is no sign-in. This is a budget on a private box, used by one person, so an
/// account would only be a password in front of a door nobody else can reach.
/// </summary>
public sealed class CoreModule : IFolioModule
{
    public const string ModuleName = "core";

    public string Name => ModuleName;

    public string Title => "This site";

    public string Description => "The apps this site offers.";

    public void Map(RouteGroupBuilder api) =>
        api.MapGet("/modules", (ModuleCatalog catalog) => Results.Ok(catalog.Summaries()));
}
