using System.Security.Cryptography;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Auth;

/// <summary>
/// Making accounts, and taking the first one up.
///
/// A database that has been deployed carries a placeholder account that owns everything
/// saved before there was anybody to own it. The first real account fills that row in, so
/// the budget that was already there belongs to it from its first sign-in.
/// </summary>
public sealed class AccountService(FolioDbContext db, TimeProvider clock)
{
    /// <summary>Whether anybody can sign in yet. Before this is true, the site offers to make the first account.</summary>
    public Task<bool> AnyClaimedAsync(CancellationToken cancellationToken) =>
        db.AuthUsers.AnyAsync(user => user.ClaimedAt != null, cancellationToken);

    /// <summary>
    /// The row the first account takes up: the placeholder when the database has one, and a
    /// new row when it does not.
    /// </summary>
    public async Task<AuthUser> FirstAccountAsync(string username, string password, CancellationToken cancellationToken)
    {
        var user = await db.AuthUsers
            .Where(row => row.ClaimedAt == null)
            .OrderBy(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var now = clock.GetUtcNow().UtcDateTime;
        var (hash, salt) = SecretHasher.Hash(password);

        if (user is null)
        {
            user = new AuthUser { Username = username, CreatedAt = now };
            db.AuthUsers.Add(user);
        }
        else
        {
            user.Username = username;
        }

        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        user.MustChangePassword = false;
        user.ClaimedAt = now;
        user.PasswordChangedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return user;
    }

    /// <summary>
    /// An account made on the box, for somebody else: it exists, its password is one that
    /// was handed over, and the site will not let it be used for anything until that has
    /// been replaced.
    /// </summary>
    public async Task<(AuthUser User, string Password)> CreateWithOneTimePasswordAsync(
        string username,
        CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var password = OneTimePassword();
        var (hash, salt) = SecretHasher.Hash(password);

        // A box with a budget and no accounts yet: the new account takes up the placeholder
        // rather than leaving its rows owned by nobody.
        var user = await db.AuthUsers
            .Where(row => row.ClaimedAt == null)
            .OrderBy(row => row.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (user is null)
        {
            user = new AuthUser { CreatedAt = now };
            db.AuthUsers.Add(user);
        }

        user.Username = username;
        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        user.MustChangePassword = true;
        user.ClaimedAt = now;
        user.PasswordChangedAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return (user, password);
    }

    /// <summary>Whether the name is free, or already somebody's.</summary>
    public Task<bool> UsernameTakenAsync(string username, CancellationToken cancellationToken) =>
        db.AuthUsers.AnyAsync(user => user.Username == username && user.ClaimedAt != null, cancellationToken);

    /// <summary>
    /// A password to hand over rather than remember: three groups of four from an alphabet
    /// with no O, no 0, no I and no 1, so it can be read out and typed without a mistake.
    /// </summary>
    public static string OneTimePassword()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var letters = new char[12];

        for (var i = 0; i < letters.Length; i++)
            letters[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];

        return $"{new string(letters, 0, 4)}-{new string(letters, 4, 4)}-{new string(letters, 8, 4)}";
    }
}
