namespace Folio.Api.Data;

/// <summary>
/// One person who may sign in.
///
/// The hashes are the whole of the secret: nothing here can be turned back into the
/// password or the PIN that produced it. <see cref="ClaimedAt"/> is what makes an account
/// real -- a row without it is the placeholder that owns a database's pre-account data.
/// </summary>
public sealed class AuthUser
{
    public int Id { get; set; }

    public string Username { get; set; } = string.Empty;

    public byte[] PasswordHash { get; set; } = [];

    public byte[] PasswordSalt { get; set; } = [];

    /// <summary>Set while the password is one somebody was handed rather than chose.</summary>
    public bool MustChangePassword { get; set; }

    public byte[]? PinHash { get; set; }

    public byte[]? PinSalt { get; set; }

    public int PinFailedCount { get; set; }

    public DateTime? PinLockedUntil { get; set; }

    /// <summary>When the account was taken up. Null on the placeholder, and only there.</summary>
    public DateTime? ClaimedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? PasswordChangedAt { get; set; }

    public DateTime? LastSignInAt { get; set; }

    public bool HasPin => PinHash is not null && PinSalt is not null;

    public bool IsClaimed => ClaimedAt is not null;
}
