using System.Security.Cryptography;
using System.Text;

namespace Folio.Api.Auth;

/// <summary>
/// PBKDF2-SHA256, a fresh salt per secret, and a comparison that does not leak how much
/// of a guess was right.
///
/// A password and a PIN are the same kind of thing here: a short secret that is never
/// stored, only its hash. The cost is high enough that guessing offline is slow, and low
/// enough that signing in is instant.
/// </summary>
public static class SecretHasher
{
    private const int Iterations = 210_000;

    public const int SaltBytes = 16;

    public const int HashBytes = 32;

    public static (byte[] Hash, byte[] Salt) Hash(string secret)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);

        return (Derive(secret, salt), salt);
    }

    public static bool Matches(string? secret, byte[]? hash, byte[]? salt)
    {
        if (secret is null || hash is null || salt is null || hash.Length != HashBytes)
            return false;

        return CryptographicOperations.FixedTimeEquals(Derive(secret, salt), hash);
    }

    private static byte[] Derive(string secret, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(secret),
            salt,
            Iterations,
            HashAlgorithmName.SHA256,
            HashBytes);

    /// <summary>SHA-256, for the one thing that is hashed rather than stretched: a session token.</summary>
    public static byte[] Fingerprint(string token) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(token));
}
