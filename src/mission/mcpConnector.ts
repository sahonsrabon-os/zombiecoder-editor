/**
 * mcpConnector — Phase 5: External MCP Connector (server-driven).
 *
 * The extension NEVER connects to MCP servers by raw port. Instead it talks
 * to the Mission Barisal server's `/mcp` endpoint (JSON-RPC 2.0) exactly the
 * way a real MCP client does:
 *
 *   1. `initialize`          → server announces protocolVersion + capabilities
 *   2. `notifications/initialized` → fire-and-forget handshake completion
 *   3. `tools/list`          → server returns its tool registry
 *   4. `tools/call`          → (future) invoke a tool through the server
 *
 * The default MCP is the server's own hardcoded registry (`MCP_TOOLS` in
 * api.js — read_file, write_file, web_search, agent_mission, ...). When the
 * user sets `mcpServerUrl` in settings, the connector ALSO fetches that
 * external server's tool list and normalizes ANY shape it returns (standard
 * MCP, OpenAI function style, loose name/description/parameters) into OUR
 * `McpToolDefinition` format — so agents always see a uniform, known list.
 *
 * Default and external tools are accounted separately (`source`), and when a
 * previously-unknown tool appears the connector fires the "ছটকা টান"
 * notification callback so the user (and the agent context) know a new MCP
 * just connected.
 *
 * Pure TypeScript — no vscode imports — so it is fully unit-testable.
 */

import * as fs from 'fs';
import {
    DEFAULT_UDS_PATH,
    resolveActiveTransport,
    udsJsonRpcRequest,
    udsRequest,
} from './transport';
import { isWindowsPipePath } from '../config/endpoints';
import { getPlatformName } from '../branding';

export type McpToolSource = 'default' | 'external';

/** Normalized tool shape — OUR format, regardless of what the server sent. */
export interface McpToolSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
}

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: McpToolSchema;
    /** `default` = the Mission Barisal server's own MCP_TOOLS registry. */
    source: McpToolSource;
    /** Which server URL this tool came from (provenance). */
    serverUrl: string;
}

export interface McpConnectorDeps {
    /**
     * Resolve the external MCP server URL. Empty string means "no external
     * MCP configured" — only the default server MCP is used.
     */
    getMcpServerUrl: () => string;
    /** Output-channel logger. */
    log: (message: string) => void;
    /**
     * "ছটকা টান" — fired when a previously-unknown tool appears after a
     * sync. The provider wires this to a VS Code notification.
     */
    onNewTools?: (tools: McpToolDefinition[]) => void;
    /**
     * Optional custom fetch for tests. Defaults to global `fetch`.
     */
    fetchImpl?: typeof fetch;
    /**
     * When false, bypasses the Phase 4 transport probe and always posts to
     * the `/mcp` HTTP endpoint via `fetchImpl`. Tests set this so they never
     * accidentally hit a real running server's UDS socket.
     */
    useTransport?: boolean;
    /**
     * Optional override for the default MCP socket path probed for JSON-RPC
     * `tools/list`. Defaults to `DEFAULT_UDS_PATH`. Tests inject a temp
     * socket so they never touch the real `/tmp/zombiecoder/mcp.sock`.
     */
    udsSocketPath?: string;
}

export interface McpSyncResult {
    /** All known tools after this sync (default + external). */
    tools: McpToolDefinition[];
    /** Tools that appeared since the previous sync (empty on first sync). */
    newTools: McpToolDefinition[];
    /** Set when the DEFAULT server MCP could not be reached. */
    defaultError?: string;
    /** Set when the EXTERNAL server MCP could not be reached. */
    externalError?: string;
}

const MCP_JSON_RPC_VERSION = '2.0';
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * Normalize a single raw tool entry into OUR `McpToolDefinition` format.
 * Handles three shapes:
 *   - Standard MCP:     `{ name, description, inputSchema }`
 *   - OpenAI function:  `{ function: { name, description, parameters } }`
 *   - Loose:            `{ name, description, parameters }`
 * Returns `undefined` when the entry has no recognizable name.
 */
export function normalizeMcpTool(
    raw: unknown,
    source: McpToolSource,
    serverUrl: string
): McpToolDefinition | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const entry = raw as Record<string, unknown>;

    // Standard MCP shape.
    if (typeof entry.name === 'string' && entry.inputSchema && typeof entry.inputSchema === 'object') {
        return {
            name: entry.name,
            description: typeof entry.description === 'string' ? entry.description : '',
            inputSchema: normalizeSchema(entry.inputSchema),
            source,
            serverUrl,
        };
    }

    // OpenAI function-call shape.
    const fn = entry.function as Record<string, unknown> | undefined;
    if (fn && typeof fn === 'object' && typeof fn.name === 'string') {
        return {
            name: fn.name,
            description: typeof fn.description === 'string' ? fn.description : '',
            inputSchema: normalizeSchema(
                (fn.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>
            ),
            source,
            serverUrl,
        };
    }

    // Loose shape: name + description + parameters.
    if (typeof entry.name === 'string' && entry.parameters && typeof entry.parameters === 'object') {
        return {
            name: entry.name,
            description: typeof entry.description === 'string' ? entry.description : '',
            inputSchema: normalizeSchema(entry.parameters),
            source,
            serverUrl,
        };
    }

    return undefined;
}

function normalizeSchema(raw: unknown): McpToolSchema {
    if (!raw || typeof raw !== 'object') {
        return { type: 'object', properties: {} };
    }
    const schema = raw as Record<string, unknown>;
    const properties =
        schema.properties && typeof schema.properties === 'object'
            ? (schema.properties as Record<string, unknown>)
            : {};
    const required = Array.isArray(schema.required)
        ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined;
    return { type: 'object', properties, required };
}

/**
 * Normalize a raw `tools/list` result array (any shape) into our format,
 * skipping entries that fail to parse.
 */
export function normalizeMcpTools(
    rawTools: unknown,
    source: McpToolSource,
    serverUrl: string
): McpToolDefinition[] {
    if (!Array.isArray(rawTools)) {
        return [];
    }
    const tools: McpToolDefinition[] = [];
    for (const raw of rawTools) {
        const tool = normalizeMcpTool(raw, source, serverUrl);
        if (tool) {
            tools.push(tool);
        }
    }
    return tools;
}

/**
 * Diff two tool lists by name. Returns entries from `current` whose name was
 * not present in `previous`.
 */
export function detectNewTools(
    previous: McpToolDefinition[],
    current: McpToolDefinition[]
): McpToolDefinition[] {
    const known = new Set(previous.map((t) => t.name));
    return current.filter((t) => !known.has(t.name));
}

export class McpConnector {
    private defaultTools: McpToolDefinition[] = [];
    private externalTools: McpToolDefinition[] = [];
    private knownExternalNames = new Set<string>();
    private lastSyncResult?: McpSyncResult;
    private readonly fetchImpl: typeof fetch;

    constructor(private readonly deps: McpConnectorDeps) {
        this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    }

    public get defaultMcpTools(): McpToolDefinition[] {
        return this.defaultTools;
    }

    public get externalMcpTools(): McpToolDefinition[] {
        return this.externalTools;
    }

    public get lastSync(): McpSyncResult | undefined {
        return this.lastSyncResult;
    }

    /**
     * The external MCP server URL from settings. When empty, the connector
     * only manages the default server MCP.
     */
    public getMcpServerUrl(): string {
        return this.deps.getMcpServerUrl().trim();
    }

    /** Full merged list — default first, then external. */
    public getAllTools(): McpToolDefinition[] {
        return [...this.defaultTools, ...this.externalTools];
    }

    /**
     * Plain-text summary injected into the agent system message so every
     * Mission Barisal agent KNOWS which MCP tools exist — no wandering.
     * Default and external tools are listed under separate headers.
     */
    public getToolSummary(): string {
        const parts: string[] = [];
        if (this.defaultTools.length > 0) {
            parts.push(
                `**Default MCP (${getPlatformName()} server):**`,
                ...this.defaultTools.map((t) => formatToolLine(t))
            );
        }
        if (this.externalTools.length > 0) {
            parts.push(
                `**External MCP (${this.getMcpServerUrl()}):**`,
                ...this.externalTools.map((t) => formatToolLine(t))
            );
        }
        if (parts.length === 0) {
            return '(no MCP tools available — server MCP not reachable yet)';
        }
        return parts.join('\n');
    }

    /**
     * Fetch tools from the DEFAULT server MCP (`{serverUrl}/mcp`) and, when
     * configured, from the EXTERNAL MCP (`mcpServerUrl`). Uses the Phase 4
     * transport chain for the default fetch so UDS / HTTP fallback works.
     * Fires `onNewTools` ("ছটকা টান") when external tools appear.
     */
    public async sync(serverUrl: string): Promise<McpSyncResult> {
        const defaultError = await this.syncDefault(serverUrl);
        const externalError = await this.syncExternal();

        const result: McpSyncResult = {
            tools: this.getAllTools(),
            newTools: [],
            ...(defaultError ? { defaultError } : {}),
            ...(externalError ? { externalError } : {}),
        };
        this.lastSyncResult = result;
        return result;
    }

    private async syncDefault(serverUrl: string): Promise<string | undefined> {
        try {
            const tools = await this.fetchToolsFromServer(serverUrl, 'default');
            this.defaultTools = tools;
            return undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log(`MCP default sync failed: ${message}`);
            return message;
        }
    }

    private async syncExternal(): Promise<string | undefined> {
        const externalUrl = this.getMcpServerUrl();
        if (!externalUrl) {
            return undefined;
        }
        try {
            const tools = await this.fetchToolsFromServer(externalUrl, 'external');
            const previousNames = new Set(this.externalTools.map((t) => t.name));
            const newTools = tools.filter((t) => !previousNames.has(t.name));

            this.externalTools = tools;
            const freshNames = new Set(tools.map((t) => t.name));
            const brandNew = [...freshNames].filter((n) => !this.knownExternalNames.has(n));
            for (const name of freshNames) {
                this.knownExternalNames.add(name);
            }

            if (brandNew.length > 0 || newTools.length > 0) {
                const joltTools = tools.filter((t) => brandNew.includes(t.name) || newTools.includes(t));
                this.deps.log(
                    `MCP sync: ${joltTools.length} new external tool(s) detected — ছটকা টান!`
                );
                this.deps.onNewTools?.(joltTools);
            }
            return undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log(`MCP external sync failed: ${message}`);
            return message;
        }
    }

    /**
     * Perform the JSON-RPC MCP handshake against `{serverUrl}/mcp` and return
     * the normalized `tools/list` result.
     */
    private async fetchToolsFromServer(
        serverUrl: string,
        source: McpToolSource
    ): Promise<McpToolDefinition[]> {
        const base = serverUrl.replace(/\/+$/, '');
        const mcpUrl = base.endsWith('/mcp') ? base : `${base}/mcp`;

        const rawTools = await this.jsonRpcToolsList(serverUrl, mcpUrl);
        return normalizeMcpTools(rawTools, source, mcpUrl);
    }

    private async jsonRpcToolsList(serverUrl: string, mcpUrl: string): Promise<unknown> {
        // Prefer the Phase 4 transport chain: UDS when the socket exists,
        // otherwise plain HTTP POST (same behavior for localhost and remote).
        // Tests disable the probe so they never hit a real socket.
        if (this.deps.useTransport !== false) {
            try {
                const target = await resolveActiveTransport(serverUrl, this.deps.log, {
                    probeTimeoutMs: 1500,
                });
                if (target.kind === 'uds' && target.socketPath) {
                    try {
                        return await this.udsToolsList(target.socketPath);
                    } catch {
                        // The socket may speak JSON-RPC (MCP) instead of HTTP —
                        // try that before falling back to HTTP.
                        const tools = await this.udsMcpToolsList(target.socketPath).catch(() => undefined);
                        if (tools) {
                            return tools;
                        }
                    }
                }
            } catch {
                // Transport probe failed — continue to direct socket/HTTP attempts.
            }

            // The Mission Barisal MCP socket at DEFAULT_UDS_PATH speaks
            // newline-delimited JSON-RPC (not HTTP), so `tools/list` must go
            // over the JSON-RPC primitive. This is what makes UDS actually
            // work for MCP when the server exposes only the MCP socket.
            const tools = await this.udsMcpToolsList(this.deps.udsSocketPath ?? DEFAULT_UDS_PATH).catch(() => undefined);
            if (tools) {
                return tools;
            }
        }
        return this.httpToolsList(mcpUrl);
    }

    /**
     * Fetch `tools/list` over the JSON-RPC (MCP) socket protocol.
     * Returns `undefined` when the socket is absent or does not answer.
     */
    private async udsMcpToolsList(socketPath: string | undefined): Promise<unknown> {
        if (!socketPath) {
            return undefined;
        }
        // Named pipes have no filesystem entry to stat; probe them directly.
        if (!isWindowsPipePath(socketPath)) {
            try {
                if (!fs.existsSync(socketPath)) {
                    return undefined;
                }
            } catch {
                return undefined;
            }
        }
        const response = await udsJsonRpcRequest({
            socketPath,
            method: 'tools/list',
            params: { protocolVersion: MCP_PROTOCOL_VERSION },
            timeoutMs: 3000,
        });
        const result = response?.result as { tools?: unknown } | undefined;
        return result?.tools;
    }

    private async udsToolsList(socketPath: string): Promise<unknown> {
        const response = await udsRequest({
            socketPath,
            path: '/mcp',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildToolsListRequest()),
            timeoutMs: 5000,
        });
        return this.parseToolsResponse(response);
    }

    private async httpToolsList(mcpUrl: string): Promise<unknown> {
        const response = await this.fetchImpl(mcpUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildToolsListRequest()),
        });
        return this.parseToolsResponse(response);
    }

    private async parseToolsResponse(response: Response): Promise<unknown> {
        if (!response.ok) {
            throw new Error(`MCP tools/list failed with HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
            result?: { tools?: unknown };
        };
        return payload?.result?.tools;
    }

    private buildToolsListRequest(): Record<string, unknown> {
        return {
            jsonrpc: MCP_JSON_RPC_VERSION,
            id: 1,
            method: 'tools/list',
            params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
            },
        };
    }
}

function formatToolLine(tool: McpToolDefinition): string {
    const schema = tool.inputSchema;
    const paramNames = Object.keys(schema.properties ?? {});
    const params = paramNames.length > 0 ? ` (params: ${paramNames.join(', ')})` : '';
    return `- \`${tool.name}\`${params} — ${tool.description || 'no description'}`;
}
