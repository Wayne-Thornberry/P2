namespace Folio.Api.Ai;

/// <summary>
/// There was no answer to be had: no key, no network, or a refusal from DeepSeek. The
/// endpoint that asked turns this into one message and one status, so nobody has to read a
/// stack trace to learn that the key is missing.
/// </summary>
public sealed class AiUnavailableException(string message, Exception? inner = null)
    : Exception(message, inner);
