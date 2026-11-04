using Folio.Api.Auth;

namespace Folio.Api.Tests;

/// <summary>
/// The rules an account has to pass, without a database or an HTTP request in the way.
///
/// The site keeps its own copy of these so a form can say what is wrong before anything is
/// sent; this is the copy that decides.
/// </summary>
public sealed class AccountRulesTests
{
    [Theory]
    [InlineData("wayne")]
    [InlineData("wayne.thornberry")]
    [InlineData("w_1-ster")]
    [InlineData("abc")]
    public void A_username_of_letters_digits_and_a_few_punctuation_marks_is_fine(string username) =>
        Assert.Null(AccountRules.UsernameProblem(username));

    [Theory]
    [InlineData("", "needs a username")]
    [InlineData("ab", "at least")]
    [InlineData("has space", "letters, digits")]
    [InlineData(".leading", "starts with")]
    // The placeholder that owns a database's pre-account data: its brackets are already
    // outside what a username may hold, which is what keeps it out of reach.
    [InlineData("(unclaimed)", "letters, digits")]
    public void A_username_that_is_not_one_is_refused(string username, string why) =>
        Assert.Contains(why, AccountRules.UsernameProblem(username));

    [Fact]
    public void A_username_that_is_too_long_is_refused() =>
        Assert.NotNull(AccountRules.UsernameProblem(new string('a', AccountRules.UsernameMaxLength + 1)));

    [Theory]
    [InlineData("a-good-password")]
    [InlineData("1234567890")]
    [InlineData("with spaces inside")]
    public void A_password_of_the_right_length_is_fine(string password) =>
        Assert.Null(AccountRules.PasswordProblem(password));

    [Theory]
    [InlineData("", "needed")]
    [InlineData("short", "at least")]
    [InlineData("          ", "all spaces")]
    public void A_password_that_is_not_one_is_refused(string password, string why) =>
        Assert.Contains(why, AccountRules.PasswordProblem(password));

    [Fact]
    public void A_password_cannot_be_the_username() =>
        Assert.NotNull(AccountRules.PasswordProblem("waynethornberry", "waynethornberry"));

    [Theory]
    [InlineData("123456")]
    [InlineData("000000")]
    public void A_pin_of_six_digits_is_fine(string pin) =>
        Assert.Null(AccountRules.PinProblem(pin));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("12345")]
    [InlineData("1234567")]
    [InlineData("12345a")]
    [InlineData("12 456")]
    public void A_pin_that_is_not_six_digits_is_refused(string? pin) =>
        Assert.NotNull(AccountRules.PinProblem(pin));

    [Fact]
    public void A_one_time_password_is_read_out_loud_without_the_letters_that_are_mistaken_for_digits()
    {
        for (var i = 0; i < 50; i++)
        {
            var password = AccountService.OneTimePassword();

            // Three groups of four, and an alphabet with no O, 0, I or 1 in it.
            Assert.Matches("^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$", password);
        }

        Assert.NotEqual(AccountService.OneTimePassword(), AccountService.OneTimePassword());
    }

    [Fact]
    public void A_password_is_not_stored_as_itself_and_the_same_one_hashes_differently_each_time()
    {
        var (hash, salt) = SecretHasher.Hash("a-good-password");
        var (again, againSalt) = SecretHasher.Hash("a-good-password");

        Assert.Equal(SecretHasher.HashBytes, hash.Length);
        Assert.NotEqual(salt, againSalt);
        Assert.NotEqual(hash, again);

        Assert.True(SecretHasher.Matches("a-good-password", hash, salt));
        Assert.False(SecretHasher.Matches("a-good-passworD", hash, salt));
        Assert.False(SecretHasher.Matches(null, hash, salt));
        Assert.False(SecretHasher.Matches("a-good-password", null, salt));
    }
}
