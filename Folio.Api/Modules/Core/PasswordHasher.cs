using System.Security.Cryptography;

namespace Folio.Api.Modules.Core;

/// <summary>
/// Passwords, hashed with PBKDF2-SHA256 and a random salt per password.
///
/// The format is <c>pbkdf2-sha256$iterations$salt$key</c>, all base64, so the
/// iteration count travels with the hash and can be raised later without
/// invalidating the passwords already stored.
/// </summary>
public sealed class PasswordHasher
{
    private const string Scheme = "pbkdf2-sha256";
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int KeySize = 32;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Derive(password, salt, Iterations, KeySize);

        return string.Join('$', Scheme, Iterations.ToString(), Convert.ToBase64String(salt), Convert.ToBase64String(key));
    }

    /// <summary>Whether the password matches the stored hash. A damaged hash is a non-match, not an error.</summary>
    public bool Verify(string password, string storedHash)
    {
        var parts = storedHash.Split('$');
        if (parts.Length != 4 || parts[0] != Scheme)
            return false;

        if (!int.TryParse(parts[1], out var iterations) || iterations < 1)
            return false;

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            if (expected.Length == 0)
                return false;

            var actual = Derive(password, salt, iterations, expected.Length);

            // Fixed-time: a comparison that stops at the first wrong byte tells an
            // attacker how much of the hash they guessed.
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static byte[] Derive(string password, byte[] salt, int iterations, int length) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, length);
}
