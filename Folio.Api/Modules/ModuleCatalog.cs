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

    /// <summary>The modules, in name order.</summary>
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
}
