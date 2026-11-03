using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;

namespace Folio.Api.Tests;

/// <summary>
/// The rate limiter on the only endpoint a stranger can reach. It gets its own factory
/// because the limiter's budget belongs to the host: one attempt a minute here, rather
/// than the suite's raised allowance.
/// </summary>
public sealed class SignInThrottleApiTests(ThrottledApiFactory factory) : IClassFixture<ThrottledApiFactory>
{
    [DatabaseFact]
    public async Task Guessing_the_password_is_cut_off_after_the_allowance()
    {
        var client = factory.CreateClient();

        var first = await client.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = "wrong" });

        var second = await client.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = "wrong" });

        Assert.Equal(HttpStatusCode.Unauthorized, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
    }
}

/// <summary>One sign-in attempt a minute, so the limiter is reached inside a test.</summary>
public sealed class ThrottledApiFactory : ApiFactory
{
    protected override void ConfigureSettings(IWebHostBuilder builder) =>
        builder.UseSetting("Auth:SignInAttemptsPerMinute", "1");
}
