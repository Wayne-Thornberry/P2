using Folio.Api.Http;
using Folio.Api.Security;

namespace Folio.Api.Modules.Core;

/// <summary>The three endpoints the sign-in screen uses.</summary>
internal static class AuthEndpoints
{
    public static async Task<IResult> SignInAsync(
        SignInRequest request,
        SessionService sessions,
        CancellationToken cancellationToken)
    {
        var username = request.Username?.Trim() ?? "";
        var password = request.Password ?? "";

        if (username.Length == 0 || password.Length == 0)
            return ApiErrors.BadRequest("A username and a password are needed.");

        var issued = await sessions.SignInAsync(username, password, cancellationToken);

        if (issued is null)
            return ApiErrors.Unauthorized("That username and password do not match an account.");

        return Results.Ok(new SignInResponse(issued.Token, issued.ExpiresAt, issued.User.Username));
    }

    public static async Task<IResult> SignOutAsync(
        HttpContext context,
        SessionService sessions,
        CancellationToken cancellationToken)
    {
        var token = SessionMiddleware.BearerToken(context.Request);

        if (token is not null)
            await sessions.SignOutAsync(token, cancellationToken);

        return Results.NoContent();
    }

    public static IResult Me(HttpContext context)
    {
        var user = context.GetUser();

        return Results.Ok(new MeResponse(user.Id, user.Username));
    }

    /// <summary>
    /// Replaces the signed-in account's password, given the current one. Answers with a new
    /// session, so the browser that made the change carries on and everywhere else stops.
    /// </summary>
    public static async Task<IResult> ChangePasswordAsync(
        ChangePasswordRequest request,
        HttpContext context,
        SessionService sessions,
        CancellationToken cancellationToken)
    {
        var problem = PasswordPolicy.Problem(request.NewPassword ?? "");
        if (problem is not null)
            return ApiErrors.BadRequest(problem);

        var user = context.GetUser();

        var issued = await sessions.ChangePasswordAsync(
            user.Id, request.CurrentPassword ?? "", request.NewPassword!, cancellationToken);

        if (issued is null)
            return ApiErrors.BadRequest("That is not the current password.");

        return Results.Ok(new SignInResponse(issued.Token, issued.ExpiresAt, issued.User.Username));
    }

    /// <summary>
    /// Replaces a forgotten password, given the recovery code from configuration and no
    /// session. The only way back in without the box.
    /// </summary>
    public static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request,
        SessionService sessions,
        CancellationToken cancellationToken)
    {
        var problem = PasswordPolicy.Problem(request.NewPassword ?? "");
        if (problem is not null)
            return ApiErrors.BadRequest(problem);

        var username = (request.Username ?? "").Trim();
        if (username.Length == 0)
            return ApiErrors.BadRequest("A username is needed.");

        var outcome = await sessions.ResetPasswordAsync(
            username, request.RecoveryCode ?? "", request.NewPassword!, cancellationToken);

        return outcome switch
        {
            PasswordReset.Done => Results.NoContent(),

            // The same answer for "no such account" and "wrong code", so this cannot be
            // used to find out which usernames exist.
            PasswordReset.Refused => ApiErrors.Unauthorized("That username and recovery code do not match."),

            _ => ApiErrors.NotFound(
                "No recovery code is configured for this site, so a password cannot be reset from here. "
                + "Set Auth:RecoveryCode (the RECOVERY_CODE secret) and deploy, or reset it on the box."),
        };
    }
}

public sealed record SignInRequest(string? Username, string? Password);

public sealed record SignInResponse(string Token, DateTime ExpiresAt, string Username);

public sealed record MeResponse(int Id, string Username);

public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

public sealed record ResetPasswordRequest(string? Username, string? RecoveryCode, string? NewPassword);
