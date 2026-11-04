using Folio.Api.Modules;

namespace Folio.Api.Tests;

/// <summary>
/// What every module has to be, without a database in the way.
///
/// A module's name is both its API route and its page route, so the shape is checked
/// rather than assumed.
/// </summary>
public sealed class ModuleContractTests
{
    private static readonly ModuleCatalog Catalog = ModuleCatalog.Discover();

    [Fact]
    public void There_is_at_least_one_module()
    {
        Assert.NotEmpty(Catalog.Modules);
    }

    [Fact]
    public void Every_module_name_is_a_url_segment()
    {
        // The name is both the API route and the site's route, so it has to survive
        // being one: no slashes, no spaces, and the same in both directions.
        Assert.All(Catalog.Modules, module =>
        {
            Assert.Matches("^[a-z][a-z0-9]*$", module.Name);
        });
    }

    [Fact]
    public void Module_names_are_unique_because_they_are_routes()
    {
        var names = Catalog.Modules.Select(module => module.Name).ToList();

        Assert.Equal(names.Count, names.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void The_folio_module_is_registered()
    {
        Assert.Contains(Catalog.Modules, module => module.Name == "folio");
    }
}
