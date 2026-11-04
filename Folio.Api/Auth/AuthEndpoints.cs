using Folio.Api.Data;
using Folio.Api.Http;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Auth;

/// <summary>
/// Signing in, and the three ways a password gets set: claiming the first account, replacing
/// a one-time password, and setting a new one from the PIN when the old one is forgotten.
///
/// None of these sit behind the signed-in filter -- that would be a trap -- so each one says
/// for itself what it needs.
/// </summary>
public static class AuthEndpoints
{
    public static void Map(RouteGroupBuilder auth)
    {
        // What the page needs before anyone has signed in: whether to offer to make the
        // first account, or to ask for a password.
        auth.MapGet("/state", StateAsync);

        auth.MapPost("/claim", ClaimAsync);
        auth.MapPost("/signin", SignInAsync);
        auth.MapPost("/signout", SignOutAsync);
        auth.MapGet("/me", MeAsync);

        auth.MapPost("/password", ChangePasswordAsync);
        auth.MapPost("/pin", SetPinAsync);
        auth.MapPost("/reset", ResetAsync);
    }

    private static async Task<IResult> StateAsync(
        CurrentUser me,
        AccountService accounts,
        CancellationToken cancellationToken) =>
        Results.Ok(StateOf(me, await accounts.AnyClaimedAsync(cancellationToken)));

    /// <summary>
    /// The first account, made from the page because a box with no accounts has nobody who
    /// could be handed a password by the box. Only ever once: after this, accounts are made
    /// on the box, with a one-time password.
    /// </summary>
    private static async Task<IResult> ClaimAsync(
        ClaimRequest request,
        HttpContext context,
        CurrentUser me,
        AccountService accounts,
        SessionService sessions,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (await accounts.AnyClaimedAsync(cancellationToken))
            return ApiErrors.BadRequest("This site already has an account. Sign in instead.");

        if (AccountRules.UsernameProblem(request.Username) is { } usernameProblem)
            return ApiErrors.BadRequest(usernameProblem);

        if (AccountRules.PasswordProblem(request.Password, request.Username) is { } passwordProblem)
            return ApiErrors.BadRequest(passwordProblem);

        var user = await accounts.FirstAccountAsync(request.Username!.Trim(), request.Password!, cancellationToken);

        me.Adopt(user);
        await StartSessionAsync(user, context, sessions, clock, cancellationToken);

        return Results.Ok(StateOf(me, anyAccount: true));
    }

    private static async Task<IResult> SignInAsync(
        SignInRequest request,
        HttpContext context,
        CurrentUser me,
        FolioDbContext db,
        SessionService sessions,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var user = await FindAsync(request.Username, db, cancellationToken);

        // One sentence for both a name that is not here and a password that is wrong: which
        // of the two it was is not something a guess needs to be told.
        if (user is null || !SecretHasher.Matches(request.Password, user.PasswordHash, user.PasswordSalt))
            return ApiErrors.Unauthorized("That username and password do not match an account.");

        me.Adopt(user);
        await StartSessionAsync(user, context, sessions, clock, cancellationToken);

        return Results.Ok(StateOf(me, anyAccount: true));
    }

    private static async Task<IResult> SignOutAsync(
        HttpContext context,
        SessionService sessions,
        CancellationToken cancellationToken)
    {
        await sessions.EndAsync(context.Request.Cookies[SessionService.CookieName], cancellationToken);
        context.Response.Cookies.Delete(SessionService.CookieName, new CookieOptions { Path = "/" });

        return Results.NoContent();
    }

    private static async Task<IResult> MeAsync(
        CurrentUser me,
        AccountService accounts,
        CancellationToken cancellationToken) =>
        me.SignedIn
            ? Results.Ok(StateOf(me, await accounts.AnyClaimedAsync(cancellationToken)))
            : ApiErrors.Unauthorized("Not signed in.");

    /// <summary>
    /// A new password, given the old one. This is also how a one-time password is replaced:
    /// until it has been, the budget itself answers 403.
    /// </summary>
    private static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        HttpContext context,
        CurrentUser me,
        FolioDbContext db,
        SessionService sessions,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        if (!me.SignedIn)
            return ApiErrors.Unauthorized("Not signed in.");

        var user = await db.AuthUsers.FirstAsync(row => row.Id == me.Id, cancellationToken);

        if (!SecretHasher.Matches(request.CurrentPassword, user.PasswordHash, user.PasswordSalt))
            return ApiErrors.BadRequest("That is not the password this account has now.");

        if (AccountRules.PasswordProblem(request.NewPassword, user.Username) is { } problem)
            return ApiErrors.BadRequest(problem);

        if (string.Equals(request.NewPassword, request.CurrentPassword, StringComparison.Ordinal))
            return ApiErrors.BadRequest("The new password is the one it already has.");

        var (hash, salt) = SecretHasher.Hash(request.NewPassword!);

        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        user.MustChangePassword = false;
        user.PasswordChangedAt = clock.GetUtcNow().UtcDateTime;

        await db.SaveChangesAsync(cancellationToken);

        // Every other browser is signed out: changing a password is meant to end whatever
        // the old one could still do.
        await sessions.EndOthersAsync(user.Id, context.Request.Cookies[SessionService.CookieName], cancellationToken);

        me.Adopt(user);

        return Results.Ok(StateOf(me, anyAccount: true));
    }

    /// <summary>
    /// The PIN that replaces a forgotten password. Setting it costs the password, so a
    /// browser left signed in cannot quietly mint a second way into the account.
    /// </summary>
    private static async Task<IResult> SetPinAsync(
        SetPinRequest request,
        CurrentUser me,
        FolioDbContext db,
        CancellationToken cancellationToken)
    {
        if (!me.SignedIn)
            return ApiErrors.Unauthorized("Not signed in.");

        if (me.MustChangePassword)
            return ApiErrors.Forbidden("Choose your own password before setting a PIN.");

        var user = await db.AuthUsers.FirstAsync(row => row.Id == me.Id, cancellationToken);

        if (!SecretHasher.Matches(request.Password, user.PasswordHash, user.PasswordSalt))
            return ApiErrors.BadRequest("That is not this account's password.");

        if (AccountRules.PinProblem(request.Pin) is { } problem)
            return ApiErrors.BadRequest(problem);

        var (hash, salt) = SecretHasher.Hash(request.Pin!);

        user.PinHash = hash;
        user.PinSalt = salt;
        user.PinFailedCount = 0;
        user.PinLockedUntil = null;

        await db.SaveChangesAsync(cancellationToken);

        me.Adopt(user);

        return Results.Ok(StateOf(me, anyAccount: true));
    }

    /// <summary>
    /// A forgotten password, replaced by whoever knows the PIN. Six digits is a guessable
    /// thing, so wrong ones are counted and the fifth buys a wait rather than another try.
    /// </summary>
    private static async Task<IResult> ResetAsync(
        ResetRequest request,
        HttpContext context,
        CurrentUser me,
        FolioDbContext db,
        SessionService sessions,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var user = await FindAsync(request.Username, db, cancellationToken);

        // An account without a PIN cannot be reset from here at all, and saying which of the
        // two it was would tell a guesser that the name is real.
        if (user is null || !user.HasPin)
            return ApiErrors.Unauthorized("That username and PIN do not match an account.");

        var now = clock.GetUtcNow().UtcDateTime;

        if (user.PinLockedUntil is { } locked && locked > now)
        {
            var minutes = Math.Max(1, (int)Math.Ceiling((locked - now).TotalMinutes));

            return ApiErrors.Of(
                $"Too many wrong PINs. Try again in {minutes} minute{(minutes == 1 ? "" : "s")}.",
                StatusCodes.Status429TooManyRequests);
        }

        if (!SecretHasher.Matches(request.Pin, user.PinHash, user.PinSalt))
        {
            user.PinFailedCount++;

            if (user.PinFailedCount >= AccountRules.PinAttemptsBeforeLockout)
            {
                user.PinFailedCount = 0;
                user.PinLockedUntil = now.Add(AccountRules.PinLockout);
            }

            await db.SaveChangesAsync(cancellationToken);

            return ApiErrors.Unauthorized("That username and PIN do not match an account.");
        }

        if (AccountRules.PasswordProblem(request.NewPassword, user.Username) is { } problem)
            return ApiErrors.BadRequest(problem);

        var (hash, salt) = SecretHasher.Hash(request.NewPassword!);

        user.PasswordHash = hash;
        user.PasswordSalt = salt;
        user.MustChangePassword = false;
        user.PasswordChangedAt = now;
        user.PinFailedCount = 0;
        user.PinLockedUntil = null;

        await db.SaveChangesAsync(cancellationToken);

        // Whoever was signed in with the password that has just been replaced loses it.
        await sessions.EndOthersAsync(user.Id, keepToken: null, cancellationToken);

        me.Adopt(user);
        await StartSessionAsync(user, context, sessions, clock, cancellationToken);

        return Results.Ok(StateOf(me, anyAccount: true));
    }

    /// <summary>An account somebody can sign in as: taken up, never the placeholder.</summary>
    private static Task<AuthUser?> FindAsync(
        string? username,
        FolioDbContext db,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(username)
            ? Task.FromResult<AuthUser?>(null)
            : db.AuthUsers.FirstOrDefaultAsync(
                row => row.ClaimedAt != null && row.Username == username.Trim(),
                cancellationToken);

    private static async Task StartSessionAsync(
        AuthUser user,
        HttpContext context,
        SessionService sessions,
        TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var token = await sessions.StartAsync(user, cancellationToken);

        context.Response.Cookies.Append(SessionService.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            // The site and the API are one host on two ports, which browsers count as one
            // site, so the cookie rides along while staying unreadable to any script.
            SameSite = SameSiteMode.Lax,
            Secure = context.Request.IsHttps,
            Path = "/",
            Expires = clock.GetUtcNow().Add(SessionService.Lifetime),
        });
    }

    private static AccountState StateOf(CurrentUser me, bool anyAccount) =>
        new(
            // The page offers to make the first account while there is nobody to sign in as.
            NeedsFirstAccount: !anyAccount,
            SignedIn: me.SignedIn,
            Username: me.SignedIn ? me.Username : null,
            MustChangePassword: me.MustChangePassword,
            HasPin: me.HasPin);
}

public sealed record AccountState(
    bool NeedsFirstAccount,
    bool SignedIn,
    string? Username,
    bool MustChangePassword,
    bool HasPin);

public sealed record ClaimRequest(string? Username, string? Password);

public sealed record SignInRequest(string? Username, string? Password);

public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

public sealed record SetPinRequest(string? Password, string? Pin);

public sealed record ResetRequest(string? Username, string? Pin, string? NewPassword);
