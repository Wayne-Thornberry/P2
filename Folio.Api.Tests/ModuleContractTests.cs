using Folio.Api.Modules;

namespace Folio.Api.Tests;

/// <summary>
/// What every module has to be, without a database in the way.
///
/// A module's <c>Path</c> is the one value in two places -- here and in its Vue
/// project's <c>vite.config.ts</c> <c>base</c> -- so the shape is checked rather than
/// assumed: a path without a trailing slash is a page whose assets 404.
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
    public void Every_module_describes_itself()
    {
        Assert.All(Catalog.Modules, module =>
        {
            Assert.False(string.IsNullOrWhiteSpace(module.Name), "A module needs a name: it is its route.");
            Assert.False(string.IsNullOrWhiteSpace(module.Title), $"{module.Name} needs a title.");
            Assert.False(string.IsNullOrWhiteSpace(module.Description), $"{module.Name} needs a description.");
        });
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

    [Fact]
    public void The_site_is_not_offered_as_an_app()
    {
        Assert.DoesNotContain(Catalog.Summaries(), module => module.Name == "core");
    }
}
