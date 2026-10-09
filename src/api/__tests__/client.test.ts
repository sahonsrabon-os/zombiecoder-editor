import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CompletionHttpError,
  GatewayClient,
  normalizeBaseUrl,
  normalizeApiKey,
  buildHeaders,
  extractUsage,
} from '../client';

describe('normalizeBaseUrl', () => {
  test('returns the URL unchanged when no normalization is needed', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3000'), 'http://localhost:3000');
  });

  test('strips trailing slashes', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
    assert.equal(normalizeBaseUrl('http://localhost:3000///'), 'http://localhost:3000');
  });

  test('strips a trailing /v1 (the most common user mistake)', () => {
    assert.equal(normalizeBaseUrl('http://localhost:3000/v1'), 'http://localhost:3000');
    assert.equal(normalizeBaseUrl('http://localhost:3000/v1/'), 'http://localhost:3000');
  });

  test('strips a trailing /openai/v1 (Azure-style endpoints)', () => {
    assert.equal(normalizeBaseUrl('https://x/openai/v1'), 'https://x');
    assert.equal(normalizeBaseUrl('https://x/openai/v1/'), 'https://x');
  });

  test('preserves other path segments', () => {
    assert.equal(normalizeBaseUrl('http://host/proxy'), 'http://host/proxy');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(normalizeBaseUrl('  http://localhost:3000  '), 'http://localhost:3000');
  });
});

describe('normalizeApiKey', () => {
  test('returns empty string for undefined / empty input', () => {
    assert.equal(normalizeApiKey(undefined), '');
    assert.equal(normalizeApiKey(''), '');
    assert.equal(normalizeApiKey('   '), '');
  });

  test('returns the key unchanged when no Bearer prefix', () => {
    assert.equal(normalizeApiKey('sk-abc'), 'sk-abc');
  });

  test('strips a leading "Bearer " prefix', () => {
    assert.equal(normalizeApiKey('Bearer sk-abc'), 'sk-abc');
    assert.equal(normalizeApiKey('bearer sk-abc'), 'sk-abc');
    assert.equal(normalizeApiKey('BEARER  sk-abc'), 'sk-abc');
  });

  test('trims surrounding whitespace before stripping', () => {
    assert.equal(normalizeApiKey('   Bearer sk-abc   '), 'sk-abc');
  });
});

describe('buildHeaders', () => {
  test('returns empty headers when no apiKey or customHeaders are set', () => {
    assert.deepEqual(buildHeaders(undefined, undefined), {});
    assert.deepEqual(buildHeaders('', {}), {});
  });

  test('sets Bearer Authorization from a normalized apiKey', () => {
    assert.deepEqual(buildHeaders('sk-abc', undefined), { Authorization: 'Bearer sk-abc' });
    assert.deepEqual(buildHeaders('Bearer sk-abc', undefined), { Authorization: 'Bearer sk-abc' });
  });

  test('merges customHeaders alongside Authorization', () => {
    const headers = buildHeaders('sk-abc', {
      'Anthropic-Version': '2024-01-01',
      'OpenAI-Organization': 'org_xyz',
    });
    assert.equal(headers['Authorization'], 'Bearer sk-abc');
    assert.equal(headers['Anthropic-Version'], '2024-01-01');
    assert.equal(headers['OpenAI-Organization'], 'org_xyz');
  });

  test('customHeaders can override Authorization for non-Bearer auth schemes', () => {
    const headers = buildHeaders('sk-abc', { Authorization: 'Token raw-token' });
    assert.equal(headers['Authorization'], 'Token raw-token');
  });

  test('drops headers with non-string values or empty names', () => {
    const headers = buildHeaders(undefined, {
      Valid: 'yes',
      '': 'no-name',
      // Simulate a JSON-loaded value that wasn't a string.
      Bogus: 42 as unknown as string,
    });
    assert.equal(headers['Valid'], 'yes');
    assert.equal(headers[''], undefined);
    assert.equal(headers['Bogus'], undefined);
  });

  test('suppresses default Authorization when user supplies Authorization header', () => {
    const headers = buildHeaders('sk-abc', { Authorization: 'Bearer user-token' });
    assert.equal(headers['Authorization'], 'Bearer user-token');
    // Should NOT have the default Bearer sk-abc
  });

  test('suppresses default Authorization when user supplies api-key header', () => {
    const headers = buildHeaders('sk-abc', { 'api-key': 'azure-key' });
    assert.equal(headers['api-key'], 'azure-key');
    assert.equal(headers['Authorization'], undefined);
  });

  test('suppresses default Authorization when user supplies x-api-key header', () => {
    const headers = buildHeaders('sk-abc', { 'x-api-key': 'custom-key' });
    assert.equal(headers['x-api-key'], 'custom-key');
    assert.equal(headers['Authorization'], undefined);
  });

  test('suppresses default Authorization when user supplies x-goog-api-key header', () => {
    const headers = buildHeaders('sk-abc', { 'x-goog-api-key': 'google-key' });
    assert.equal(headers['x-goog-api-key'], 'google-key');
    assert.equal(headers['Authorization'], undefined);
  });

  test('suppresses default Authorization when user supplies apikey header', () => {
    const headers = buildHeaders('sk-abc', { 'apikey': 'legacy-key' });
    assert.equal(headers['apikey'], 'legacy-key');
    assert.equal(headers['Authorization'], undefined);
  });

  test('case-insensitive auth header suppression', () => {
    const headers = buildHeaders('sk-abc', { 'AUTHORIZATION': 'Bearer upper' });
    assert.equal(headers['AUTHORIZATION'], 'Bearer upper');
    assert.equal(headers['authorization'], undefined);
  });

  test('interpolates ${apiKey} in custom header values', () => {
    const headers = buildHeaders('sk-secret', {
      'Authorization': 'Bearer ${apiKey}',
      'X-Custom': 'prefix-${apiKey}-suffix',
    });
    assert.equal(headers['Authorization'], 'Bearer sk-secret');
    assert.equal(headers['X-Custom'], 'prefix-sk-secret-suffix');
  });

  test('interpolates multiple ${apiKey} occurrences', () => {
    const headers = buildHeaders('sk-secret', {
      'X-Double': '${apiKey}-and-${apiKey}',
    });
    assert.equal(headers['X-Double'], 'sk-secret-and-sk-secret');
  });

  test('leaves headers without ${apiKey} unchanged', () => {
    const headers = buildHeaders('sk-secret', {
      'X-No-Interpolation': 'static-value',
    });
    assert.equal(headers['X-No-Interpolation'], 'static-value');
  });

  test('custom headers without auth header still get default Authorization', () => {
    const headers = buildHeaders('sk-abc', { 'X-Custom': 'value' });
    assert.equal(headers['Authorization'], 'Bearer sk-abc');
    assert.equal(headers['X-Custom'], 'value');
  });

  test('empty apiKey with custom auth header still uses custom auth', () => {
    const headers = buildHeaders('', { 'Authorization': 'Bearer user-token' });
    assert.equal(headers['Authorization'], 'Bearer user-token');
  });
});

describe('extractUsage', () => {
  test('returns undefined for non-objects', () => {
    assert.equal(extractUsage(undefined), undefined);
    assert.equal(extractUsage(null), undefined);
    assert.equal(extractUsage('foo'), undefined);
    assert.equal(extractUsage(123), undefined);
  });

  test('returns undefined when no token fields are present', () => {
    // A proxy that strips usage entirely (issue #24 scenario) returns
    // either no `usage` object at all or one with all fields missing.
    assert.equal(extractUsage({}), undefined);
    assert.equal(extractUsage({ prompt_tokens_details: { cached_tokens: 0 } }), undefined);
  });

  test('normalizes a typical OpenAI usage payload', () => {
    const result = extractUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 10 },
    });
    assert.deepEqual(result, {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 10 },
    });
  });

  test('defaults missing cached_tokens to 0', () => {
    const result = extractUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    assert.deepEqual(result?.prompt_tokens_details, { cached_tokens: 0 });
  });

  test('computes total_tokens from prompt+completion when the server omits it', () => {
    const result = extractUsage({
      prompt_tokens: 20,
      completion_tokens: 8,
    });
    assert.equal(result?.total_tokens, 28);
  });

  test('clamps sentinel negative values to 0', () => {
    // Some BYOK-style backends emit -1 for fields that aren't yet known.
    const result = extractUsage({
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1,
      prompt_tokens_details: { cached_tokens: -5 },
    });
    assert.deepEqual(result, {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
    });
  });

  test('drops non-finite numbers', () => {
    const result = extractUsage({
      prompt_tokens: Number.NaN,
      completion_tokens: 5,
      total_tokens: Number.POSITIVE_INFINITY,
    });
    assert.equal(result?.prompt_tokens, 0);
    assert.equal(result?.completion_tokens, 5);
    assert.equal(result?.total_tokens, 5);
  });
});

describe('CompletionHttpError', () => {
  test('exposes status and raw body for capability-specific handling', () => {
    const body = '{"error":{"message":"suffix is not currently supported"}}';
    const err = new CompletionHttpError('Completion failed: 400 Bad Request', 400, body);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'CompletionHttpError');
    assert.equal(err.status, 400);
    assert.equal(err.body, body);
    assert.equal(err.message, 'Completion failed: 400 Bad Request');
  });
});

describe('streamChatCompletion reasoning field handling (issue #59)', () => {
  const config = {
    // Non-local hostname: keeps `preferUds` false so the mocked HTTP fetch
    // path is exercised — a localhost URL would probe the REAL
    // /tmp/zombiecoder/mcp.sock (which now answers JSON-RPC `tools/list`) and
    // the test would talk to the live socket instead of the SSE mock.
    serverUrl: 'http://models.example.test:11434',
    mcpServerUrl: '',
    requestTimeout: 5000,
    defaultMaxTokens: 4096,
    defaultMaxOutputTokens: 4096,
    enableImageInput: false,
    enableToolCalling: true,
    parallelToolCalling: false,
    agentTemperature: 0,
    verboseLogging: false,
    customHeaders: {},
    extraModelOptions: {},
    perModelOptions: {},
    modelContextWindows: {},
    enableInlineCompletion: false,
    inlineCompletionModel: '',
    inlineCompletionMaxTokens: 128,
    inlineCompletionDebounce: 300,
    inlineCompletionTimeout: 5000,
    inlineCompletionMaxPrefixChars: 4000,
    inlineCompletionMaxSuffixChars: 2000,
  };

  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => undefined }),
  } as unknown as import('vscode').CancellationToken;

  function sseResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('\n\n') + '\n\n'));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  async function collectReasoning(lines: string[]): Promise<string[]> {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => sseResponse(lines);
    try {
      const client = new GatewayClient(config);
      const reasoning: string[] = [];
      for await (const chunk of client.streamChatCompletion(
        { model: 'qwen3:14b', messages: [] },
        token
      )) {
        if (chunk.reasoning_content) { reasoning.push(chunk.reasoning_content); }
      }
      return reasoning;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  test('surfaces Ollama-style `reasoning` deltas as reasoning_content', async () => {
    const reasoning = await collectReasoning([
      'data: {"choices":[{"delta":{"role":"assistant","content":"","reasoning":"Okay"}}]}',
      'data: {"choices":[{"delta":{"content":"","reasoning":", thinking"}}]}',
      'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]);
    assert.deepEqual(reasoning, ['Okay', ', thinking']);
  });

  test('prefers `reasoning_content` when both fields are present', async () => {
    const reasoning = await collectReasoning([
      'data: {"choices":[{"delta":{"reasoning_content":"canonical","reasoning":"alias"}}]}',
      'data: [DONE]',
    ]);
    assert.deepEqual(reasoning, ['canonical']);
  });

  test('surfaces `reasoning` from non-streaming message payloads', async () => {
    const reasoning = await collectReasoning([
      'data: {"choices":[{"message":{"content":"done","reasoning":"thought"}}]}',
      'data: [DONE]',
    ]);
    assert.deepEqual(reasoning, ['thought']);
  });
});
