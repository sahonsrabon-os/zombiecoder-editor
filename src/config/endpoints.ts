/**
 * endpoints — the single source of truth for connection defaults.
 *
 * No host/port literal is sprinkled across the source anymore: the one
 * acknowledged default (a local OpenAI-compatible server) lives here, and the
 * platform-correct socket location is computed from the runtime platform.
 *
 * Socket location:
 *   - Windows → a **named pipe**  (`\\.\pipe\zombiecoder-mcp`)
 *   - POSIX   → a **Unix domain socket** (`<tmpdir>/zombiecoder/mcp.sock`)
 *
 * Both forms are accepted by Node's `net.createConnection({ path })` and
 * `http.request({ socketPath })`, so the UDS transport code is shared. Override
 * either with the `ZOMBIECODER_UDS_PATH` environment variable.
 *
 * Dependency-free (Node builtins only) so pure modules and unit tests can use
 * it without pulling in `vscode`.
 */

import * as os from 'node:os';
import * as path from 'node:path';

/** Default port for the local inference server. */
export const DEFAULT_LOCAL_PORT = 3000;

/**
 * The single local fallback URL. Only used when a URL is required but none is
 * configured — it is a *placeholder* for the local server, never an implicit
 * remote selection.
 */
export const LOCAL_FALLBACK_SERVER_URL = `http://localhost:${DEFAULT_LOCAL_PORT}`;

/**
 * Windows named-pipe name for the MCP/chat socket. The pipe namespace is flat,
 * so a single hyphenated segment is used (no backslash inside the pipe name).
 */
export const WINDOWS_SOCKET_PATH = '\\\\.\\pipe\\zombiecoder-mcp';

/** True when `value` is a Windows named-pipe path (`\\.\pipe\…` or `//./pipe/…`). */
export function isWindowsPipePath(value: string): boolean {
  return /^\\\\[.?]\\pipe\\/i.test(value) || value.startsWith('//./pipe/');
}

/**
 * Compute the platform-correct default socket path.
 *
 * `ZOMBIECODER_UDS_PATH` always wins, so users running the server on a
 * non-default socket keep working on either OS.
 */
export function defaultSocketPath(platform: NodeJS.Platform = process.platform): string {
  const override = process.env.ZOMBIECODER_UDS_PATH;
  if (override && override.trim()) {
    return override.trim();
  }
  if (platform === 'win32') {
    return WINDOWS_SOCKET_PATH;
  }
  return path.join(os.tmpdir(), 'zombiecoder', 'mcp.sock');
}

/** Default socket path for the current process. */
export const DEFAULT_SOCKET_PATH = defaultSocketPath();
