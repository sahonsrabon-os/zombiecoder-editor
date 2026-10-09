# Configuration Reference

All settings live under the **`zombiecoder.mission-barisal`** prefix. Open VS Code
Settings (`Ctrl+,` / `Cmd+,`) and search for **"ZombieCoder"**, or edit
`settings.json` directly.

## Connection

| Setting                        | Default                 | Description                                                    |
| ------------------------------ | ----------------------- | -------------------------------------------------------------- |
| `serverUrl`                    | `""` → auto-detect local | Base URL of your OpenAI-compatible server (`/v1` is optional). Empty means "detect the local Mission Barisal server" — the socket is probed first (Unix domain socket on Linux/macOS, named pipe on Windows), then `http://localhost:3000`. |
| `apiKey`                       | _(empty)_               | Key for servers that require auth (do **not** add `Bearer `).  |
| `requestTimeout`               | `60000`                 | Request timeout in ms.                                         |
| `mcpServerUrl`                 | _(empty)_               | Optional external MCP server; its tool list is merged into agent context. |

## Model

| Setting                        | Default  | Description                                                                 |
| ------------------------------ | -------- | --------------------------------------------------------------------------- |
| `defaultMaxTokens`             | `262144` | Fallback context window (input tokens) when server reports none.            |
| `defaultMaxOutputTokens`       | `4096`   | Fallback max output tokens.                                                 |
| `modelContextWindows`          | `{}`     | Per-model context window overrides (`*` wildcard supported).                |
| `enableImageInput`             | `true`   | Advertise image support; forward image parts as base64 `image_url`.         |

## Sampling

| Setting                        | Default | Description                                                                 |
| ------------------------------ | ------- | --------------------------------------------------------------------------- |
| `extraModelOptions`            | `{}`    | Params merged into **every** request.                                       |
| `perModelOptions`              | `{}`    | Params per model id / `*` wildcard; overrides `extraModelOptions`.          |

Merge order (low → high): `extraModelOptions` → matching `perModelOptions` →
per-request options from Copilot.

## Tool calling

| Setting                        | Default | Description                                                      |
| ------------------------------ | ------- | ---------------------------------------------------------------- |
| `enableToolCalling`            | `true`  | Allow models to use Copilot tools.                               |
| `parallelToolCalling`          | `true`  | Allow simultaneous tool calls.                                   |
| `agentTemperature`             | `0.0`   | Temperature in tool-calling mode.                                |

## Diagnostics

| Setting                        | Default | Description                                                      |
| ------------------------------ | ------- | ---------------------------------------------------------------- |
| `verboseLogging`               | `false` | Log full request bodies to the output channel (debug only).      |

## Inline completions (experimental)

| Setting                                 | Default | Description                                          |
| --------------------------------------- | ------- | ---------------------------------------------------- |
| `enableInlineCompletion`                | `false` | Turn on server-backed ghost text.                    |
| `inlineCompletionModel`                 | `""`    | Model id; blank = first model the server reports.    |
| `inlineCompletionMaxTokens`             | `256`   | Max tokens per completion.                           |
| `inlineCompletionDebounce`              | `300`   | ms after last keystroke before requesting.           |
| `inlineCompletionTimeout`               | `3000`  | Per-request timeout (ms).                            |
| `inlineCompletionMaxPrefixChars`        | `4000`  | Context before the cursor.                           |
| `inlineCompletionMaxSuffixChars`        | `1000`  | Context after the cursor.                            |

## Example `settings.json`

```jsonc
{
  "zombiecoder.mission-barisal.serverUrl": "http://localhost:42069",
  "zombiecoder.mission-barisal.modelContextWindows": {
    "qwen2.5-coder-32b": 32768,
    "llama*": 123904
  },
  "zombiecoder.mission-barisal.perModelOptions": {
    "qwen*": { "temperature": 0.7, "top_p": 0.8, "top_k": 20 },
    "deepseek-r1": { "temperature": 0.6 }
  },
  "zombiecoder.mission-barisal.agentTemperature": 0.0,
  "zombiecoder.mission-barisal.parallelToolCalling": true
}
```
