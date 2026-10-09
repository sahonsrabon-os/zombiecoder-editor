# Transports: UDS / SSE / HTTP / WebSocket

Mission Barisal talks to your inference server over multiple transports, picked
automatically by priority and environment.

## Priority order

```
UDS (Unix Domain Socket / Windows named pipe)  →  HTTP  →  SSE  →  WebSocket
```

- **UDS** — used first **only when the server is local** (`localhost` / `127.0.0.1`).
  The default socket location is platform-correct: `<tmpdir>/zombiecoder/mcp.sock`
  on Linux/macOS and `\\.\pipe\zombiecoder-mcp` on Windows (override with the
  `ZOMBIECODER_UDS_PATH` environment variable). Sockets avoid TCP overhead entirely;
  named pipes are probed by connecting (they have no filesystem entry).
- **HTTP** — plain `POST /v1/chat/completions`.
- **SSE** — server-sent events streaming for token-by-token output.
- **WebSocket** — fallback for servers that only expose a WS endpoint.

On cPanel / LiteSpeed hosts the UDS probe is auto-bypassed and only HTTP is used.

## URL normalization

Pasting a server URL "just works":

| You type                         | Normalized to                       |
| -------------------------------- | ----------------------------------- |
| `http://localhost:3000`          | `http://localhost:3000/v1`          |
| `http://localhost:3000/v1`       | `http://localhost:3000/v1`          |
| `http://localhost:3000/v1/`      | `http://localhost:3000/v1`          |

Implementation: `api/client.ts` → `normalizeBaseUrl()` trims a trailing `/v1` (and
slash) before re-appending it, so both forms hit the correct endpoint. The same
file probes `/v1/models` first, then falls back to `/models` for servers that do
not use the `/v1` prefix.

## Model metadata

`/v1/models` responses are parsed across server dialects:

| Server          | Context field                          |
| --------------- | -------------------------------------- |
| vLLM, LiteLLM   | `max_model_len`                        |
| Ollama, LocalAI | `context_length`                       |
| LM Studio       | `context_length` / `context_window`    |
| llama.cpp       | `meta.n_ctx` / `meta.n_ctx_train`      |

If a server cannot report context size, the extension uses `defaultMaxTokens`
and can learn the real limit from a context-overflow error and retry once.
