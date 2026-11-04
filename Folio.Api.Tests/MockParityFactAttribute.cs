using System.Diagnostics;
using Xunit;

namespace Folio.Api.Tests;

/// <summary>
/// A test that compares the API with the site's mock, so it needs both a SQL Server and
/// node on the path.
///
/// Either missing is a skip rather than a failure, for the same reason
/// <see cref="DatabaseFactAttribute"/> skips: the suite still checks everything it can.
/// The check is an actual run of <c>node --version</c> rather than a guess about the
/// machine, because the parity tests start a real process.
/// </summary>
public sealed class MockParityFactAttribute : FactAttribute
{
    public MockParityFactAttribute()
    {
        Skip = TestDatabase.SkipReason ?? MissingNode();
    }

    private static string? MissingNode()
    {
        try
        {
            using var node = Process.Start(new ProcessStartInfo("node", "--version")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            });

            if (node is null)
                return "node could not be started, so the mock cannot be run.";

            node.WaitForExit(10_000);

            return node.ExitCode == 0 ? null : "node is on the path but answered nothing, so the mock cannot be run.";
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return "node is not on the path, so the mock cannot be run. The site's own tests need it too.";
        }
    }
}
