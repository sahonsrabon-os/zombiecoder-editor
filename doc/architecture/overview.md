# Architecture Overview

ZombieCoder — Mission Barisal is a VS Code extension that registers a **language
model provider** (contribution point `languageModelChatProviders`) inside GitHub
Copilot Chat. When you select a ZombieCoder model, every prompt is routed to
**your** OpenAI-compatible inference server (vLLM, Ollama, llama.cpp, LocalAI,
LiteLLM, or the Mission Barisal 7-agent gateway) instead of GitHub.

## High-level flow

```
Copilot Chat UI
      │  request (messages + tools)
      ▼
┌─────────────────────────────┐
│  gatewayProvider.ts         │  provider entry point (vendor: zombiecoder-mission-barisal)
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│  chatRequestHandler.ts      │  execute one request: convert → budget → stream → retry
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│  api/client.ts              │  transport: UDS → HTTP → SSE → WebSocket, /v1 normalization
└─────────────┬───────────────┘
              ▼
      your inference server
```

## Key modules

| Module                      | Responsibility                                                              |
| --------------------------- | --------------------------------------------------------------------------- |
| `src/extension.ts`          | Activation, command registration, provider registration.                    |
| `src/provider/`             | Provider surface: `gatewayProvider`, `chatRequestHandler`, `modelCatalog`, `configService`, `secretsManager`. |
| `src/api/client.ts`         | HTTP/SSE/WS/UDS client with URL normalization and transport fallback.        |
| `src/chat/`                 | Chat internals: message conversion, token budget, context window, thinking, response streaming, JSON repair. |
| `src/completions/`          | Experimental inline ("ghost text") completions via `/v1/completions`.        |
| `src/config/`               | Gateway + framework config objects and per-model options.                   |
| `src/discovery/`            | Ollama model discovery (`/api/show` sampler config).                        |
| `src/mission/`              | Mission Barisal platform: SSOT, syllabus, session memory, evidence gate, prompt sanitizer, MCP connector, transport probing. |
| `src/status/`               | Status-bar entry, tooltip, session stats.                                   |
| `src/commands/`             | Command Palette handlers (configure, test, refresh, headers, log).          |

## Design principles

1. **SSOT first** — before any claim or decision, read `.zombiecoder/SSOT.md`.
2. **Evidence before confidence** — no proof, no claim (see [Evidence Gate](../features/evidence-gate.md)).
3. **Tool before guess** — if a tool exists, use it; never hallucinate state.
4. **Transparent errors** — never hide failures; log to the output channel.
5. **Code in English** — all code, comments, and docs are English.

## Anti-dote (type-safety) chain

Every execution path (chat, mission, MCP) can run the 6-step anti-dote chain:

1. `validateInput` — schema enforcement
2. `checkProof` — logical feasibility
3. `getUserConsent` — user permission
4. `setGoalContract` — success metrics
5. `execute` — run the mission/task
6. `verifyOutput` — check against the contract

Anti-dote **never blocks** execution in monitoring mode — it only reports results.
