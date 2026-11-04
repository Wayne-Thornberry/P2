namespace Folio.Api.Http;

/// <summary>
/// Which origins may call the API.
///
/// The site and the API are two origins, so the browser needs CORS and something has to
/// answer "is this page allowed". Two kinds of origin are: the one the deploy names in
/// <c>Cors:AllowedOrigins</c>, and any address on the home network, because a box is
/// reached by its LAN address, its hostname, and <c>localhost</c> on the box itself, at
/// different times and from different machines.
///
/// This is a rule, so it is here rather than inline in <c>Program.cs</c>: a mistake in it
/// is a site whose every request is refused, and that is worth a test.
/// </summary>
public static class Origins
{
    /// <summary>
    /// Whether an origin is allowed: named in the configuration, or a private address.
    ///
    /// <paramref name="origin"/> is what the browser sends in <c>Origin</c>, so it is
    /// scheme, host and port and nothing else -- a value that will not parse as one is a
    /// request that did not come from a page at all.
    /// </summary>
    public static bool IsAllowed(string? origin, IEnumerable<string> configured)
    {
        if (string.IsNullOrWhiteSpace(origin))
            return false;

        if (configured.Contains(origin, StringComparer.OrdinalIgnoreCase))
            return true;

        return Uri.TryCreate(origin, UriKind.Absolute, out var uri) && IsPrivateHost(uri.Host);
    }

    /// <summary>
    /// A host on the home network: loopback, or one of the three private ranges.
    ///
    /// This is deliberately a check on the address rather than a check on a list: the box
    /// answers on an address nobody wrote down, and 192.168.1.20 one week is 192.168.1.31
    /// the next.
    /// </summary>
    public static bool IsPrivateHost(string? host)
    {
        if (string.IsNullOrEmpty(host))
            return false;

        // An IPv6 host arrives in brackets -- "http://[::1]:5420" -- because that is how it
        // is written in an origin, and the brackets are not part of the address.
        var name = host.Trim('[', ']');

        if (name is "localhost" or "127.0.0.1" or "::1")
            return true;

        if (name.StartsWith("192.168.", StringComparison.Ordinal) || name.StartsWith("10.", StringComparison.Ordinal))
            return true;

        // 172.16.0.0 - 172.31.255.255, so the second octet decides and nothing else does.
        if (!name.StartsWith("172.", StringComparison.Ordinal))
            return false;

        var octets = name.Split('.');

        return octets.Length >= 2
            && int.TryParse(octets[1], out var second)
            && second is >= 16 and <= 31;
    }
}
