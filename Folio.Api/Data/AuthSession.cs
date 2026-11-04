namespace Folio.Api.Data;

/// <summary>
/// One browser that has signed in: the SHA-256 of the token its cookie carries, and how
/// long it may keep it.
/// </summary>
public sealed class AuthSession
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public byte[] TokenHash { get; set; } = [];

    public DateTime CreatedAt { get; set; }

    public DateTime ExpiresAt { get; set; }

    public DateTime LastSeenAt { get; set; }

    public AuthUser? User { get; set; }
}
