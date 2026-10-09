# Extension ↔ Server Contract (Server Response Specification)

> **Purpose:** The extension works 100% when the server answers these exact
> shapes. If the server responds correctly per this contract, the system is
> guaranteed to work — no guesswork, no "তালবাহানা".
>
> Reference implementation: `src/api/client.ts` (extension side),
> `/home/sahon/dev/Engine/api.js` (server side).

---

## 1. Transport Chain (order matters)

| Priority | Transport | When used | Probe |
|----------|-----------|-----------|-------|
| 1 | UDS (`/tmp/zombiecoder/mcp.sock`) | local, same machine | `fs.existsSync` |
| 2 | HTTP (OpenAI-compatible) | remote OR local | `GET /v1/models` (1500ms timeout) |
| 3 | SSE (stream) | remote stream | falls back from HTTP |
| 4 | WebSocket | realtime | `globalThis.WebSocket` |

**Rule:** `resolveActiveTransport()` picks the FIRST available. UDS speaks
newline-delimited JSON-RPC (NOT HTTP) — do not send HTTP requests to a socket.

---

## 2. Endpoints the Extension Calls

| Endpoint | Method | Body/Query | Expected Response |
|----------|--------|------------|-------------------|
| `/v1/models` | GET | — | `{ "object":"list", "data":[Model] }` |
| `/models` | GET | — | fallback (same shape) |
| `/v1/chat/completions` | POST | OpenAI chat body | SSE stream OR `{choices:[...]}` |
| `/mcp` | POST | JSON-RPC 2.0 | `{jsonrpc,id,result}` |
| `/api/workspace` | POST | `{projectDir, session_id}` | `{ok:true}` |
| `/api/syllabus` | GET | — | `{syllabus}` or `{content}` |

### Model object shape (`/v1/models`)
```json
{
  "id": "code-guru",
  "object": "model",
  "created": 1700000000,
  "owned_by": "mission-barisal",
  "isUserSelectable": true
}
```
- `owned_by: "mission-barisal"` → extension groups agents under one family
  and shows persona names (Code Guru - Monu, Bug Hunter - Jewel, ...).
- Provider models from `/api/v1/models` keep their own `owned_by` (provider name).

---

## 3. `/v1/chat/completions` — Request the Extension Sends

```json
{
  "model": "code-guru",
  "messages": [
    { "role": "system", "content": "Mission Barisal system message (persona + SSOT + syllabus + PROOF REQUIREMENT)" },
    { "role": "user", "content": "user input" }
  ],
  "stream": true,
  "temperature": 0.7,
  "session_id": "abc-123",
  "tools": [ { "type": "function", "function": { "name": "...", "description": "...", "parameters": {} } } ]
}
```

### What the extension expects back

**Streaming (`stream: true`)** — SSE lines:
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}
...
data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

**Non-streaming (`stream: false`)**:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "code-guru",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "answer with proof" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 13, "completion_tokens": 16, "total_tokens": 29 },
  "session_id": "abc-123"
}
```

### Empty-response guard (CRITICAL)
- Extension retries once without tools when it gets an empty completion.
- Server MUST NOT exceed `MAX_TOOLS_LIMIT = 40` tools in any single call —
  parse-time cap `V1_TOOLS_CAPPED` protects ALL branches
  (`/v1/chat/completions` at api.js ~10926, `executeSingleAgent` ~7313,
  `executeMission` ~6713).
- 71 tools + 50K tokens → small model returns EMPTY. Cap at 40 = fixed.

---

## 4. `/mcp` (JSON-RPC 2.0)

**tools/list**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```
→
```json
{ "jsonrpc": "2.0", "id": 1, "result": { "tools": [ { "name": "read_file", "description": "...", "inputSchema": { "type": "object" } } ] } }
```

**tools/call**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "read_file", "arguments": { "path": "/tmp/x" } } }
```
→
```json
{ "jsonrpc": "2.0", "id": 2, "result": { "content": [ { "type": "text", "text": "..." } ], "isError": false } }
```

---

## 5. Session & Memory Contract

- `session_id` travels in the request body (chat) — server must echo it back.
- Server-side: `getEffectiveDir(sessionId)` = `sessionDirs.get(sessionId) || mcpWorkingDir`.
- `.zombiecoder/` layout (auto-created by server):
  ```
  .zombiecoder/
    ssot.md
    agents/
      syllabus.md
      sessions/<agentId>.json
    memory.json
  ```
- Syllabus learning: agent completion → `learnToSyllabus(...)` →
  `SYLLABUS_LEARNED` log. Dedupe by topic, skip < 40 chars.

---

## 6. Failure Modes the Extension Handles

| Server behavior | Extension reaction |
|-----------------|--------------------|
| HTTP 4xx/5xx | `CompletionHttpError` → user-visible message with status + truncated body |
| Empty content (finish_reason stop, no text) | Retry once WITHOUT tools, then report |
| Timeout on `/v1/models` | Transport falls to next (HTTP → SSE → WS) |
| Unknown path 404 | `probeOllama` returns false, Ollama discovery skipped |
| UDS socket missing | `fs.existsSync` false → HTTP used |

---

## 7. Ollama (separate provider — HTTP only, PROVEN)

Evidence: official Ollama API docs (`github.com/ollama/ollama/blob/main/docs/api.md`)
+ FAQ (`docs.ollama.com/faq`):

- ALL endpoints: `curl http://localhost:11434/...` — HTTP only.
  (`/api/generate`, `/api/chat`, `/api/create`, `/api/tags`, `/api/show`,
  `/api/copy`, `/api/delete`, `/api/pull`, `/api/push`, `/api/embed`,
  `/api/embeddings`, `/api/ps`, `/api/version`)
- FAQ: *"Ollama binds 127.0.0.1 port 11434 by default. Change the bind address
  with the `OLLAMA_HOST` environment variable."* — `OLLAMA_HOST` accepts
  `host:port` (`0.0.0.0:11434`), NOT socket paths.
- FAQ: *"Ollama runs an HTTP server"* — proxy examples `proxy_pass http://localhost:11434`.
- **NO Unix domain socket support anywhere in official docs.**
- GitHub code search for "OLLAMA_HOST unix socket" in ollama/ollama → 0 results.

**Conclusion:** Ollama = HTTP-only. The extension's UDS-first chain is for the
Mission Barisal server (`/tmp/zombiecoder/mcp.sock`), NOT for Ollama.
Extension code: `src/api/client.ts:724` — `probeOllama()` uses
`${normalizeBaseUrl(serverUrl)}/api/version` (HTTP), `showModel()` uses
`POST /api/show` (HTTP). Correct as-is.

---

*Generated by Mission Barisal v3 — Evidence-Driven, Proof-First*
