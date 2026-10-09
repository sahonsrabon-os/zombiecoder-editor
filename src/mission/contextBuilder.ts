/**
 * contextBuilder — builds the clean Mission Barisal system message.
 *
 * Replaces the stripped Microsoft boilerplate with a compact, evidence-first
 * Mission context: persona + SSOT + syllabus + session memory + PROOF
 * REQUIREMENT + MANDATORY CONTEXT RULES (mirrors the server's
 * executeSingleAgent system-message assembly, api.js:7130-7220).
 *
 * Phase 2 — Prompt Sanitizer.
 */

import { OpenAIMessage } from '../api/types';
import { MissionContext } from './missionManager';
import { getPlatformName, getProductName } from '../branding';

export interface MissionSystemOptions {
    persona?: string;
}

const DEFAULT_PERSONA =
    `You are a ${getPlatformName()} agent — part of the ${getProductName()} multi-agent platform ` +
    'owned by Sahon Srabon (Barisal, Bangladesh). You are NOT a generic assistant. ' +
    'Follow the context below exactly.';

export function buildMissionSystemMessage(
    context: MissionContext,
    options?: MissionSystemOptions
): string {
    const persona = options?.persona?.trim() || DEFAULT_PERSONA;

    return [
        persona,
        '',
        '## MISSION BARISAL SYSTEM CONTEXT',
        context.ssot || '(SSOT not available for this workspace yet)',
        '',
        '## AGENT SYLLABUS',
        context.syllabus || '(syllabus not available yet)',
        '',
        '## SESSION MEMORY',
        context.memorySummary,
        '',
        '## AVAILABLE MCP TOOLS',
        context.mcpTools || '(no MCP tools synced yet)',
        '',
        '## PROOF REQUIREMENT',
        'You MUST provide verifiable evidence for EVERY claim. If you cannot provide ' +
        'evidence, say "আমার কাছে প্রমাণ নেই". Still help with what you know.',
        '',
        '## MANDATORY CONTEXT RULES',
        `1. PERSONA: follow your assigned ${getPlatformName()} persona exactly. Never break character.`,
        '2. SSOT/SYLLABUS/MEMORY: reference them. If info is missing, say "এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই।"',
        '3. WEB SEARCH: if SSOT/Syllabus/Memory lacks the answer, search the web. Do NOT guess.',
        `4. IDENTITY: you are NOT a generic assistant — you are a ${getPlatformName()} agent.`,
        '5. CONSTRAINT: if you lack data AND web search fails, say "ভাইয়া, এই মুহূর্তে আমার কাছে এই তথ্যগুলো নাই।" and stop.',
        '6. Code in professional English; chat with users in Bengali (Barishali style).',
    ].join('\n');
}

export function buildSystemMessage(
    missionContext: MissionContext | undefined,
    options?: MissionSystemOptions
): OpenAIMessage | undefined {
    if (!missionContext) {
        return undefined;
    }
    return { role: 'system', content: buildMissionSystemMessage(missionContext, options) };
}
