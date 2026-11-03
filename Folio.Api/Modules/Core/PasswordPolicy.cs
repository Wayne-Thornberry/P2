namespace Folio.Api.Modules.Core;

/// <summary>
/// What a new password has to be. Deliberately short: a personal site behind a lock, where
/// the alternative is a password you cannot remember and a box you have to walk to.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 8;

    /// <summary>
    /// An upper bound, because the hashing cost is paid per request and nobody needs a
    /// kilobyte of password.
    /// </summary>
    public const int MaxLength = 256;

    /// <summary>Why this password cannot be used, or null when it can.</summary>
    public static string? Problem(string password)
    {
        if (password.Length < MinLength)
            return $"A password needs at least {MinLength} characters.";

        if (password.Length > MaxLength)
            return $"A password is at most {MaxLength} characters.";

        if (string.IsNullOrWhiteSpace(password))
            return "A password cannot be only spaces.";

        return null;
    }
}
