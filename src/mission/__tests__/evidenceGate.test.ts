import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceGate, GatedStreamReporter } from '../evidenceGate';
import { StreamReporter } from '../../chat/responseStreamer';

function makeReporter(): { reporter: StreamReporter; texts: string[] } {
    const texts: string[] = [];
    const reporter: StreamReporter = {
        reportText: (text) => texts.push(text),
        reportThinking: () => { /* no-op */ },
        reportThinkingDone: () => { /* no-op */ },
        reportToolCall: () => { /* no-op */ },
        reportUsage: () => { /* no-op */ },
    };
    return { reporter, texts };
}

describe('EvidenceGate — Phase 3 proof gate', () => {
    test('passes trivial chatter below min length', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate('hello!');
        assert.equal(verdict.passed, true);
    });

    test('passes empty response', () => {
        const gate = new EvidenceGate();
        assert.equal(gate.evaluate('').passed, true);
        assert.equal(gate.evaluate('   ').passed, true);
    });

    test('passes file:line references', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate(
            'The bug is in src/api/client.ts:245 where fetchModels builds the URL.'
        );
        assert.equal(verdict.passed, true);
        assert.equal(verdict.matched.length > 0, true);
    });

    test('passes bare source paths', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate('I changed src/provider/chatRequestHandler.ts to add the gate.');
        assert.equal(verdict.passed, true);
    });

    test('passes test-output evidence', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate('# tests 424, # pass 424, # fail 0');
        assert.equal(verdict.passed, true);
    });

    test('passes exit-code evidence', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate('TSC exited with code 0, so the build is clean.');
        assert.equal(verdict.passed, true);
    });

    test('passes inline code quotes', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate('I called `buildFinalMessages()` and it returned 3 messages.');
        assert.equal(verdict.passed, true);
    });

    test('passes truth-confessions (Bengali)', () => {
        const gate = new EvidenceGate();
        assert.equal(
            gate.evaluate('ভাইয়া, এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই। আমি আর কিছু বলতে পারবো না।').passed,
            true
        );
        assert.equal(gate.evaluate('আমার কাছে প্রমাণ নেই।').passed, true);
    });

    test('passes truth-confessions (English)', () => {
        const gate = new EvidenceGate();
        assert.equal(gate.evaluate('I have no proof of that claim.').passed, true);
        assert.equal(gate.evaluate("I can't verify this without running the tests.").passed, true);
    });

    test('blocks substantive unproven claims', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate(
            'I fixed the authentication bug in the codebase, but I have not shown any file ' +
            'reference, line number, test output or quote to prove it, so this claim is ' +
            'unproven and the evidence gate must block it.'
        );
        assert.equal(verdict.passed, false);
    });

    test('passes explanatory answers that make no claims', () => {
        const gate = new EvidenceGate();
        const verdict = gate.evaluate(
            'Here is how the request pipeline works: the extension converts the messages, ' +
            'budgets the context window, streams the response, and repairs any malformed ' +
            'tool calls before handing them to Copilot. That is the whole flow in short.'
        );
        assert.equal(verdict.passed, true);
    });

    test('honors custom extra patterns', () => {
        const gate = new EvidenceGate({ extraPatterns: [/\bFIXED-\d+\b/] });
        const verdict = gate.evaluate('This resolves ticket FIXED-42 in the pipeline.');
        assert.equal(verdict.passed, true);
        assert.equal(verdict.matched[0], 'FIXED-42');
    });
});

describe('GatedStreamReporter — buffered flush', () => {
    test('flushes buffered text when evidence passes', () => {
        const { reporter, texts } = makeReporter();
        const gate = new EvidenceGate();
        const gated = new GatedStreamReporter(reporter, gate, () => { /* no-op */ });

        gated.reportText('The fix is in ');
        gated.reportText('src/api/client.ts:245');
        gated.reportText('. Tests pass: 424/424.');
        gated.flush();

        assert.deepEqual(texts, [
            'The fix is in ',
            'src/api/client.ts:245',
            '. Tests pass: 424/424.',
        ]);
    });

    test('replaces text with truth message when evidence fails', () => {
        const { reporter, texts } = makeReporter();
        const gate = new EvidenceGate();
        const gated = new GatedStreamReporter(reporter, gate, () => { /* no-op */ });

        gated.reportText(
            'I fixed the streaming bug in the architecture, but I provided no verifiable ' +
            'grounding, no file references, no test output and no quotes anywhere in this ' +
            'response, so the evidence gate should replace it with the truth message.'
        );
        gated.flush();

        assert.equal(texts.length, 1);
        assert.equal(texts[0].includes('প্রমাণ ছাড়া রেসপন্স'), true);
        assert.equal(texts[0].includes('no verifiable'), true);
    });

    test('forwards thinking and tool calls immediately (not gated)', () => {
        let thinking = 0;
        let toolCalls = 0;
        const reporter: StreamReporter = {
            reportText: () => { /* no-op */ },
            reportThinking: () => { thinking++; },
            reportThinkingDone: () => { /* no-op */ },
            reportToolCall: () => { toolCalls++; },
            reportUsage: () => { /* no-op */ },
        };
        const gate = new EvidenceGate();
        const gated = new GatedStreamReporter(reporter, gate, () => { /* no-op */ });

        gated.reportThinking('let me think');
        gated.reportToolCall('id-1', 'read_file', { path: 'x' });
        assert.equal(thinking, 1);
        assert.equal(toolCalls, 1);
    });

    test('flush is idempotent', () => {
        const { reporter, texts } = makeReporter();
        const gate = new EvidenceGate();
        const gated = new GatedStreamReporter(reporter, gate, () => { /* no-op */ });

        gated.reportText('src/foo.ts:10 has the answer. 5 tests pass.');
        gated.flush();
        gated.flush();

        // The second flush is guarded — the text is forwarded exactly once.
        assert.equal(texts.length, 1);
        assert.equal(texts[0], 'src/foo.ts:10 has the answer. 5 tests pass.');
    });
});
