/**
 * promptSanitizer — the "dālāli" (middleman) stripper.
 *
 * VS Code injects a huge Microsoft/Copilot system prompt ahead of the user's
 * real request: identity forcing ("respond with GitHub Copilot"), content
 * policies, and a pile of `<instructions>`, `<toolUseInstructions>`,
 * `<notebookInstructions>`, `<outputFormatting>`, `<memoryInstructions>`,
 * `<skills>`, `<agents>` and `<modeInstructions>` blocks.
 *
 * None of that must reach Mission Barisal agents. This module detects the
 * boilerplate message(s) by signature and drops them, and strips any
 * embedded instruction blocks from surviving user messages.
 *
 * Phase 2 — Prompt Sanitizer.
 */

import { OpenAIMessage } from '../api/types';

type Logger = (message: string) => void;

/**
 * Signatures that identify the Microsoft/Copilot middleman prompt. A message
 * must hit at least {@link MIN_SIGNATURE_HITS} signatures AND exceed
 * {@link MIN_BOILERPLATE_LENGTH} characters to count — a short user message
 * that merely mentions "GitHub Copilot" must never be stripped.
 */
const BOILERPLATE_SIGNATURES: readonly RegExp[] = [
    /GitHub Copilot/i,
    /Microsoft content polic/i,
    /expert AI programming assistant/i,
    /Follow Microsoft/i,
    /When asked for your name/i,
    /violates copyrights/i,
    /highly sophisticated automated coding agent/i,
    /notebookInstructions/i,
    /toolUseInstructions/i,
    /modeInstructions/i,
];

const MIN_BOILERPLATE_LENGTH = 300;
const MIN_SIGNATURE_HITS = 2;

/** Instruction-block tags the middleman wraps around its rules. */
const INSTRUCTION_BLOCK_TAGS: readonly string[] = [
    'instructions',
    'toolUseInstructions',
    'notebookInstructions',
    'outputFormatting',
    'memoryInstructions',
    'skills',
    'agents',
    'modeInstructions',
    'context',
    'reminderInstructions',
    'userRequest',
];

/** Extract the plain text of a wire-format message (string or parts array). */
export function getMessageText(message: OpenAIMessage): string {
    const content = message.content;
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (part && typeof part === 'object') {
                    const record = part as Record<string, unknown>;
                    if (typeof record.text === 'string') {
                        return record.text;
                    }
                }
                return '';
            })
            .join('\n');
    }
    return '';
}

/** True when the text looks like the big Microsoft/Copilot system prompt. */
export function hasBoilerplateSignature(text: string): boolean {
    if (text.length < MIN_BOILERPLATE_LENGTH) {
        return false;
    }
    let hits = 0;
    for (const signature of BOILERPLATE_SIGNATURES) {
        signature.lastIndex = 0;
        if (signature.test(text)) {
            hits++;
        }
    }
    return hits >= MIN_SIGNATURE_HITS;
}

export function isCopilotBoilerplate(message: OpenAIMessage): boolean {
    return hasBoilerplateSignature(getMessageText(message));
}

/** Remove `<tag>…</tag>` blocks (and stray open/close tags) from text. */
export function stripInstructionBlocks(text: string): string {
    let result = text;
    for (const tag of INSTRUCTION_BLOCK_TAGS) {
        result = result.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
        result = result.replace(new RegExp(`<${tag}[^>]*>`, 'gi'), '');
        result = result.replace(new RegExp(`<\\/${tag}>`, 'gi'), '');
    }
    return result.trim();
}

/** Sanitize a single message: strip embedded instruction blocks in place. */
export function sanitizeMessage(message: OpenAIMessage): OpenAIMessage {
    const text = getMessageText(message);
    if (text.length === 0) {
        return message;
    }
    const cleaned = stripInstructionBlocks(text);
    if (cleaned !== text) {
        return { ...message, content: cleaned };
    }
    return message;
}

/**
 * Drop middleman boilerplate messages and scrub instruction blocks from the
 * rest. Returns a clean message list that only contains the user's intent.
 */
export function sanitizeMessages(
    messages: readonly OpenAIMessage[],
    log?: Logger
): OpenAIMessage[] {
    let dropped = 0;
    const result: OpenAIMessage[] = [];

    for (const message of messages) {
        if (isCopilotBoilerplate(message)) {
            dropped++;
            log?.(
                `  [mission] Dropped Copilot boilerplate message (${getMessageText(message).length} chars)`
            );
            continue;
        }
        result.push(sanitizeMessage(message));
    }

    if (dropped > 0) {
        log?.(
            `[mission] Sanitizer removed ${dropped} middleman message(s) — agents see only clean input`
        );
    }
    return result;
}
