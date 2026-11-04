using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Folio.Api.Ai;

/// <summary>
/// DeepSeek's chat API, asked for one JSON object and nothing else.
///
/// The key is the API's, never the browser's: the page asks the API, and the API asks
/// DeepSeek. A call costs money and can go wrong slowly, so it is capped in tokens, in
/// answer size and in time, and the question says which shape the answer has to be -- a
/// model that answers with prose is a call that failed, not a paragraph to guess at.
/// </summary>
public sealed class DeepSeekClient(
    HttpClient http,
    IOptions<DeepSeekOptions> options,
    ILogger<DeepSeekClient> log)
{
    private const string ChatPath = "/chat/completions";

    /// <summary>
    /// How much the model may write back. A category is a few tokens; a report is a page,
    /// and a year of transactions categorised at once is more. Everything that asks says
    /// what it expects, so a runaway answer is a small bill rather than an open one.
    /// </summary>
    public const int ReportTokens = 2000;

    public const int CategoriseTokens = 4000;

    private DeepSeekOptions Settings => options.Value;

    public bool IsConfigured => Settings.IsConfigured;

    /// <summary>The model every answer came from, so a report can say which one wrote it.</summary>
    public string Model => Settings.Model;

    /// <summary>
    /// The model's answer to a question that asked for JSON. Throws
    /// <see cref="AiUnavailableException"/> when there is no answer at all; whether the
    /// answer makes sense is the caller's to judge.
    /// </summary>
    public async Task<string> AskForJsonAsync(
        string system,
        string question,
        int maxTokens,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
            throw new AiUnavailableException("DeepSeek is not configured.");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(Settings.TimeoutSeconds, 1, 300)));

        var body = new
        {
            model = Settings.Model,
            messages = new object[]
            {
                new { role = "system", content = system },
                new { role = "user", content = question },
            },
            response_format = new { type = "json_object" },

            // Reading a year of spending is not a puzzle with one right answer, but the
            // answer is a report about numbers that are already worked out: sampling it
            // would only make two runs of the same month disagree.
            thinking = new { type = "disabled" },
            temperature = 0,
            max_tokens = maxTokens,
            stream = false,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(Settings.BaseUrl), ChatPath));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Settings.ApiKey);
        request.Content = JsonContent.Create(body);

        HttpResponseMessage response;

        try
        {
            response = await http.SendAsync(request, timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception failure) when (failure is HttpRequestException or OperationCanceledException)
        {
            throw new AiUnavailableException($"DeepSeek could not be reached ({failure.GetType().Name}).", failure);
        }

        using (response)
        {
            var payload = await response.Content.ReadAsStringAsync(timeout.Token);

            if (!response.IsSuccessStatusCode)
            {
                // The key and the question stay out of the log: the status, and the reason
                // DeepSeek gave, are what someone fixing this needs.
                log.LogWarning("DeepSeek answered {Status}: {Reason}", (int)response.StatusCode, Shorten(payload));

                throw new AiUnavailableException($"DeepSeek answered {(int)response.StatusCode}.");
            }

            return Content(payload) ?? throw new AiUnavailableException("DeepSeek answered with nothing.");
        }
    }

    /// <summary>The message content out of a chat completion, or null when there is none.</summary>
    private static string? Content(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);

            return document.RootElement.TryGetProperty("choices", out var choices)
                   && choices.ValueKind == JsonValueKind.Array
                   && choices.GetArrayLength() > 0
                   && choices[0].TryGetProperty("message", out var message)
                   && message.TryGetProperty("content", out var content)
                   && content.ValueKind == JsonValueKind.String
                ? content.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Shorten(string text) => text.Length <= 200 ? text : text[..200];
}
