import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_AGENT_FAMILY,
  dedupeModels,
  describeModel,
  friendlyModelName,
  inferModelFamily,
  isMissionAgent,
  missionAgentDisplayName,
} from '../modelDisplay';

describe('friendlyModelName', () => {
  test('strips Hugging-Face org prefix', () => {
    assert.equal(friendlyModelName('Qwen/Qwen3-8B'), 'Qwen3-8B');
    assert.equal(friendlyModelName('meta-llama/Llama-3.1-8B-Instruct'), 'Llama-3.1-8B-Instruct');
  });

  test('returns the id unchanged when there is no slash', () => {
    assert.equal(friendlyModelName('gpt-4o-mini'), 'gpt-4o-mini');
  });

  test('handles trailing slash without breaking', () => {
    assert.equal(friendlyModelName('foo/'), 'foo/');
  });

  test('resolves Mission Barisal agent models to persona names', () => {
    assert.equal(friendlyModelName('code-guru'), 'Code Guru - Monu');
    assert.equal(friendlyModelName('bug-hunter'), 'Bug Hunter - Jewel');
    assert.equal(friendlyModelName('mission'), 'Mission (All Agents)');
  });
});

describe('missionAgentDisplayName / isMissionAgent', () => {
  test('recognizes all 7 agent model ids', () => {
    const ids = ['mission', 'code-guru', 'bug-hunter', 'security-hero', 'perf-wizard', 'doc-king', 'qa-tyrant'];
    for (const id of ids) {
      assert.equal(isMissionAgent(id), true, `${id} should be a mission agent`);
      assert.ok(missionAgentDisplayName(id), `${id} should have a display name`);
    }
  });

  test('returns undefined for non-agent models', () => {
    assert.equal(missionAgentDisplayName('gpt-4o-mini'), undefined);
    assert.equal(isMissionAgent('qwen/Qwen3-8B'), false);
  });
});

describe('inferModelFamily', () => {
  test('detects known families', () => {
    assert.equal(inferModelFamily('Qwen/Qwen3-8B'), 'qwen');
    assert.equal(inferModelFamily('meta-llama/Llama-3.1-8B-Instruct'), 'llama');
    assert.equal(inferModelFamily('mistralai/Mistral-7B'), 'mistral');
    assert.equal(inferModelFamily('deepseek-ai/DeepSeek-V3'), 'deepseek');
  });

  test('falls back to llm-gateway for unknown models', () => {
    assert.equal(inferModelFamily('unknown-vendor/UnknownModel'), 'llm-gateway');
  });

  test('groups Mission Barisal agent models under the mission-barisal family', () => {
    assert.equal(inferModelFamily('code-guru'), MISSION_AGENT_FAMILY);
    assert.equal(inferModelFamily('qa-tyrant'), MISSION_AGENT_FAMILY);
    assert.equal(inferModelFamily('mission'), MISSION_AGENT_FAMILY);
  });
});

describe('describeModel', () => {
  test('uses max_model_len when present', () => {
    const detail = describeModel({
      id: 'x', object: 'model', created: 0, owned_by: 'vllm', max_model_len: 32768,
    });
    assert.ok(detail.includes('33K ctx'));
    assert.ok(detail.includes('vllm'));
  });

  test('falls back to context_length', () => {
    const detail = describeModel({
      id: 'x', object: 'model', created: 0, owned_by: 'ollama', context_length: 8192,
    });
    assert.ok(detail.includes('8K ctx'));
  });

  test('omits context when no size is reported', () => {
    const detail = describeModel({ id: 'x', object: 'model', created: 0, owned_by: 'whoever' });
    assert.ok(!detail.includes('ctx'));
    assert.ok(detail.includes('whoever'));
  });

  test('renders mission-barisal owned_by as the branded Mission Barisal label', () => {
    const detail = describeModel({
      id: 'code-guru', object: 'model', created: 0, owned_by: 'mission-barisal',
    });
    assert.ok(detail.includes('Mission Barisal'));
    assert.ok(!detail.includes('mission-barisal'));
  });
});

describe('dedupeModels', () => {
  test('removes duplicate ids, preserving first-seen order', () => {
    const models = [
      { id: 'a', object: 'model', created: 0, owned_by: 'x' },
      { id: 'b', object: 'model', created: 0, owned_by: 'x' },
      { id: 'a', object: 'model', created: 0, owned_by: 'y' },
    ];
    const result = dedupeModels(models);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((m) => m.id), ['a', 'b']);
  });

  test('returns the same list when all ids are unique', () => {
    const models = [
      { id: 'a', object: 'model', created: 0, owned_by: 'x' },
      { id: 'b', object: 'model', created: 0, owned_by: 'x' },
    ];
    const result = dedupeModels(models);
    assert.equal(result.length, 2);
  });
});
