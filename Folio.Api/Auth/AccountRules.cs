namespace Folio.Api.Auth;

/// <summary>
/// What a username, a password and a PIN have to be, in one place.
///
/// The site keeps its own copy of the numbers so a form can say what is wrong before
/// anything is sent; this is the copy that decides, because it is the one a request
/// cannot get past.
/// </summary>
public static class AccountRules
{
    public const int UsernameMinLength = 3;

    public const int UsernameMaxLength = 32;

    public const int PasswordMinLength = 10;

    public const int PasswordMaxLength = 128;

    public const int PinLength = 6;

    /// <summary>How many wrong PINs before the reset waits, and for how long it waits.</summary>
    public const int PinAttemptsBeforeLockout = 5;

    public static readonly TimeSpan PinLockout = TimeSpan.FromMinutes(5);

    /// <summary>Why this username cannot be used, or null when it can.</summary>
    public static string? UsernameProblem(string? username)
    {
        if (string.IsNullOrWhiteSpace(username))
            return "An account needs a username.";

        if (username.Length < UsernameMinLength)
            return $"A username is at least {UsernameMinLength} characters.";

        if (username.Length > UsernameMaxLength)
            return $"A username is at most {UsernameMaxLength} characters.";

        foreach (var letter in username)
        {
            if (!char.IsAsciiLetterOrDigit(letter) && letter is not ('.' or '-' or '_'))
                return "A username is letters, digits, dots, dashes and underscores.";
        }

        if (!char.IsAsciiLetterOrDigit(username[0]))
            return "A username starts with a letter or a digit.";

        return null;
    }

    /// <summary>Why this password cannot be used, or null when it can.</summary>
    public static string? PasswordProblem(string? password, string? username = null)
    {
        if (string.IsNullOrEmpty(password))
            return "A password is needed.";

        if (password.Length < PasswordMinLength)
            return $"A password is at least {PasswordMinLength} characters.";

        if (password.Length > PasswordMaxLength)
            return $"A password is at most {PasswordMaxLength} characters.";

        if (string.IsNullOrWhiteSpace(password))
            return "A password cannot be all spaces.";

        if (username is not null && string.Equals(password, username, StringComparison.OrdinalIgnoreCase))
            return "A password cannot be the username.";

        return null;
    }

    /// <summary>Why this PIN cannot be used, or null when it can.</summary>
    public static string? PinProblem(string? pin) =>
        pin is not null && pin.Length == PinLength && pin.All(char.IsAsciiDigit)
            ? null
            : $"A PIN is {PinLength} digits.";

    /// <summary>
    /// The name of the account that owns a database's pre-account data. It cannot be signed
    /// in as -- there is no password behind it -- and nobody can sign in as it either: its
    /// brackets are not something a username may hold.
    /// </summary>
    public const string UnclaimedUsername = "(unclaimed)";
}
