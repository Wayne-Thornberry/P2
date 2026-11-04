namespace Folio.Api.Auth;

/// <summary>
/// <c>dotnet run --project Folio.Api -- --add-user wayne</c>: an account made from the box,
/// for somebody who is not the person who owns it.
///
/// The password is printed once and never stored anywhere it could be read back -- only its
/// hash is, so a lost one is replaced rather than recovered. The site will not let the
/// account do anything until that password has been changed, which is what makes it a
/// one-time one.
/// </summary>
public static class AddUserCommand
{
    public const string Switch = "--add-user";

    public static async Task<int> RunAsync(IServiceProvider services, string? username)
    {
        if (AccountRules.UsernameProblem(username) is { } problem)
        {
            Console.Error.WriteLine(problem);

            return 1;
        }

        var accounts = services.GetRequiredService<AccountService>();

        using var cancellation = new CancellationTokenSource();

        try
        {
            if (await accounts.UsernameTakenAsync(username!, cancellation.Token))
            {
                Console.Error.WriteLine($"'{username}' is already an account here.");

                return 1;
            }

            var (user, password) = await accounts.CreateWithOneTimePasswordAsync(username!, cancellation.Token);

            Console.WriteLine();
            Console.WriteLine($"  Account:           {user.Username}");
            Console.WriteLine($"  One-time password: {password}");
            Console.WriteLine();
            Console.WriteLine("  Write it down now: it is not stored, and it cannot be looked up.");
            Console.WriteLine("  The site asks for a new one the first time it is used, and nothing else");
            Console.WriteLine("  works until it has been set.");

            return 0;
        }
        catch (Exception failure) when (failure is not OperationCanceledException)
        {
            Console.Error.WriteLine($"The account could not be made: {failure.Message}");

            return 1;
        }
    }
}
