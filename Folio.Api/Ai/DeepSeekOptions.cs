namespace Folio.Api.Ai;

/// <summary>
/// What the API needs to know about DeepSeek, from the <c>Ai:DeepSeek</c> section.
///
/// The key is a secret and lives where the other secrets live: the <c>DEEPSEEK_API_KEY</c>
/// repository secret, written into appsettings.Production.json by the deploy and passed
/// through by start.ps1 for local work. Never the browser, never the repository.
/// </summary>
public sealed class DeepSeekOptions
{
    public const string SectionName = "Ai:DeepSeek";

    /// <summary>The key from the DeepSeek platform. Empty means the site offers no AI at all.</summary>
    public string ApiKey { get; set; } = "";

    /// <summary>Where the API is. The chat path is added to whatever is here.</summary>
    public string BaseUrl { get; set; } = "https://api.deepseek.com";

    /// <summary>The model a question is asked of.</summary>
    public string Model { get; set; } = "deepseek-flash";

    /// <summary>
    /// How long the site waits for an answer. A report over a year of transactions writes
    /// more than a category does, so this is generous -- but it is still a wait somebody is
    /// looking at, not a batch job.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 90;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
