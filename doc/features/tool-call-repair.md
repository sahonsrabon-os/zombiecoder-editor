# Tool-Call Repair & Streaming Assembly

Small and quantized models frequently emit **malformed tool calls** — truncated
JSON, unclosed strings, trailing commas, missing required arguments. Mission
Barisal repairs these instead of aborting the call.

## JSON repair (`src/chat/jsonRepair.ts`)

The repairer handles, among others:

- unclosed strings / braces / brackets,
- trailing commas,
- missing **required** arguments (filled in from the tool schema so the call
  still executes),
- control characters and stray tokens.

The repaired JSON is validated before being handed to Copilot's tool executor.

## Streaming assembly (`src/api/toolCallAccumulator.ts`)

Tool calls arrive as **incremental stream deltas** across multiple wire formats.
The accumulator:

1. collects deltas per tool-call ID,
2. tolerates **late or missing call IDs**,
3. merges partial `arguments` fragments into complete JSON,
4. exposes the finished call only when complete.

## Reasoning / thinking handling (`src/chat/thinking.ts`)

- Routes `<think>` / `<thinking>` blocks and a separate `reasoning_content` field
  into Copilot's **thinking UI** instead of dumping chain-of-thought into chat.
- Handles tags split across stream chunks.
- Handles LM Studio's stray-tag quirk.
- Falls back cleanly when a model exhausts its budget mid-thought.

## Why this matters

| Without repair                           | With repair                              |
| ---------------------------------------- | ---------------------------------------- |
| Call aborted, user must retry            | Call runs, args auto-completed           |
| Garbage JSON shown in chat               | Clean tool invocation                    |
| Model loops on the same failed call      | Model continues the task                 |
