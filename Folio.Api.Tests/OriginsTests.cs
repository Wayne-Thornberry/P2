using Folio.Api.Http;

namespace Folio.Api.Tests;

/// <summary>
/// Which pages may call the API.
///
/// It is the sort of rule that is never wrong until it is: a mistake here refuses every
/// request the site makes, and the browser says only "CORS error". So the addresses a home
/// box is reached by are written down as tests -- and so are the ones it must not answer.
/// </summary>
public sealed class OriginsTests
{
    private static readonly string[] None = [];

    [Theory]
    [InlineData("http://localhost:5420")]
    [InlineData("http://127.0.0.1:5420")]
    [InlineData("http://[::1]:5420")]
    [InlineData("http://192.168.1.20:5420")]
    [InlineData("http://10.0.0.5")]
    [InlineData("http://172.16.0.1")]
    [InlineData("http://172.31.255.254:8080")]
    public void A_page_on_the_home_network_is_allowed(string origin)
    {
        Assert.True(Origins.IsAllowed(origin, None), $"{origin} should be allowed.");
    }

    [Theory]
    [InlineData("http://example.com")]
    [InlineData("https://budget.example.com:5420")]

    // 172.16/12 ends at 172.31: the neighbours belong to someone else.
    [InlineData("http://172.15.0.1")]
    [InlineData("http://172.32.0.1")]
    [InlineData("http://192.169.1.20")]
    public void A_page_somewhere_else_is_refused(string origin)
    {
        Assert.False(Origins.IsAllowed(origin, None), $"{origin} should be refused.");
    }

    [Fact]
    public void The_origin_the_deploy_names_is_allowed()
    {
        var configured = new[] { "http://box.tailnet.ts.net:5420" };

        Assert.True(Origins.IsAllowed("http://box.tailnet.ts.net:5420", configured));
    }

    [Fact]
    public void A_named_origin_is_matched_without_caring_about_case()
    {
        var configured = new[] { "http://box:5420" };

        Assert.True(Origins.IsAllowed("HTTP://BOX:5420", configured));
    }

    [Fact]
    public void Another_port_is_another_origin()
    {
        var configured = new[] { "http://box:5420" };

        Assert.False(Origins.IsAllowed("http://box:5421", configured));
    }

    [Fact]
    public void Another_scheme_is_another_origin()
    {
        var configured = new[] { "http://box:5420" };

        Assert.False(Origins.IsAllowed("https://box:5420", configured));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not an origin")]
    [InlineData("/api/folio")]
    public void Something_that_is_not_an_origin_is_refused(string? origin)
    {
        Assert.False(Origins.IsAllowed(origin, None));
    }

    [Fact]
    public void An_origin_with_no_host_is_not_a_private_one()
    {
        Assert.False(Origins.IsPrivateHost(null));
        Assert.False(Origins.IsPrivateHost(""));
        Assert.False(Origins.IsPrivateHost("172"));
        Assert.False(Origins.IsPrivateHost("172."));
    }
}
