using Folio.Api.Http;

namespace Folio.Api.Auth;

/// <summary>
/// The one check every endpoint of the budget sits behind.
///
/// It is a filter on the group rather than a guard inside each endpoint, so an endpoint
/// added without thinking about accounts is protected by not having said otherwise --
/// which is the way round that fails safe.
/// </summary>
public sealed class SignedInFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var me = context.HttpContext.RequestServices.GetRequiredService<CurrentUser>();

        if (!me.SignedIn)
            return ApiErrors.Unauthorized("Sign in first.");

        // A password somebody was handed is not theirs yet, so the budget stays shut until
        // the account page has replaced it. Signing in and changing it are the only things
        // that answer in the meantime.
        return me.MustChangePassword
            ? ApiErrors.Forbidden("Choose your own password first.")
            : await next(context);
    }
}
