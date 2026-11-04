using Microsoft.AspNetCore.Diagnostics;

namespace Folio.Api.Http;

/// <summary>
/// What the API answers when something throws.
///
/// Every other answer the site reads is <c>{ "error": "why" }</c>, so a crash has to be
/// the same shape: without this the browser gets a bare 500 it cannot parse, and the
/// reason never reaches anywhere a person can read it.
/// </summary>
public static class UnhandledErrors
{
    public static void UseFolioErrors(this IApplicationBuilder app) =>
        app.UseExceptionHandler(errorApp => errorApp.Run(HandleAsync));

    private static async Task HandleAsync(HttpContext context)
    {
        var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;

        context.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("Folio.Unhandled")
            .LogError(error, "Unhandled exception answering {Method} {Path}.",
                context.Request.Method, context.Request.Path);

        // A throw here is a bug: say so, and keep the detail in the log rather than on
        // the wire.
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new ErrorBody("Something went wrong. Nothing was changed."));
    }
}
