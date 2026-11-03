namespace Folio.Api.Modules;

/// <summary>
/// One area of the API, and one app on the site.
///
/// A module owns its endpoints (<c>/api/{Name}/...</c>) and the tables behind them (a
/// schema of its own, created by its own numbered script). On the site it is a folder
/// under <c>src/modules</c> whose route is named after this <see cref="Name"/>, which
/// is how the home page finds a title and description for the page it links to.
///
/// Adding an area to Folio is a class implementing this interface plus a folder of
/// scripts: nothing else in the API has to know it exists, because the catalog finds
/// every implementation when the app starts.
/// </summary>
public interface IFolioModule
{
    /// <summary>The route segment and the module's own name: "folio" serves <c>/api/folio</c>.</summary>
    string Name { get; }

    /// <summary>What the site calls it on the home page.</summary>
    string Title { get; }

    /// <summary>One line under the title on the home page.</summary>
    string Description { get; }

    /// <summary>Anything the module's own endpoints need from the container.</summary>
    void AddServices(IServiceCollection services, IConfiguration configuration)
    {
    }

    /// <summary>The module's endpoints, grouped under <c>/api/{Name}</c>.</summary>
    void Map(RouteGroupBuilder api);
}
