# Evidence Gate

The Evidence Gate is Mission Barisal's **Phase 3 proof-checker** (implemented in
`src/mission/evidenceGate.ts`). It reviews every agent/assistant response before
it is handed back to the user and decides whether claims need proof.

## Why it exists

Mission Barisal's core rule is: *"First Evidence, Then Conclusion. First Truth,
Then Confidence."* An assistant that claims "I fixed the bug" without showing the
fix is not useful — the gate ensures claims are backed by verifiable evidence:
file references, line numbers, test output, or quoted code.

## How it works

1. The gate scans the response text for **evidence markers**:
   - file paths and `file:line` references
   - backticked code / symbol names
   - test output, error messages, or verbatim quotes
   - numbers (token counts, durations, etc.)

2. It also scans for **claim markers** — phrases that assert a change happened:
   - `I fixed / changed / added / removed / updated / implemented …`
   - `the bug is / the root cause is / I found …`
   - `cause / caused / breaks / broke / patched …`

3. Decision logic:

| Response type                              | Gate result                                    |
| ------------------------------------------ | ---------------------------------------------- |
| Explanatory / conversational (no claims)   | **Passes** — no evidence required.             |
| Claim present + evidence present           | **Passes** — claim is proven.                  |
| Claim present + no evidence                | **Blocked** — replaced with a truth message.   |

## The "context empty" bug (fixed)

The original gate blocked **every** response that lacked evidence markers,
including ordinary conversational replies. A legitimate 761-character answer was
swapped for the `truthMessage()` ("The agent produced a response but provided no
verifiable evidence…"), which made it look like the context was empty.

**Fix:** claim markers were introduced. The gate now only demands evidence when a
claim marker is present — explanatory text flows through untouched.

## Interaction with the empty-response retry

When the model returns nothing at all (e.g. 71 tools + ~50K input tokens), the
request handler retries once **without tools** before showing a diagnostic. The
Evidence Gate never sees an empty stream — it only evaluates real text.

## Truth message

When a claim is blocked, the user sees a message explaining that the response
made claims without providing verifiable evidence, plus a reminder of Mission
Barisal's evidence-first principle.
