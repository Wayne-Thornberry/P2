using Xunit;

namespace Folio.Api.Tests;

/// <summary>
/// A test that needs a SQL Server.
///
/// On a machine without one it is reported as skipped, with the reason, rather than
/// failing: the suite still checks everything that does not touch a database. When
/// <c>Folio_REQUIRE_DATABASE_TESTS=1</c> is set -- which the deploy does -- there is no
/// skip, and a missing server fails the run, because a deploy whose tests quietly
/// skipped has checked nothing.
/// </summary>
public sealed class DatabaseFactAttribute : FactAttribute
{
    public DatabaseFactAttribute()
    {
        if (TestDatabase.SkipReason is { } reason)
            Skip = reason;
    }
}
