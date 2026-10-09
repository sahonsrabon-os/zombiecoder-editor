/**
 * Helpers for turning raw OpenAI `/v1/models` entries into the shape that the
 * VS Code Copilot Chat model picker renders nicely.
 *
 * Kept as its own module so it can be unit-tested without VS Code.
 */

import { OpenAIModel } from '../api/types';
import { serverReportedContext } from '../chat/contextWindow';
import { getPlatformName } from '../branding';

/**
 * Mission Barisal agent models — the 7 model IDs the server's `/v1/models`
 * endpoint returns with `owned_by: mission-barisal`. Recognizing them lets
 * the Copilot dropdown show persona display names and group them under the
 * `mission-barisal` family instead of the generic gateway fallback.
 */
export const MISSION_AGENT_FAMILY = 'mission-barisal';

/** Mission agent model id → persona display name shown in the picker. */
export const MISSION_AGENT_NAMES: Record<string, string> = {
  mission: 'Mission (All Agents)',
  'code-guru': 'Code Guru - Monu',
  'bug-hunter': 'Bug Hunter - Jewel',
  'security-hero': 'Security Hero - Bablu',
  'perf-wizard': 'Performance Wizard - Rashed',
  'doc-king': 'Documentation King - Halim',
  'qa-tyrant': 'Quality Tyrant - Mojnu',
};

/** Persona display name for a Mission Barisal agent model id, if recognized. */
export function missionAgentDisplayName(id: string): string | undefined {
  return MISSION_AGENT_NAMES[id];
}

export function isMissionAgent(id: string): boolean {
  return id in MISSION_AGENT_NAMES;
}

/**
 * Produce a display-friendly short name for a model ID.
 *
 * Hugging-Face-style IDs contain an org prefix (`Qwen/Qwen3-8B`) that the
 * Copilot model picker renders verbatim with a slash. Strip the prefix so the
 * picker shows `Qwen3-8B` (the owner is still available on the tooltip).
 *
 * Mission Barisal agent models are resolved to their persona display names
 * (`code-guru` → `Code Guru - Monu`) so the dropdown reads like the agent
 * board, not raw model ids.
 */
export function friendlyModelName(id: string): string {
  const persona = missionAgentDisplayName(id);
  if (persona) {
    return persona;
  }
  const slash = id.lastIndexOf('/');
  if (slash >= 0 && slash < id.length - 1) {
    return id.slice(slash + 1);
  }
  return id;
}

const FAMILY_KEYWORDS: Array<{ match: RegExp; family: string }> = [
  { match: /qwen/i, family: 'qwen' },
  { match: /llama/i, family: 'llama' },
  { match: /mistral/i, family: 'mistral' },
  { match: /mixtral/i, family: 'mixtral' },
  { match: /deepseek/i, family: 'deepseek' },
  { match: /phi/i, family: 'phi' },
  { match: /gemma/i, family: 'gemma' },
  { match: /gpt-?oss/i, family: 'gpt-oss' },
  { match: /yi[-_]/i, family: 'yi' },
  { match: /command[-_]?r/i, family: 'command-r' },
];

/**
 * Infer a VS Code `family` value from the model ID. Mission Barisal agent
 * models resolve to the `mission-barisal` family so they group together in
 * the picker; otherwise falls back to keyword matching, then `'llm-gateway'`
 * so the picker still groups all gateway models together.
 */
export function inferModelFamily(id: string): string {
  if (isMissionAgent(id)) {
    return MISSION_AGENT_FAMILY;
  }
  for (const { match, family } of FAMILY_KEYWORDS) {
    if (match.test(id)) { return family; }
  }
  return 'llm-gateway';
}

/**
 * Build a short description string highlighting context size and owner.
 * Used as the `detail` shown under the model name in the picker.
 */
export function describeModel(model: OpenAIModel): string {
  const context = serverReportedContext(model);
  const parts: string[] = [];
  if (context) {
    parts.push(`${formatTokens(context)} ctx`);
  }
  if (model.owned_by && model.owned_by !== 'organization-owner') {
    parts.push(model.owned_by === MISSION_AGENT_FAMILY ? getPlatformName() : model.owned_by);
  }
  return parts.join(' • ');
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) { return `${Math.round(n / 1_000_000)}M`; }
  if (n >= 1_000) { return `${Math.round(n / 1_000)}K`; }
  return String(n);
}

/**
 * Deduplicate a list of models by `id`, preserving first-seen order. Servers
 * occasionally return the same id twice (e.g. LoRA adapters sharing a base
 * model id); the picker shouldn't show duplicates.
 */
export function dedupeModels(models: readonly OpenAIModel[]): OpenAIModel[] {
  const seen = new Set<string>();
  const result: OpenAIModel[] = [];
  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      result.push(model);
    }
  }
  return result;
}
