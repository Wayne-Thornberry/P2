using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Folio.Api.Tests;

/// <summary>
/// The mock the site runs against, held to the API's answers.
///
/// Every sum the API works out -- the health score, the dashboard, the finance summary --
/// is written twice: once in C# and once in <c>Folio.Web/mocks/server.mjs</c>, because a
/// local run can serve the site from the mock instead of the database. Two implementations
/// of one rule drift, and the mock's is the one nobody notices: the site looks right all
/// day and is wrong on the box.
///
/// So the mock is the fixture. Its own workspace is read out of it, written into a real
/// database, and then the same questions are asked of both. A change to one side that the
/// other does not follow fails here.
/// </summary>
public sealed class MockParityTests(ApiFactory factory) : IClassFixture<ApiFactory>, IDisposable
{
    /// <summary>The collection the API test database is filled under.</summary>
    private const string Country = "parity";

    private static readonly Dictionary<string, string> Collections = new()
    {
        ["folio_accounts"] = "accounts",
        ["folio_transactions"] = "transactions",
        ["folio_upcoming"] = "upcoming",
        ["folio_budget"] = "budget",
        ["folio_template"] = "template",
        ["folio_savings_goals"] = "savings-goals",
        ["folio_finance"] = "finance",
        ["folio_planner"] = "planner",
        ["folio_import_history"] = "import-history",
    };

    private readonly NodeMock _mock = new();

    [MockParityFact]
    public async Task The_health_score_is_the_same_on_both_sides()
    {
        var api = await factory.CreateSignedInClientAsync();
        await SeedAsync(api);

        var month = ThisMonth();

        var expected = await _mock.GetAsync($"/api/folio/health?country=ireland&month={month}");
        var actual = await api.GetFromJsonAsync<JsonNode>($"/api/folio/health?country={Country}&month={month}");

        AssertSameJson(expected, actual, "health");
    }

    [MockParityFact]
    public async Task The_dashboard_is_the_same_on_both_sides()
    {
        var api = await factory.CreateSignedInClientAsync();
        await SeedAsync(api);

        var month = ThisMonth();

        var expected = await _mock.GetAsync($"/api/folio/dashboard?country=ireland&month={month}&budgetMonth={month}");
        var actual = await api.GetFromJsonAsync<JsonNode>($"/api/folio/dashboard?country={Country}&month={month}&budgetMonth={month}");

        AssertSameJson(expected, actual, "dashboard");
    }

    [MockParityFact]
    public async Task The_finance_summary_is_the_same_on_both_sides()
    {
        var api = await factory.CreateSignedInClientAsync();

        // The example budget has no loans or savings, so one of each goes in first: an
        // empty list would agree with an empty list and prove nothing about the
        // amortisation.
        var finance = JsonNode.Parse("""
            {
              "loans": [
                { "id": 1, "name": "Car loan", "principal": 12000, "apr": 4.5, "termMonths": 36,
                  "startDate": "2025-04-01", "color": "#ef4444", "createdAt": "2025-04-01T09:00:00Z", "archived": false }
              ],
              "savings": [
                { "id": 1, "name": "Rainy day", "apr": 3, "compoundFreq": "quarterly", "startBalance": 2500,
                  "startDate": "2025-02-01", "linkedAccountId": "acc-2", "color": "#10b981",
                  "createdAt": "2025-02-01T09:00:00Z", "archived": false }
              ],
              "nextLoanId": 2,
              "nextSavId": 2
            }
            """)!;

        var put = await _mock.PutAsync("/api/folio/finance?country=ireland", finance);
        put.EnsureSuccessStatusCode();

        await SeedAsync(api);

        var expected = await _mock.GetAsync("/api/folio/finance/summary?country=ireland");
        var actual = await api.GetFromJsonAsync<JsonNode>($"/api/folio/finance/summary?country={Country}");

        AssertSameJson(expected, actual, "finance");

        // And the summary is not empty, which is the point of putting a loan in.
        Assert.Single(actual!["loans"]!.AsArray());
        Assert.Single(actual["savings"]!.AsArray());
    }

    [MockParityFact]
    public async Task The_workspace_survives_the_round_trip_unchanged()
    {
        var api = await factory.CreateSignedInClientAsync();
        await SeedAsync(api);

        var expected = await _mock.GetAsync("/api/folio/workspace?country=ireland");
        var actual = await api.GetFromJsonAsync<JsonNode>($"/api/folio/workspace?country={Country}");

        AssertSameJson(expected, actual, "workspace");
    }

    /// <summary>
    /// Copies what the mock holds into the API's database, through the same endpoints the
    /// site uses -- so the API's rows are the mock's rows, and any difference in the
    /// answers is a difference in the arithmetic.
    /// </summary>
    private async Task SeedAsync(HttpClient api)
    {
        var settings = await _mock.GetAsync("/api/folio/settings") as JsonObject;
        var workspace = await _mock.GetAsync("/api/folio/workspace?country=ireland") as JsonObject
            ?? throw new InvalidOperationException("The mock answered no workspace.");

        var put = await api.PutAsJsonAsync("/api/folio/settings", settings);
        put.EnsureSuccessStatusCode();

        foreach (var (blob, endpoint) in Collections)
        {
            if (workspace[blob] is not { } collection)
                continue;

            put = await api.PutAsJsonAsync($"/api/folio/{endpoint}?country={Country}", collection);
            put.EnsureSuccessStatusCode();
        }
    }

    private static string ThisMonth()
    {
        var now = DateTime.Today;

        return $"{now.Year}-{now.Month:00}";
    }

    // ── Comparing the two answers ───────────────────────────────────────────────────────

    private static void AssertSameJson(JsonNode? expected, JsonNode? actual, string because)
    {
        Compare(expected, actual, "$", because);
    }

    private static void Compare(JsonNode? expected, JsonNode? actual, string path, string because)
    {
        if (expected is null || actual is null)
        {
            Assert.True(expected is null && actual is null, $"{because}: {path} is {Describe(actual)} here and {Describe(expected)} there.");

            return;
        }

        switch (expected)
        {
            case JsonObject left when actual is JsonObject right:
                CompareKeys(left, right, path, because);

                foreach (var (key, value) in left)
                    Compare(value, right[key], $"{path}.{key}", because);

                return;

            case JsonArray left when actual is JsonArray right:
                Assert.True(
                    left.Count == right.Count,
                    $"{because}: {path} has {right.Count} entries here and {left.Count} there.");

                for (var index = 0; index < left.Count; index++)
                    Compare(left[index], right[index], $"{path}[{index}]", because);

                return;

            default:
                // Numbers are compared by value, because 3200 and 3200.0 are one number
                // written two ways and only the JSON writer's mood decides which.
                if (TryNumber(expected, out var leftNumber) && TryNumber(actual, out var rightNumber))
                {
                    Assert.True(
                        leftNumber == rightNumber,
                        $"{because}: {path} is {rightNumber} here and {leftNumber} there.");

                    return;
                }

                // Timestamps are compared as instants for the same reason: the API writes
                // "…T14:38:00Z" and the mock echoes "…T14:38:00.000Z", and both are the
                // same afternoon.
                if (TryMoment(expected, out var leftMoment) && TryMoment(actual, out var rightMoment))
                {
                    Assert.True(
                        leftMoment == rightMoment,
                        $"{because}: {path} is {rightMoment:O} here and {leftMoment:O} there.");

                    return;
                }

                Assert.True(
                    JsonNode.DeepEquals(expected, actual),
                    $"{because}: {path} is {actual.ToJsonString()} here and {expected.ToJsonString()} there.");

                return;
        }
    }

    private static void CompareKeys(JsonObject expected, JsonObject actual, string path, string because)
    {
        var missing = expected.Select(pair => pair.Key).Except(actual.Select(pair => pair.Key)).ToList();
        var extra = actual.Select(pair => pair.Key).Except(expected.Select(pair => pair.Key)).ToList();

        Assert.True(missing.Count == 0, $"{because}: {path} is missing {string.Join(", ", missing)}.");
        Assert.True(extra.Count == 0, $"{because}: {path} has {string.Join(", ", extra)} that the mock does not.");
    }

    private static bool TryNumber(JsonNode node, out decimal value)
    {
        value = 0;

        if (node is not JsonValue || !node.AsValue().TryGetValue<JsonElement>(out var element))
            return false;

        if (element.ValueKind != JsonValueKind.Number)
            return false;

        value = element.GetDecimal();
        return true;
    }

    private static bool TryMoment(JsonNode node, out DateTimeOffset value)
    {
        value = default;

        if (node is not JsonValue || !node.AsValue().TryGetValue<JsonElement>(out var element))
            return false;

        if (element.ValueKind != JsonValueKind.String)
            return false;

        return DateTimeOffset.TryParse(
            element.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out value);
    }

    private static string Describe(JsonNode? node) => node is null ? "absent" : node.ToJsonString();

    public void Dispose() => _mock.Dispose();

    /// <summary>
    /// The site's own fake API, started as a child process on a port of its own.
    ///
    /// It is the repository's mock rather than a copy, so the thing under test is the file
    /// a local run actually uses.
    /// </summary>
    private sealed class NodeMock : IDisposable
    {
        /// <summary>The one account the fake API has, and the password this test gives it.</summary>
        public const string Username = "wayne";

        public const string Password = "mock-parity-password";

        private readonly Process _process;
        private readonly HttpClient _client;

        public NodeMock()
        {
            var (web, port) = Locate();

            var start = new ProcessStartInfo("node", "mocks/server.mjs")
            {
                WorkingDirectory = web,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            start.Environment["MOCK_PORT"] = port.ToString(CultureInfo.InvariantCulture);
            start.Environment["MOCK_PASSWORD"] = Password;

            _process = Process.Start(start)
                ?? throw new InvalidOperationException("The mock could not be started: is node installed?");

            // The cookie the mock hands out on signing in is the whole of what a signed-in
            // client is, so the handler keeps it for every request that follows.
            _client = new HttpClient(
                new HttpClientHandler { CookieContainer = new System.Net.CookieContainer() })
            {
                BaseAddress = new Uri($"http://127.0.0.1:{port}"),
                Timeout = TimeSpan.FromSeconds(30),
            };

            WaitUntilAnswering();
            SignIn();
        }

        public async Task<JsonNode?> GetAsync(string path)
        {
            using var response = await _client.GetAsync(path);
            var body = await response.Content.ReadAsStringAsync();

            Assert.True(response.IsSuccessStatusCode, $"The mock refused {path}: {(int)response.StatusCode} {body}");

            return JsonNode.Parse(body);
        }

        /// <summary>Writes a collection into the mock, as the site does.</summary>
        public Task<HttpResponseMessage> PutAsync(string path, JsonNode body) =>
            _client.PutAsJsonAsync(path, body);

        /// <summary>Signs in, so the requests that follow are somebody's.</summary>
        private void SignIn()
        {
            using var response = _client
                .PostAsJsonAsync("/api/auth/signin", new { username = Username, password = Password })
                .GetAwaiter()
                .GetResult();

            var body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();

            Assert.True(response.IsSuccessStatusCode, $"The mock refused the sign-in: {(int)response.StatusCode} {body}");
        }

        /// <summary>Where Folio.Web is, and a port nothing else has taken.</summary>
        private static (string Web, int Port) Locate()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);

            while (directory is not null)
            {
                var web = Path.Combine(directory.FullName, "Folio.Web");

                if (File.Exists(Path.Combine(web, "mocks", "server.mjs")))
                    return (web, FreePort());

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                $"Could not find Folio.Web/mocks/server.mjs above {AppContext.BaseDirectory}.");
        }

        private static int FreePort()
        {
            using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
            listener.Start();

            return ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        }

        private void WaitUntilAnswering()
        {
            var deadline = DateTime.UtcNow.AddSeconds(30);

            while (DateTime.UtcNow < deadline)
            {
                if (_process.HasExited)
                {
                    throw new InvalidOperationException(
                        $"The mock stopped before answering: {_process.StandardError.ReadToEnd()}");
                }

                try
                {
                    using var health = _client.GetAsync("/api/health").GetAwaiter().GetResult();

                    if (health.IsSuccessStatusCode)
                        return;
                }
                catch (HttpRequestException)
                {
                    // Still starting.
                }

                Thread.Sleep(200);
            }

            throw new TimeoutException("The mock never answered /api/health.");
        }

        public void Dispose()
        {
            _client.Dispose();

            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
                _process.WaitForExit(5000);
            }

            _process.Dispose();
        }
    }
}
