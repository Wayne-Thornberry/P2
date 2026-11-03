using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Folio.Api.Data;
using Folio.Api.Http;

namespace Folio.Api.Modules.Core;

/// <summary>
/// Signs in, checks and signs out. Everything the rest of the API knows about who
/// is calling comes from here.
///
/// A token is 32 random bytes, base64url. Only its SHA-256 hash is stored, in
/// <c>core.Sessions</c>, so the token is worthless to anyone who can read the
/// database. Sessions slide: using one extends it, so a site you visit keeps
/// working and one you have not opened in a month quietly expires.
/// </summary>
public sealed class SessionService(
    FolioDbContext db,
    PasswordHasher hasher,
    IOptions<AuthOptions> options,
    TimeProvider clock)
{
    private readonly AuthOptions _options = options.Value;

    /// <summary>How often a session's expiry is pushed out, so a read is not a write.</summary>
    private static readonly TimeSpan SlideInterval = TimeSpan.FromHours(1);

    /// <summary>
    /// Returns a new token, or null when the credentials are wrong. The two failures
    /// are deliberately the same answer: which half was wrong is not the caller's
    /// business.
    /// </summary>
    public async Task<IssuedSession?> SignInAsync(string username, string password, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;

        // The only time an expired session costs anything is when nobody is looking
        // at it, so the sweep happens here rather than on a timer.
        await db.Sessions.Where(session => session.ExpiresAt < now).ExecuteDeleteAsync(cancellationToken);

        var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username, cancellationToken);

        if (user is null)
        {
            // Hash anyway: answering "no such user" at once and "wrong password"
            // after 200ms says which usernames exist.
            hasher.Hash(password);
            return null;
        }

        if (!hasher.Verify(password, user.PasswordHash))
            return null;

        var token = NewToken();
        var session = new Session
        {
            TokenHash = HashToken(token),
            UserId = user.Id,
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.AddDays(_options.SessionDays),
        };

        db.Sessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);

        return new IssuedSession(token, session.ExpiresAt, new AuthenticatedUser(user.Id, user.Username));
    }

    /// <summary>The account behind a token, or null if the token is unknown or expired.</summary>
    public async Task<AuthenticatedUser?> ValidateAsync(string token, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var tokenHash = HashToken(token);

        var session = await db.Sessions
            .Include(session => session.User)
            .SingleOrDefaultAsync(session => session.TokenHash == tokenHash, cancellationToken);

        if (session is null || session.User is null || session.ExpiresAt <= now)
            return null;

        if (now - session.LastSeenAt > SlideInterval)
        {
            session.LastSeenAt = now;
            session.ExpiresAt = now.AddDays(_options.SessionDays);
            await db.SaveChangesAsync(cancellationToken);
        }

        return new AuthenticatedUser(session.User.Id, session.User.Username);
    }

    /// <summary>Forgets a token. Signing out twice is not an error.</summary>
    public async Task SignOutAsync(string token, CancellationToken cancellationToken)
    {
        var tokenHash = HashToken(token);

        await db.Sessions
            .Where(session => session.TokenHash == tokenHash)
            .ExecuteDeleteAsync(cancellationToken);
    }

    /// <summary>
    /// Replaces a password, given the current one, and hands back a fresh session.
    ///
    /// Every session is dropped first: a password change is the moment to assume whatever
    /// else holds a token should stop. The caller gets a new one, so the browser that
    /// changed it stays signed in and every other browser does not.
    /// </summary>
    /// <returns>The new session, or null when the current password is wrong.</returns>
    public async Task<IssuedSession?> ChangePasswordAsync(
        int userId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

        if (user is null || !hasher.Verify(currentPassword, user.PasswordHash))
            return null;

        return await ReplacePasswordAsync(user, newPassword, cancellationToken);
    }

    /// <summary>
    /// Replaces a forgotten password, given the recovery code from configuration.
    ///
    /// The code is compared in fixed time and the username is not confirmed: whoever asks,
    /// the answer is the same, so this cannot be used to find out which accounts exist.
    /// </summary>
    public async Task<PasswordReset> ResetPasswordAsync(
        string username,
        string recoveryCode,
        string newPassword,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_options.RecoveryCode))
            return PasswordReset.NotConfigured;

        var user = await db.Users.SingleOrDefaultAsync(u => u.Username == username, cancellationToken);

        // Hash both sides before comparing: the comparison is then fixed-length as well as
        // fixed-time, whatever was typed.
        var supplied = SHA256.HashData(Encoding.UTF8.GetBytes(recoveryCode.Trim()));
        var configured = SHA256.HashData(Encoding.UTF8.GetBytes(_options.RecoveryCode.Trim()));

        if (user is null || !CryptographicOperations.FixedTimeEquals(supplied, configured))
            return PasswordReset.Refused;

        await ReplacePasswordAsync(user, newPassword, cancellationToken);
        return PasswordReset.Done;
    }

    private async Task<IssuedSession> ReplacePasswordAsync(User user, string newPassword, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().UtcDateTime;

        user.PasswordHash = hasher.Hash(newPassword);

        // Everything signed in anywhere stops being signed in. Signing in again is one
        // step; leaving a token from before the change alive is the whole point of changing
        // a password.
        await db.Sessions.Where(session => session.UserId == user.Id).ExecuteDeleteAsync(cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        var token = NewToken();
        db.Sessions.Add(new Session
        {
            TokenHash = HashToken(token),
            UserId = user.Id,
            CreatedAt = now,
            LastSeenAt = now,
            ExpiresAt = now.AddDays(_options.SessionDays),
        });
        await db.SaveChangesAsync(cancellationToken);

        return new IssuedSession(token, now.AddDays(_options.SessionDays), new AuthenticatedUser(user.Id, user.Username));
    }

    private static string NewToken() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

/// <summary>What came of a reset attempt. Two of them look identical to the caller.</summary>
public enum PasswordReset
{
    /// <summary>No recovery code is configured, so a reset is not possible from outside.</summary>
    NotConfigured,

    /// <summary>Unknown username or wrong code -- deliberately the same answer.</summary>
    Refused,

    /// <summary>The password was replaced and every session dropped.</summary>
    Done,
}

/// <summary>A token handed to the browser, when it expires, and who it belongs to.</summary>
public sealed record IssuedSession(string Token, DateTime ExpiresAt, AuthenticatedUser User);
