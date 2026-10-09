# Prompt Sanitizer (dālāli stripper)

The prompt sanitizer (in `src/mission/promptSanitizer.ts`) cleans the incoming
prompt so the server-side agents see only the **user's real intent** — not the
middleman noise injected by the host application.

## What it removes

VS Code's Copilot Chat wraps user messages with its own system prompt and
middleman context (instructions about how the assistant should behave inside the
IDE). When those instructions leak into the request, agents can:
- waste context window on boilerplate,
- follow contradictory instructions,
- produce responses that are "prompt-shaped" instead of truthful.

The sanitizer detects and strips:

- VS Code / Copilot middleman system prompts (identified by their known structure),
- duplicated instruction blocks,
- stray tool-metadata noise.

## Why "dālāli" (দালালি)?

In Barishali Bengali, "দালালি" means broker/middleman interference. The sanitizer
is literally a *middleman stripper* — it removes the broker's added layer so the
real conversation reaches the model.

## Verification

`src/mission/__tests__/promptSanitizer.test.ts` covers:
- exact middleman prompt detection,
- partial / mutated middleman text,
- false positives (regular user messages must pass through untouched).

## When it runs

At request build time, inside the chat request pipeline, before the context
builder assembles the final system message. It runs locally — no data leaves
your machine during sanitization.
