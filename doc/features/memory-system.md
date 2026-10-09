# Memory System: SSOT + Syllabus + Session Memory

Mission Barisal maintains a **three-file memory system** so every agent has
consistent, verified context — never guesses.

## The three files

| File                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `.zombiecoder/SSOT.md` | **Single Source of Truth** — auto-detected project info, current state, verified facts. |
| `syllabus.md` (agent knowledge) | Rules, personas, provider configs, type-safety chain — the "law" every agent follows. |
| `memory.json` (session memory) | Per-conversation notes, session archives, previous context summaries. |

## Decision rule

> **আগে SSOT। তারপর Logic। তারপর Code।** — SSOT first, then logic, then code.

If information is missing from all three files, the agent must say
*"এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই"* (I don't have this information right
now) — and may use **web search** before ever guessing.

## What the extension does with memory

`src/mission/contextBuilder.ts` builds the system message for every request:

1. Reads `.zombiecoder/SSOT.md` (if present).
2. Reads the agent syllabus / knowledge file.
3. Reads session memory (per-workspace conversation notes).
4. Prepend all of it as a clean system message — so the server-side agents know
   the project state without re-scanning.

`src/mission/ssotManager.ts` scans the project and regenerates SSOT when missing
(`mkdir -p .zombiecoder` → scan → generate). `memoryManager.ts` stores and
retrieves session memory. `workspaceWatcher.ts` re-syncs when files change.

## Bounded parameters

SSOT, Memory, and Syllabus are **bounded**: if an input falls outside them, the
agent answers "আমার কাছে প্রমাণ নেই" (I have no proof) instead of inventing data.
