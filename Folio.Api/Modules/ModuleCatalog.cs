using System.Reflection;

namespace Folio.Api.Modules;

/// <summary>
/// Every module in this assembly, found rather than listed.
///
/// The alternative is a line in Program.cs per module, which is one more thing to
/// forget when a module is copied into the repository. Reflection costs a few
/// milliseconds once at startup and makes "add a module" mean "add a class".
/// </summary>
public sealed class ModuleCatalog
{
    private ModuleCatalog(IReadOnlyList<IFolioModule> modules) => Modules = modules;

    /// <summary>The modules, in name order, which is the order the portal lists them.</summary>
    public IReadOnlyList<IFolioModule> Modules { get; }

    public static ModuleCatalog Discover()
    {
        var modules = Assembly.GetExecutingAssembly()
            .GetTypes()
            .Where(type => typeof(IFolioModule).IsAssignableFrom(type) && type is { IsAbstract: false, IsInterface: false })
            .Select(type => (IFolioModule)Activator.CreateInstance(type)!)
            .OrderBy(module => module.Name, StringComparer.Ordinal)
            .ToList();

        return new ModuleCatalog(modules);
    }

    /// <summary>
    /// What the site needs to draw its home page, and nothing more.
    ///
    /// Core is left out: signing in is the site's own front door, so offering it as one
    /// of the apps would be the page linking to itself.
    /// </summary>
    public IReadOnlyList<ModuleSummary> Summaries() =>
        Modules
            .Where(module => module.Name != Core.CoreModule.ModuleName)
            .Select(module => new ModuleSummary(module.Name, module.Title, module.Description))
            .ToList();
}

/// <summary>
/// A module as the home page sees it. The address is the site's business, not the
/// API's: the page serves a module at the route named after it.
/// </summary>
public sealed record ModuleSummary(string Name, string Title, string Description);
