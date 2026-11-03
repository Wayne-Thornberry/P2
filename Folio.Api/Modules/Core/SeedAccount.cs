using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Core;

/// <summary>
/// Creates the one account, the first time the API meets an empty database.
///
/// This is seeding rather than a migration: the password belongs to whoever deploys,
/// not to the repository, so it arrives in configuration. With no password
/// configured nothing is created and sign-in can only fail, which is the right
/// outcome for a checkout nobody has set up yet.
/// </summary>
internal static class SeedAccount
{
    public static async Task RunAsync(IServiceProvider services, ILogger logger)
    {
        var db = services.GetRequiredService<FolioDbContext>();
        var options = services.GetRequiredService<IOptions<AuthOptions>>().Value;
        var hasher = services.GetRequiredService<PasswordHasher>();
        var clock = services.GetRequiredService<TimeProvider>();

        try
        {
            if (await db.Users.AnyAsync())
                return;

            if (string.IsNullOrWhiteSpace(options.SeedPassword))
            {
                logger.LogWarning(
                    "There is no account and Auth:SeedPassword is empty, so nobody can sign in. "
                    + "Set the password (start.ps1 does it for its own database) and restart the app.");
                return;
            }

            db.Users.Add(new User
            {
                Username = options.SeedUsername,
                PasswordHash = hasher.Hash(options.SeedPassword),
                CreatedAt = clock.GetUtcNow().UtcDateTime,
            });

            await db.SaveChangesAsync();

            logger.LogInformation("Created the account {Username}.", options.SeedUsername);
        }
        catch (Exception ex)
        {
            // A database that is not there yet, or not migrated, is a deployment
            // problem rather than a reason for the process to die: /api/health says
            // what is wrong, and the site can at least answer.
            logger.LogError(ex, "Could not create the account. Is the database created and migrated?");
        }
    }
}
