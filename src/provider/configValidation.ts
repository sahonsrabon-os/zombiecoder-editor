import { GatewayConfig } from '../config/gatewayConfig';
import { TOKEN_CONSTANTS } from '../chat/tokenBudget';
import { LOCAL_FALLBACK_SERVER_URL } from '../config/endpoints';

export const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
/** Maximum value for setTimeout (signed 32-bit integer). */
export const MAX_REQUEST_TIMEOUT_MS = 2147483647;
/**
 * Fallback URL for a *local* OpenAI-compatible server, used when the user has
 * not configured one. This is the single acknowledged default (see
 * `config/endpoints`); it is never an implicit remote selection.
 */
export const FALLBACK_SERVER_URL = LOCAL_FALLBACK_SERVER_URL;

/**
 * Problems found (and auto-corrected) while validating a raw config. The
 * config service maps these onto log lines and de-duplicated toasts; keeping
 * them as data makes the validation rules unit-testable without `vscode`.
 */
export type ConfigIssue =
  | { kind: 'invalidRequestTimeout'; value: number }
  | { kind: 'requestTimeoutClamped'; value: number }
  | { kind: 'invalidServerUrl'; url: string }
  | { kind: 'outputTokensAdjusted'; output: number; total: number; adjusted: number };

/**
 * Validate a raw config and auto-correct invalid values. Pure — returns the
 * corrected config plus the list of issues found so the caller can decide
 * how to surface them.
 */
export function validateGatewayConfig(raw: GatewayConfig): {
  config: GatewayConfig;
  issues: ConfigIssue[];
} {
  const cfg: GatewayConfig = { ...raw };
  const issues: ConfigIssue[] = [];

  if (cfg.requestTimeout <= 0) {
    issues.push({ kind: 'invalidRequestTimeout', value: cfg.requestTimeout });
    cfg.requestTimeout = DEFAULT_REQUEST_TIMEOUT_MS;
  } else if (cfg.requestTimeout > MAX_REQUEST_TIMEOUT_MS) {
    issues.push({ kind: 'requestTimeoutClamped', value: cfg.requestTimeout });
    cfg.requestTimeout = MAX_REQUEST_TIMEOUT_MS;
  }

  // Empty/whitespace URL means "not configured yet" — resolve it to the local
  // fallback silently (the transport layer then auto-detects a local server by
  // probing the socket first). Only a *malformed* URL is a user-facing issue.
  if (!cfg.serverUrl || !cfg.serverUrl.trim()) {
    cfg.serverUrl = FALLBACK_SERVER_URL;
  } else {
    try {
      new URL(cfg.serverUrl);
    } catch {
      issues.push({ kind: 'invalidServerUrl', url: cfg.serverUrl });
      cfg.serverUrl = FALLBACK_SERVER_URL;
    }
  }

  if (cfg.defaultMaxOutputTokens >= cfg.defaultMaxTokens) {
    const adjusted = Math.max(
      TOKEN_CONSTANTS.MIN_OUTPUT_TOKENS,
      cfg.defaultMaxTokens - TOKEN_CONSTANTS.ADJUST_TOKEN_BUFFER
    );
    issues.push({
      kind: 'outputTokensAdjusted',
      output: cfg.defaultMaxOutputTokens,
      total: cfg.defaultMaxTokens,
      adjusted,
    });
    cfg.defaultMaxOutputTokens = adjusted;
  }

  return { config: cfg, issues };
}
