using System.Security.Cryptography;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Auth;

/// <summary>
/// The cookie and the row behind it.
///
/// A sign-in mints 32 random bytes for the browser and keeps only their SHA-256, so the
/// table cannot be replayed as a set of working sessions. The cookie itself is HttpOnly:
/// the page never reads it, which is what keeps a stray script from carrying it off.
/// </summary>
public sealed class SessionService(FolioDbContext db, TimeProvider clock)
{
    public const string CookieName = "folio_session";

    /// <summary>Long enough to forget about signing in, short enough to expire on its own.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    /// <summary>Starts a session for this account and hands back the token for the cookie.</summary>
    public async Task<string> StartAsync(AuthUser user, CancellationToken cancellationToken)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var now = clock.GetUtcNow().UtcDateTime;

        db.AuthSessions.Add(new AuthSession
        {
            UserId = user.Id,
            TokenHash = SecretHasher.Fingerprint(token),
            CreatedAt = now,
            ExpiresAt = now.Add(Lifetime),
            LastSeenAt = now,
        });

        user.LastSignInAt = now;

        await db.SaveChangesAsync(cancellationToken);

        return token;
    }

    /// <summary>The account behind a token, or null when it is unknown, expired or revoked.</summary>
    public async Task<AuthUser?> ResolveAsync(string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(token))
            return null;

        var hash = SecretHasher.Fingerprint(token);
        var now = clock.GetUtcNow().UtcDateTime;

        var session = await db.AuthSessions
            .Include(row => row.User)
            .FirstOrDefaultAsync(row => row.TokenHash == hash, cancellationToken);

        if (session?.User is null)
            return null;

        if (session.ExpiresAt <= now)
        {
            // Expired sessions are cleared as they are met, so the table does not grow a
            // year of rows nobody will ever ask about again.
            db.AuthSessions.Remove(session);
            await db.SaveChangesAsync(cancellationToken);

            return null;
        }

        return session.User;
    }

    public async Task EndAsync(string? token, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(token))
            return;

        var hash = SecretHasher.Fingerprint(token);

        await db.AuthSessions
            .Where(row => row.TokenHash == hash)
            .ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Signs every other browser out. A password change is the end of whatever a stolen
    /// copy of the old one could do, which means the sessions it started go too.
    /// </summary>
    public async Task EndOthersAsync(int userId, string? keepToken, CancellationToken cancellationToken)
    {
        var keep = string.IsNullOrEmpty(keepToken) ? null : SecretHasher.Fingerprint(keepToken);

        await db.AuthSessions
            .Where(row => row.UserId == userId && row.TokenHash != keep)
            .ExecuteDeleteAsync(cancellationToken);
    }
}
