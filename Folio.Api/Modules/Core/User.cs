namespace Folio.Api.Modules.Core;

/// <summary>The account that signs in. One row, one person: this is a personal site.</summary>
public sealed class User
{
    public int Id { get; set; }

    public string Username { get; set; } = "";

    /// <summary>A PBKDF2 hash, salt and iteration count included. Never the password.</summary>
    public string PasswordHash { get; set; } = "";

    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// One signed-in browser.
///
/// Kept in the database rather than in the app's memory so that a deploy, which
/// recycles the app pool, does not sign anyone out of every module at once.
/// </summary>
public sealed class Session
{
    /// <summary>SHA-256 of the token, hex. The token itself is never stored.</summary>
    public string TokenHash { get; set; } = "";

    public int UserId { get; set; }

    public User? User { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime LastSeenAt { get; set; }

    public DateTime ExpiresAt { get; set; }
}
