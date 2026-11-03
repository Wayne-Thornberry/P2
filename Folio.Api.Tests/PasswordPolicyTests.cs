using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// The password rule, on its own. The site shows the same message before it sends anything.
/// </summary>
public sealed class PasswordPolicyTests
{
    [Fact]
    public void A_long_enough_password_is_fine()
    {
        Assert.Null(PasswordPolicy.Problem("eight-chars"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("seven77")]
    public void A_short_password_is_refused(string password)
    {
        Assert.Equal("A password needs at least 8 characters.", PasswordPolicy.Problem(password));
    }

    [Fact]
    public void A_password_of_exactly_the_minimum_is_fine()
    {
        Assert.Null(PasswordPolicy.Problem(new string('x', PasswordPolicy.MinLength)));
    }

    [Fact]
    public void An_absurdly_long_password_is_refused()
    {
        Assert.NotNull(PasswordPolicy.Problem(new string('x', PasswordPolicy.MaxLength + 1)));
    }

    [Fact]
    public void A_password_of_only_spaces_is_refused()
    {
        Assert.Equal("A password cannot be only spaces.", PasswordPolicy.Problem("          "));
    }
}
