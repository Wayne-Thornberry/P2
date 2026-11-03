using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// Passwords: hashed, salted, and compared without leaking how much was right.
/// </summary>
public sealed class PasswordHasherTests
{
    private readonly PasswordHasher _hasher = new();

    [Fact]
    public void A_password_verifies_against_its_own_hash()
    {
        var hash = _hasher.Hash("correct horse battery staple");

        Assert.True(_hasher.Verify("correct horse battery staple", hash));
    }

    [Fact]
    public void A_different_password_does_not_verify()
    {
        var hash = _hasher.Hash("correct horse battery staple");

        Assert.False(_hasher.Verify("correct horse battery stapl", hash));
    }

    [Fact]
    public void The_same_password_hashes_differently_every_time()
    {
        // A salt per password, so two people with the same password do not share a
        // hash -- and a stolen table cannot be attacked in one pass.
        Assert.NotEqual(_hasher.Hash("same"), _hasher.Hash("same"));
    }

    [Fact]
    public void The_hash_carries_its_scheme_and_iteration_count()
    {
        var parts = _hasher.Hash("anything").Split('$');

        Assert.Equal(4, parts.Length);
        Assert.Equal("pbkdf2-sha256", parts[0]);
        Assert.True(int.Parse(parts[1]) >= 100_000);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-hash")]
    [InlineData("pbkdf2-sha256$notanumber$c2FsdA==$a2V5")]
    [InlineData("pbkdf2-sha256$1000$not-base64$a2V5")]
    [InlineData("pbkdf2-sha256$1000$c2FsdA==$")]
    [InlineData("scrypt$1000$c2FsdA==$a2V5")]
    public void A_damaged_hash_is_a_non_match_rather_than_an_error(string stored)
    {
        Assert.False(_hasher.Verify("anything", stored));
    }
}
