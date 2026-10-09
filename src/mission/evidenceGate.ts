/**
 * evidenceGate — Phase 3. "Show proof, or tell the truth."
 *
 * Evaluates an agent's response text against evidence markers: file refs
 * (`path:line`), line numbers, test output, exit codes, inline code quotes.
 * If the response carries no verifiable proof AND is substantive (above
 * minLength), the {@link GatedStreamReporter} replaces the streamed text with
 * an honest "no proof" message — per syllabus 8.6:
 *
 *   "Only show response to user when agent can PROVE with evidence-based
 *    test. If cannot prove → tell the user the truth."
 *
 * Trivial chatter (greetings, short confirmations) and truth-confessions
 * ("আমার কাছে প্রমাণ নেই", "no proof") pass automatically: a response that
 * honestly admits it has no evidence is itself the truth.
 *
 * The core {@link EvidenceGate} is dependency-free (no `vscode` import) so it
 * is fully unit-testable; the streaming wrapper only needs the
 * {@link StreamReporter} interface from `src/chat/responseStreamer.ts`.
 */

import { StreamReporter } from '../chat/responseStreamer';
import { getPlatformName } from '../branding';

export interface EvidenceVerdict {
    /** True when the response may be shown to the user. */
    passed: boolean;
    /** Evidence markers that were found (e.g. `src/foo.ts:12`, `424 pass`). */
    matched: string[];
    /** Human-readable explanation of the verdict. */
    reason: string;
}

export interface EvidenceGateOptions {
    /** Responses strictly shorter than this are trivial chatter — always pass. */
    minLength?: number;
    /** Project-specific evidence patterns, appended after the built-ins. */
    extraPatterns?: RegExp[];
}

export const DEFAULT_MIN_LENGTH = 40;

/**
 * Patterns that count as "proof" in an agent response. Order matters only
 * for the matched[] report — evaluation stops at the first hit.
 */
const EVIDENCE_PATTERNS: RegExp[] = [
    // path/to/file.ts:12 — file ref with line number
    /\b[\w./\\-]+\.(ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql):\d+\b/,
    // src/... lib/... test/... out/... dist/... paths (no line number needed)
    /\b(?:src|lib|test|tests|__tests__|out|dist|app|components|pages|server|client)\/[\w./\\-]+\b/,
    // "line 42", "lines 12-14"
    /\bline[s]?\s+\d+(-\d+)?\b/i,
    // test output: "424 pass", "0 fail", "# pass 424", "ok 48", "1 error"
    /\b\d+\s*(?:pass|passed|fail|failed|error|errors|tests?|ok)\b/i,
    // "exit code 0", "exit 0", "TSC exited with code 0"
    /\bexit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0\b/i,
    // inline code / quoted symbols — `foo()`, `buildFinalMessages`
    /`[^`\n]{2,}`/,
    // explicit test-run references
    /\b(?:npm test|test suite|unit test|integration test|ran the tests?)\b/i,
];

/**
 * Patterns that count as the agent "telling the truth" — a confession passes
 * the gate because the response is honest about lacking proof.
 */
const TRUTH_PATTERNS: RegExp[] = [
    /আমার কাছে প্রমাণ নেই/,
    /প্রমাণ নেই/,
    /আমি নিশ্চিত না/,
    /এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই/,
    /ভাইয়া, এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই/,
    /no proof|no evidence|can'?t verify|cannot verify|don'?t have evidence|i don'?t know for sure/i,
];

/**
 * Claim markers — statements that assert the agent DID something to code or
 * facts ("I fixed X", "the bug is Y"). A response that makes no such claim is
 * explanatory / conversational / instructional and is shown as-is; only
 * claim-heavy responses are required to carry evidence. This stops the gate
 * from hiding normal answers (the "context empty" complaint) while still
 * blocking fabricated "I changed this file" claims without proof.
 */
const CLAIM_MARKERS: RegExp[] = [
    // "I fixed/changed/added/removed/updated/implemented/created/..."
    /\b(i|we)\s+(fixed|changed|added|removed|updated|implemented|created|deleted|refactored|moved|renamed|replaced|rewrote|wrote|built|installed|configured|enabled|disabled|patched|solved|resolved|renamed)\b/i,
    // "the bug is", "root cause", "the issue was"
    /\b(the|a)\s+(bug|root cause|issue|problem)\s+(is|was|lies|exists)\b/i,
    /\b(root cause|the problem is|the issue is|i found|i discovered|i located)\b/i,
    // cause/break/fix verbs
    /\b(cause|caused|causing|breaks|broke|fixes|fixed|patched)\b/i,
    // "I can/will/could fix/solve/implement/add"
    /\b(i\s+(can|will|could)\s+(fix|solve|implement|add|remove|update|change))\b/i,
];

/** Pure gate — decide whether a response may be shown. */
export class EvidenceGate {
    private readonly minLength: number;
    private readonly patterns: RegExp[];

    constructor(options?: EvidenceGateOptions) {
        this.minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;
        this.patterns = [...EVIDENCE_PATTERNS, ...(options?.extraPatterns ?? [])];
    }

    public evaluate(text: string): EvidenceVerdict {
        const trimmed = text.trim();

        // Empty or trivial chatter is not a claim — always show it.
        if (trimmed.length === 0 || trimmed.length < this.minLength) {
            return {
                passed: true,
                matched: [],
                reason: `trivial (${trimmed.length} chars < min ${this.minLength})`,
            };
        }

        // The agent already told the truth about lacking proof — show it.
        for (const truth of TRUTH_PATTERNS) {
            if (truth.test(trimmed)) {
                return { passed: true, matched: [], reason: 'agent stated lack of proof' };
            }
        }

        // First evidence marker wins the report; the response is proven.
        for (const pattern of this.patterns) {
            const match = trimmed.match(pattern);
            if (match && match[0]) {
                return { passed: true, matched: [match[0]], reason: `evidence: ${match[0]}` };
            }
        }

        // No claim markers → explanatory / conversational / instructional text.
        // These are not assertions about code changes, so hiding them would
        // make the chat feel empty (the very bug users reported). Show them.
        const makesClaim = CLAIM_MARKERS.some((marker) => marker.test(trimmed));
        if (!makesClaim) {
            return {
                passed: true,
                matched: [],
                reason: 'explanatory/conversational (no claim markers)',
            };
        }

        return {
            passed: false,
            matched: [],
            reason: 'claim without evidence: no file refs, line numbers, test output or quotes found',
        };
    }

    /** Honest replacement message shown when the gate blocks a response. */
    public truthMessage(originalLength: number): string {
        return (
            '**⚠️ প্রমাণ ছাড়া রেসপন্স (response without proof)**\n\n' +
            `The agent produced a response (${originalLength} chars) but provided no verifiable ` +
            'evidence — no file references (`path:line`), line numbers, test output or code quotes.\n\n' +
            `Per ${getPlatformName()} rules, unproven claims are not shown. ` +
            'Ask the agent for proof (e.g. "প্রমাণ দাও", "show the file:line", "run the test").'
        );
    }
}

/**
 * Streaming wrapper that buffers text parts while the response streams and
 * evaluates them against the gate when the stream completes:
 *   - passed  → flush the buffered text as-is,
 *   - blocked → flush the truth message instead of the unproven text.
 *
 * Thinking, tool calls and usage are forwarded immediately — they are not
 * claims and never gated.
 */
export class GatedStreamReporter implements StreamReporter {
    private readonly bufferedText: string[] = [];
    private bufferedLength = 0;
    private flushed = false;

    constructor(
        private readonly inner: StreamReporter,
        private readonly gate: EvidenceGate,
        private readonly log: (message: string) => void
    ) { }

    public reportText(text: string): void {
        this.bufferedText.push(text);
        this.bufferedLength += text.length;
    }

    public reportThinking(text: string): void {
        this.inner.reportThinking(text);
    }

    public reportThinkingDone(): void {
        this.inner.reportThinkingDone();
    }

    public reportToolCall(id: string, name: string, args: Record<string, unknown>): void {
        this.inner.reportToolCall(id, name, args);
    }

    public reportUsage(usage: Parameters<StreamReporter['reportUsage']>[0]): void {
        this.inner.reportUsage(usage);
    }

    /** Evaluate buffered text and flush either it or the truth message. */
    public flush(): void {
        if (this.flushed) {
            return;
        }
        this.flushed = true;

        const text = this.bufferedText.join('');
        if (text.length === 0) {
            return;
        }

        const verdict = this.gate.evaluate(text);
        if (verdict.passed) {
            this.log(`Evidence gate: PASSED (${verdict.reason})`);
            for (const part of this.bufferedText) {
                this.inner.reportText(part);
            }
        } else {
            this.log(`Evidence gate: BLOCKED (${verdict.reason})`);
            this.inner.reportText(this.gate.truthMessage(text.length));
        }
    }
}
