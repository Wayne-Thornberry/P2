using System.Net.Http.Json;
using Folio.Api.Modules;

namespace Folio.Api.Tests;

/// <summary>
/// The portal draws its cards from this list, so it has to describe every module's
/// site correctly -- a wrong path is a card that goes nowhere.
/// </summary>
public sealed class ModuleCatalogApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [DatabaseFact]
    public async Task The_catalog_lists_the_folio_module_with_its_site_path()
    {
        var client = factory.CreateClient();

        var modules = await client.GetFromJsonAsync<List<ModuleSummary>>("/api/core/modules");

        var folio = Assert.Single(modules!, module => module.Name == "folio");
        Assert.NotEmpty(folio.Title);
        Assert.NotEmpty(folio.Description);
    }

    [DatabaseFact]
    public async Task The_catalog_does_not_offer_the_portal_to_itself()
    {
        var client = factory.CreateClient();

        var modules = await client.GetFromJsonAsync<List<ModuleSummary>>("/api/core/modules");

        Assert.DoesNotContain(modules!, module => module.Name == "core");
    }
}
