using Folio.Api.Data;

namespace Folio.Api.Auth;

/// <summary>
/// Who is asking, for the length of one request.
///
/// The middleware fills this in from the session cookie; everything behind the signed-in
/// filter can read <see cref="Id"/> without checking whether anybody is there, because the
/// filter has already refused the request if nobody is.
///
/// It is also the only thing that says whose budget a query is about: every folio row
/// carries the account that owns it, and <see cref="Id"/> is what the services filter on.
/// </summary>
public sealed class CurrentUser
{
    private AuthUser? _user;

    public bool SignedIn => _user is not null;

    public int Id => _user?.Id
        ?? throw new InvalidOperationException("This endpoint needs a signed-in account, and nothing checked for one.");

    public string Username => _user?.Username ?? string.Empty;

    public bool MustChangePassword => _user?.MustChangePassword ?? false;

    public bool HasPin => _user?.HasPin ?? false;

    public void Adopt(AuthUser user) => _user = user;
}
