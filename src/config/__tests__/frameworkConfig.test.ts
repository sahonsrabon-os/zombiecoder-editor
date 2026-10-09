import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFrameworkConfiguration, resolveApiKey, resolveCustomHeaders } from '../frameworkConfig';

describe('readFrameworkConfiguration', () => {
  test('returns an empty override when configuration is undefined', () => {
    assert.deepEqual(readFrameworkConfiguration(undefined), {});
  });

  test('returns an empty override when configuration is null', () => {
    assert.deepEqual(readFrameworkConfiguration(null), {});
  });

  test('returns an empty override when configuration is an empty object', () => {
    assert.deepEqual(readFrameworkConfiguration({}), {});
  });

  test('extracts a non-empty apiKey when present', () => {
    assert.deepEqual(readFrameworkConfiguration({ apiKey: 'sk-1234' }), {
      apiKey: 'sk-1234',
    });
  });

  test('preserves an explicit empty-string apiKey (user-cleared in native UI)', () => {
    assert.deepEqual(readFrameworkConfiguration({ apiKey: '' }), { apiKey: '' });
  });

  test('ignores apiKey when it is not a string', () => {
    assert.deepEqual(readFrameworkConfiguration({ apiKey: 42 }), {});
    assert.deepEqual(readFrameworkConfiguration({ apiKey: null }), {});
    assert.deepEqual(readFrameworkConfiguration({ apiKey: true }), {});
    assert.deepEqual(readFrameworkConfiguration({ apiKey: { nested: 'x' } }), {});
  });

  test('extracts customHeaders when present', () => {
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: { 'X-Custom': 'value' } }), {
      customHeaders: { 'X-Custom': 'value' },
    });
  });

  test('preserves an explicit empty-object customHeaders (user-cleared in native UI)', () => {
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: {} }), { customHeaders: {} });
  });

  test('ignores customHeaders when it is not an object', () => {
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: 'not-an-object' }), {});
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: ['array'] }), {});
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: 42 }), {});
    assert.deepEqual(readFrameworkConfiguration({ customHeaders: null }), {});
  });

  test('filters out non-string header values and empty names', () => {
    assert.deepEqual(
      readFrameworkConfiguration({ customHeaders: { 'X-Valid': 'value', '': 'empty-name', 'X-Number': 42, 'X-Null': null } }),
      { customHeaders: { 'X-Valid': 'value' } }
    );
  });

  test('does not extract serverUrl (kept in workspace settings for issue #23)', () => {
    assert.deepEqual(
      readFrameworkConfiguration({ apiKey: 'k', serverUrl: 'http://x' }),
      { apiKey: 'k' }
    );
  });

  test('ignores unrelated keys', () => {
    assert.deepEqual(
      readFrameworkConfiguration({ unknown: 'foo', extra: 123 }),
      {}
    );
  });

  test('extracts both apiKey and customHeaders together', () => {
    assert.deepEqual(
      readFrameworkConfiguration({ apiKey: 'sk-123', customHeaders: { 'X-Api-Key': '${apiKey}' } }),
      { apiKey: 'sk-123', customHeaders: { 'X-Api-Key': '${apiKey}' } }
    );
  });
});

describe('resolveApiKey', () => {
  test('returns the framework override when set to a non-empty string', () => {
    assert.equal(resolveApiKey({ apiKey: 'sk-framework' }, 'sk-secret'), 'sk-framework');
  });

  test('returns the framework override when explicitly cleared to empty string', () => {
    // The user pressing "clear" in the native UI should override any stale
    // SecretStorage entry, otherwise we'd silently re-authenticate with an
    // old credential.
    assert.equal(resolveApiKey({ apiKey: '' }, 'sk-secret'), '');
  });

  test('falls back to the SecretStorage cache when override is unset', () => {
    assert.equal(resolveApiKey({}, 'sk-secret'), 'sk-secret');
  });

  test('returns empty string when both override and cache are unset', () => {
    assert.equal(resolveApiKey({}, ''), '');
  });

  test('framework override of empty string still wins over a non-empty cache', () => {
    assert.equal(resolveApiKey({ apiKey: '' }, 'leftover-secret'), '');
  });
});

describe('resolveCustomHeaders', () => {
  test('returns the framework override when set', () => {
    assert.deepEqual(
      resolveCustomHeaders({ customHeaders: { 'X-Custom': 'value' } }, { 'X-Secret': 'secret' }),
      { 'X-Custom': 'value' }
    );
  });

  test('returns the framework override when explicitly cleared to empty object', () => {
    assert.deepEqual(resolveCustomHeaders({ customHeaders: {} }, { 'X-Secret': 'secret' }), {});
  });

  test('falls back to the SecretStorage cache when override is unset', () => {
    assert.deepEqual(resolveCustomHeaders({}, { 'X-Secret': 'secret' }), { 'X-Secret': 'secret' });
  });

  test('returns empty object when both override and cache are unset', () => {
    assert.deepEqual(resolveCustomHeaders({}, {}), {});
  });

  test('framework override of empty object still wins over a non-empty cache', () => {
    assert.deepEqual(resolveCustomHeaders({ customHeaders: {} }, { 'X-Leftover': 'secret' }), {});
  });
});
