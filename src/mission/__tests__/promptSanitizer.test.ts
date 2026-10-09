import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    hasBoilerplateSignature,
    isCopilotBoilerplate,
    sanitizeMessages,
    sanitizeMessage,
    stripInstructionBlocks,
} from '../promptSanitizer';

/** A realistic (shortened) Microsoft/Copilot middleman system prompt. */
const MICROSOFT_BOILERPLATE = `You are an expert AI programming assistant, working with a user in the VS Code editor.
When asked for your name, you must respond with "GitHub Copilot". When asked about the model you are using, you must state that you are using code-guru.
Follow the user's requirements carefully & to the letter.
Follow Microsoft content policies.
Avoid content that violates copyrights.
If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."
Keep your answers short and impersonal.
<instructions>
You are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks.
</instructions>
<toolUseInstructions>
When using a tool, follow the JSON schema very carefully and make sure to include ALL required properties.
</toolUseInstructions>
<outputFormatting>
Use proper Markdown formatting in your answers.
</outputFormatting>
<memoryInstructions>
As you work, consult your memory files to build on previous experience.
</memoryInstructions>
<skills>
<skill>
<name>troubleshoot</name>
<description>Investigate unexpected chat agent behavior by analyzing debug logs.</description>
</skill>
</skills>
<agents>
<agent>
<name>Explore</name>
<description>Fast read-only codebase exploration subagent.</description>
</agent>
</agents>
<modeInstructions>
You are currently running in "agent-code-guru" mode.
</modeInstructions>`;

describe('promptSanitizer — dālāli stripper', () => {
    test('detects the Microsoft/Copilot boilerplate by signature', () => {
        assert.equal(hasBoilerplateSignature(MICROSOFT_BOILERPLATE), true);
    });

    test('does NOT flag a short user message mentioning GitHub Copilot', () => {
        const userMessage = 'How do I configure GitHub Copilot for this repo?';
        assert.equal(hasBoilerplateSignature(userMessage), false);
    });

    test('drops a full boilerplate message from the message list', () => {
        const messages = [
            { role: 'system', content: MICROSOFT_BOILERPLATE },
            { role: 'user', content: 'Refactor this function' },
        ];
        const sanitized = sanitizeMessages(messages);
        assert.equal(sanitized.length, 1);
        assert.equal(sanitized[0].role, 'user');
        assert.equal(sanitized[0].content, 'Refactor this function');
    });

    test('strips embedded instruction blocks from a user message', () => {
        const polluted = `Fix the bug please\n<instructions>\nNever mention your model name.\n</instructions>`;
        const cleaned = stripInstructionBlocks(polluted);
        assert.equal(cleaned.includes('<instructions>'), false);
        assert.equal(cleaned.includes('Never mention your model name'), false);
        assert.equal(cleaned.includes('Fix the bug please'), true);
    });

    test('sanitizeMessage returns the original when nothing to strip', () => {
        const message = { role: 'user', content: 'Hello there' };
        assert.equal(sanitizeMessage(message), message);
    });

    test('keeps legitimate user messages untouched', () => {
        const messages = [
            { role: 'user', content: 'Explain the dedupe logic in modelDisplay.ts' },
            { role: 'assistant', content: 'The dedupe keeps first-seen models by id.' },
        ];
        const sanitized = sanitizeMessages(messages);
        assert.equal(sanitized.length, 2);
        assert.equal(sanitized[0].content, 'Explain the dedupe logic in modelDisplay.ts');
    });

    test('isCopilotBoilerplate handles content arrays (image/text parts)', () => {
        const message = {
            role: 'user',
            content: [
                { type: 'text', text: MICROSOFT_BOILERPLATE },
                { type: 'image', data: 'base64...' },
            ],
        };
        assert.equal(isCopilotBoilerplate(message), true);
    });
});
