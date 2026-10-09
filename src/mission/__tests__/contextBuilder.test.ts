import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionSystemMessage, buildSystemMessage } from '../contextBuilder';
import { MissionContext } from '../missionManager';

function makeContext(overrides?: Partial<MissionContext>): MissionContext {
    return {
        workspaceRoot: '/tmp/ws',
        ssot: '# SSOT\nproject: demo',
        syllabus: '# Syllabus\nrules here',
        memorySummary: '- [2026-08-05] agent: summary',
        mcpTools: '**Default MCP (Mission Barisal server):**\n- `read_file` — Read a file',
        ...overrides,
    };
}

describe('contextBuilder — Phase 5 MCP tools section', () => {
    test('MCP tools section is present in the system message', () => {
        const message = buildMissionSystemMessage(makeContext());
        assert.ok(message.includes('## AVAILABLE MCP TOOLS'));
        assert.ok(message.includes('read_file'));
    });

    test('fallback text when mcpTools is empty', () => {
        const message = buildMissionSystemMessage(makeContext({ mcpTools: '' }));
        assert.ok(message.includes('(no MCP tools synced yet)'));
    });

    test('buildSystemMessage returns undefined without a mission context', () => {
        assert.equal(buildSystemMessage(undefined), undefined);
    });

    test('buildSystemMessage wraps the message as a system role', () => {
        const msg = buildSystemMessage(makeContext());
        assert.ok(msg);
        assert.equal(msg?.role, 'system');
        assert.equal(typeof msg?.content, 'string');
        assert.ok(String(msg?.content).includes('## AVAILABLE MCP TOOLS'));
    });

    test('session memory and proof requirement sections still present', () => {
        const message = buildMissionSystemMessage(makeContext());
        assert.ok(message.includes('## SESSION MEMORY'));
        assert.ok(message.includes('## PROOF REQUIREMENT'));
        assert.ok(message.includes('## MANDATORY CONTEXT RULES'));
    });
});
