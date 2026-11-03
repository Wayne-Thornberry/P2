namespace Folio.Api.Modules.Core;

/// <summary>What the API needs to know about signing in, from the <c>Auth</c> section.</summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";

    public string SeedUsername { get; set; } = "wayne";

    /// <summary>
    /// The password the account is created with, the first time the API runs against
    /// an empty database. Empty means no account is created, which is the safe
    /// default: a checkout never ships with a working login.
    /// </summary>
    public string SeedPassword { get; set; } = "";

    /// <summary>How long a session lasts, and how long it is renewed for on use.</summary>
    public int SessionDays { get; set; } = 30;

    /// <summary>
    /// Sign-in attempts allowed per caller per minute. The tests raise it, because a
    /// suite that signs in a dozen times would otherwise be refused by its own
    /// protection.
    /// </summary>
    public int SignInAttemptsPerMinute { get; set; } = 10;

    /// <summary>
    /// The word that lets a forgotten password be replaced from the sign-in page, when
    /// there is no way to reach the box. Long and random, and the same one every time,
    /// because the point is that you have it written down somewhere.
    ///
    /// Empty means the endpoint refuses: a site with no recovery code configured simply
    /// cannot be reset from the outside, which is the safe default.
    /// </summary>
    public string RecoveryCode { get; set; } = "";
}
