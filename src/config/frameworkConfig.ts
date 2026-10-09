/**
 * Helpers for the framework-managed `configuration` object VS Code passes into
 * `provideLanguageModelChatInformation`. The configuration is populated from
 * the JSON schema declared under
 * `contributes.languageModelChatProviders[].configuration` in package.json,
 * including any properties marked `"secret": true` (which VS Code stores
 * itself instead of asking the provider to manage SecretStorage).
 *
 * Kept here as a pure module so the precedence logic can be unit-tested.
 */

export interface FrameworkConfigOverride {
  /**
   * API key supplied via the framework UI. Empty string is meaningful — it
   * represents an explicit "no key" choice from the user that should override
   * any value still stashed in SecretStorage from a previous Configure Server
   * run.
   */
  apiKey?: string;
  /**
   * Custom headers supplied via the framework UI. Empty object is meaningful —
   * it represents an explicit "no custom headers" choice that should override
   * any value still stashed in SecretStorage.
   */
  customHeaders?: Record<string, string>;
}

/**
 * Read the `apiKey` and `customHeaders` (if any) out of the framework-supplied configuration.
 *
 * Non-string values, unrelated keys, and a missing configuration all yield
 * `{}` — there is no override and the existing SecretStorage path applies.
 *
 * `serverUrl` is intentionally not extracted: keeping it in the workspace
 * settings preserves the per-window scope picker (issue #23) that lets
 * different VS Code windows point at different inference servers.
 */
export function readFrameworkConfiguration(
  configuration: { readonly [key: string]: unknown } | undefined | null
): FrameworkConfigOverride {
  if (!configuration || typeof configuration !== 'object') {
    return {};
  }
  const result: FrameworkConfigOverride = {};
  const apiKey = (configuration as { apiKey?: unknown }).apiKey;
  if (typeof apiKey === 'string') {
    result.apiKey = apiKey;
  }
  const customHeaders = (configuration as { customHeaders?: unknown }).customHeaders;
  // Check if customHeaders was explicitly provided (even as empty object)
  const hasCustomHeadersKey = configuration && typeof configuration === 'object' && 'customHeaders' in configuration;
  if (customHeaders && typeof customHeaders === 'object' && !Array.isArray(customHeaders)) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(customHeaders as Record<string, unknown>)) {
      if (typeof value === 'string' && key.length > 0) {
        headers[key] = value;
      }
    }
    // Always set customHeaders if explicitly provided, even if empty (user-cleared signal)
    if (Object.keys(headers).length > 0 || hasCustomHeadersKey) {
      result.customHeaders = headers;
    }
  }
  return result;
}

/**
 * Choose which API key to send with requests. The framework override wins when
 * set (including an explicit empty string — the user clearing the value in the
 * native UI shouldn't be silently overridden by a stale SecretStorage entry).
 * Otherwise the SecretStorage cache is used.
 */
export function resolveApiKey(
  override: FrameworkConfigOverride,
  secretCacheApiKey: string
): string {
  if (override.apiKey !== undefined) {
    return override.apiKey;
  }
  return secretCacheApiKey;
}

/**
 * Choose which custom headers to send with requests. The framework override wins when
 * set (including an explicit empty object — the user clearing the value in the
 * native UI shouldn't be silently overridden by a stale SecretStorage entry).
 * Otherwise the SecretStorage cache is used.
 */
export function resolveCustomHeaders(
  override: FrameworkConfigOverride,
  secretCacheCustomHeaders: Record<string, string>
): Record<string, string> {
  if (override.customHeaders !== undefined) {
    return override.customHeaders;
  }
  return secretCacheCustomHeaders;
}
