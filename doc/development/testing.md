# Testing

## Test layout

Tests live next to their source as `__tests__/*.test.ts` and compile to
`out-test/` (kept out of the packaged extension via `.vscodeignore`).

| Area          | Covered modules                                                          |
| ------------- | ------------------------------------------------------------------------ |
| `api`         | `client`, `requestBuilder`, `toolCallAccumulator`, `types`               |
| `chat`        | `contextWindow`, `errorDiagnostics`, `jsonRepair`, `messageConverter`, `responseStreamer`, `thinking`, `tokenBudget`, `toolSchema` |
| `completions` | `inlineCompletion`, `inlineCompletionProvider`                           |
| `config`      | `frameworkConfig`, `gatewayConfig`, `perModelOptions`, `secretMigration` |
| `discovery`   | `ollamaDiscovery`, `types`                                               |
| `mission`     | `contextBuilder`, `evidenceGate`, `footprintScanner`, `mcpConnector`, `memoryManager`, `missionManager`, `promptSanitizer`, `ssotManager`, `transport`, `workspaceWatcher` |
| `models`      | `modelDisplay`, `modelInfoBuilder`                                       |
| `provider`    | `chatRequestHandler`, `configService`, `configValidation`, `gatewayProvider`, `inlineCompletionService`, `modelCatalog`, `notifications`, `secretsManager`, `vscodeParts` |
| `status`      | `format`, `sessionStats`, `statusBarManager`, `statusBarRenderer`, `statusSnapshot`, `statusTooltip` |

## Running the suite

```bash
npm test
```

## Key behaviors covered

- **URL normalization** — `http://host:port` and `http://host:port/v1` both
  resolve correctly; `/v1/models` falls back to `/models`.
- **Transport priority** — UDS preferred on local servers, then HTTP → SSE → WS.
- **Evidence gate** — explanatory text passes; unproven claims are blocked.
- **JSON repair** — truncated/malformed tool-call JSON is repaired and validated.
- **Token budget** — context window auto-detection and `max_tokens` shrinking.
- **Thinking handling** — `<think>` blocks routed to the thinking UI.

## Adding a test

1. Create `src/<area>/__tests__/<name>.test.ts`.
2. Import from `node:test` and `node:assert`.
3. Mock `vscode` via `src/vscode-extensions.d.ts` types as needed.
4. Run `npm test` — the test-build compiles all `*.test.ts`.
