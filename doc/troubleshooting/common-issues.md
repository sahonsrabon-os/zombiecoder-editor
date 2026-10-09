# Troubleshooting

## Model not appearing in Copilot

1. Verify the server is running:
   ```bash
   curl http://your-server:port/v1/models
   ```
2. Check **Server URL** in settings — paste the **base URL only**
   (`http://your-server:port`). A trailing `/v1` is normalized, but a wrong host
   or port will not connect.
3. Check **API Key** — paste the key only; do **not** prefix `Bearer `.
4. Run **"ZombieCoder: Test Server Connection"**.
5. Run **"ZombieCoder: Refresh Models"** (or click the
   status-bar entry).
6. Inspect the **"ZombieCoder"** output channel.

## Model not appearing in the Agents window

1. Add the opt-in setting:
   ```jsonc
   "extensions.supportAgentsWindow": {
     "zombiecoder.zombiecoder-mission-barisal": true
   }
   ```
2. Confirm the extension is installed in your **default VS Code profile**.
3. Reload/reopen the Agents window, then re-check the language model picker.

## "Model returned empty response"

The model generated nothing. Try:

1. **Check the tool parser** — `--tool-call-parser` must match the model family
   (see README → vLLM Setup Reference).
2. **Disable tool calling** — set
   `zombiecoder.mission-barisal.enableToolCalling` to `false` to test basic chat.
3. **Reduce context** — the conversation may exceed the model's limit.

> The extension now retries **once without tools** automatically before showing
> this diagnostic, which fixes the "71 tools / empty reply" case.

## Tools described but not executed

The model writes "Using the read_file tool…" instead of calling tools.

1. Use **Qwen3-8B** or **Qwen2.5-7B-Instruct** (avoid Qwen2.5-Coder variants —
   [known vLLM parser issues](https://github.com/vllm-project/vllm/issues/10952)).
2. Set **Agent Temperature** to `0.0`.
3. Disable **Parallel Tool Calling**.
4. Ensure the server started with `--enable-auto-tool-choice`.

## Out of memory errors

- Reduce `--max-model-len` (try 8192 or 16384).
- Use a quantized model (AWQ, GPTQ, FP8).
- Choose a smaller model.

## Connection refused

- Ensure the server is running and the URL is correct.
- Check for a stray `/v1` in the URL (it is normalized automatically, but a
  wrong path may still 404).
- Check firewalls / bind address (bind the server to a reachable interface, e.g.
  `--host 0.0.0.0`, only when you genuinely need remote access; for local use
  `localhost` is enough and safer).

## Slow responses

- Lower the model's context window (`modelContextWindows`) — smaller budgets are
  faster.
- Switch to a smaller / quantized model.
- Check whether inline completions are enabled and competing for server load.

## Reasoning garbage in chat

- Ensure the model is supported (see Recommended Models in the README).
- Verify the server streams `reasoning_content` / `<think>` blocks correctly.

## Diagnostic output is huge

- Disable `zombiecoder.mission-barisal.verboseLogging` — it logs full request
  bodies, which may contain conversation content. Keep it off unless debugging.
