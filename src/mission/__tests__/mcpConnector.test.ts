import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'node:net';
import {
    McpConnector,
    normalizeMcpTool,
    normalizeMcpTools,
    detectNewTools,
    McpToolDefinition,
} from '../mcpConnector';

const DEFAULT_URL = 'http://0.0.0.0:3000';
const EXTERNAL_URL = 'http://localhost:3100';

let pipeSeq = 0;

/**
 * Platform-correct socket path for the JSON-RPC-over-socket test: a Unix
 * socket file on POSIX, a uniquely-named Windows named pipe on win32
 * (Windows cannot `net.Server.listen` on a `.sock` file).
 */
function makeMcpSocketPath(): string {
    if (process.platform === 'win32') {
        pipeSeq += 1;
        return `\\\\.\\pipe\\zombiecoder-mcp-test-${process.pid}-${pipeSeq}`;
    }
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-uds-test-')), 'mcp.sock');
}

function makeConnector(opts: {
    externalUrl?: string;
    onNewTools?: (tools: McpToolDefinition[]) => void;
    fetchImpl?: typeof fetch;
}): { connector: McpConnector; logs: string[] } {
    const logs: string[] = [];
    const connector = new McpConnector({
        getMcpServerUrl: () => opts.externalUrl ?? '',
        log: (m) => logs.push(m),
        onNewTools: opts.onNewTools,
        useTransport: false,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    return { connector, logs };
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function makeFetch(tools: unknown[]): typeof fetch {
    return makeFetchByUrl(() => tools);
}

/**
 * URL-aware fetch mock: default server URL → `defaultTools`, external URL →
 * `externalTools`. This mirrors the real connector behavior where the
 * default and external MCP endpoints return different registries.
 */
function makeFetchByUrl(opts: {
    defaultTools?: unknown[];
    externalTools?: unknown[];
} | (() => unknown[])): typeof fetch {
    const impl = async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
        assert.ok(url.endsWith('/mcp'), `expected /mcp endpoint, got ${url}`);
        let tools: unknown[];
        if (typeof opts === 'function') {
            tools = opts();
        } else if (url.includes(EXTERNAL_URL)) {
            tools = opts.externalTools ?? [];
        } else {
            tools = opts.defaultTools ?? [];
        }
        return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools } });
    };
    return impl as unknown as typeof fetch;
}

describe('normalizeMcpTool — Phase 5 format normalization', () => {
    test('standard MCP shape passes through', () => {
        const tool = normalizeMcpTool(
            {
                name: 'read_file',
                description: 'Read a file',
                inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
            'default',
            DEFAULT_URL
        );
        assert.ok(tool);
        assert.equal(tool?.name, 'read_file');
        assert.equal(tool?.source, 'default');
        assert.equal(tool?.serverUrl, DEFAULT_URL);
        assert.deepEqual(tool?.inputSchema.required, ['path']);
    });

    test('OpenAI function style is normalized (Facebook MCP shape)', () => {
        const tool = normalizeMcpTool(
            {
                type: 'function',
                function: {
                    name: 'ads_get_insights',
                    description: 'Fetch ad insights',
                    parameters: { type: 'object', properties: { adId: { type: 'string' } } },
                },
            },
            'external',
            EXTERNAL_URL
        );
        assert.ok(tool);
        assert.equal(tool?.name, 'ads_get_insights');
        assert.equal(tool?.source, 'external');
        assert.equal(tool?.inputSchema.type, 'object');
        assert.deepEqual(Object.keys(tool?.inputSchema.properties ?? {}), ['adId']);
    });

    test('loose name/description/parameters shape is normalized', () => {
        const tool = normalizeMcpTool(
            { name: 'public_users', description: 'List users', parameters: { type: 'object', properties: {} } },
            'external',
            EXTERNAL_URL
        );
        assert.ok(tool);
        assert.equal(tool?.name, 'public_users');
    });

    test('unrecognizable entries return undefined', () => {
        assert.equal(normalizeMcpTool(null, 'default', DEFAULT_URL), undefined);
        assert.equal(normalizeMcpTool(42, 'default', DEFAULT_URL), undefined);
        assert.equal(normalizeMcpTool({ noName: true }, 'default', DEFAULT_URL), undefined);
        assert.equal(normalizeMcpTool({ function: { noName: true } }, 'default', DEFAULT_URL), undefined);
    });
});

describe('normalizeMcpTools — list normalization', () => {
    test('mixed list keeps only recognizable tools', () => {
        const tools = normalizeMcpTools(
            [
                { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
                { type: 'function', function: { name: 'b', description: 'B', parameters: {} } },
                { garbage: true },
            ],
            'external',
            EXTERNAL_URL
        );
        assert.deepEqual(
            tools.map((t) => t.name),
            ['a', 'b']
        );
    });

    test('non-array returns empty list', () => {
        assert.deepEqual(normalizeMcpTools(undefined, 'default', DEFAULT_URL), []);
        assert.deepEqual(normalizeMcpTools({ tools: [] }, 'default', DEFAULT_URL), []);
    });
});

describe('detectNewTools — tool diff', () => {
    test('new tools are detected by name', () => {
        const previous: McpToolDefinition[] = [
            { name: 'read_file', description: '', inputSchema: { type: 'object', properties: {} }, source: 'default', serverUrl: DEFAULT_URL },
        ];
        const current: McpToolDefinition[] = [
            { name: 'read_file', description: '', inputSchema: { type: 'object', properties: {} }, source: 'default', serverUrl: DEFAULT_URL },
            { name: 'ads_get_insights', description: '', inputSchema: { type: 'object', properties: {} }, source: 'external', serverUrl: EXTERNAL_URL },
        ];
        const fresh = detectNewTools(previous, current);
        assert.deepEqual(fresh.map((t) => t.name), ['ads_get_insights']);
    });
});

describe('McpConnector — Phase 5 connector behavior', () => {
    test('sync fetches default MCP tools from server /mcp endpoint', async () => {
        const { connector } = makeConnector({
            fetchImpl: makeFetch([
                { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
                { name: 'web_search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
            ]),
        });
        const result = await connector.sync(DEFAULT_URL);
        assert.equal(result.defaultError, undefined);
        assert.deepEqual(
            connector.defaultMcpTools.map((t) => t.name),
            ['read_file', 'web_search']
        );
        assert.equal(connector.externalMcpTools.length, 0);
        assert.equal(result.tools.length, 2);
    });

    test('external MCP tools are kept in a separate account', async () => {
        const { connector } = makeConnector({
            externalUrl: EXTERNAL_URL,
            fetchImpl: makeFetchByUrl({
                defaultTools: [],
                externalTools: [
                    { name: 'ads_create_campaign', description: 'Create campaign', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
                ],
            }),
        });
        const result = await connector.sync(DEFAULT_URL);
        assert.equal(result.defaultError, undefined);
        assert.equal(result.externalError, undefined);
        assert.equal(connector.defaultMcpTools.length, 0);
        assert.equal(connector.externalMcpTools.length, 1);
        assert.equal(connector.externalMcpTools[0].source, 'external');
        assert.equal(connector.externalMcpTools[0].name, 'ads_create_campaign');
        assert.equal(connector.getAllTools().length, 1);
    });

    test('ছটকা টান — onNewTools fires for brand-new external tools', async () => {
        let jolted: McpToolDefinition[] = [];
        const { connector } = makeConnector({
            externalUrl: EXTERNAL_URL,
            onNewTools: (tools) => {
                jolted = tools;
            },
            fetchImpl: makeFetch([
                { name: 'ads_get_insights', description: 'Fetch insights', inputSchema: { type: 'object', properties: {} } },
            ]),
        });
        await connector.sync(DEFAULT_URL);
        assert.equal(jolted.length, 1);
        assert.equal(jolted[0].name, 'ads_get_insights');
    });

    test('no ছটকা টান on repeat sync of the same tools', async () => {
        let jolts = 0;
        const { connector } = makeConnector({
            externalUrl: EXTERNAL_URL,
            onNewTools: () => {
                jolts += 1;
            },
            fetchImpl: makeFetch([
                { name: 'ads_get_insights', description: 'Fetch insights', inputSchema: { type: 'object', properties: {} } },
            ]),
        });
        await connector.sync(DEFAULT_URL);
        await connector.sync(DEFAULT_URL);
        assert.equal(jolts, 1);
    });

    test('default MCP failure is reported without breaking external sync', async () => {
        const failingFetch = (async (): Promise<Response> => {
            throw new Error('connection refused');
        }) as unknown as typeof fetch;
        const { connector } = makeConnector({
            externalUrl: EXTERNAL_URL,
            fetchImpl: failingFetch,
        });
        const result = await connector.sync(DEFAULT_URL);
        assert.ok(result.defaultError);
        assert.equal(result.tools.length, 0);
        assert.equal(connector.getToolSummary().includes('no MCP tools'), true);
    });

    test('getToolSummary lists default and external tools separately', async () => {
        const { connector } = makeConnector({
            externalUrl: EXTERNAL_URL,
            fetchImpl: makeFetchByUrl({
                defaultTools: [
                    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
                ],
                externalTools: [
                    { name: 'ads_create_campaign', description: 'Create campaign', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
                ],
            }),
        });
        await connector.sync(DEFAULT_URL);

        assert.equal(connector.defaultMcpTools.length, 1);
        assert.equal(connector.externalMcpTools.length, 1);

        const summary = connector.getToolSummary();
        assert.ok(summary.includes('Default MCP (Mission Barisal server):'));
        assert.ok(summary.includes('read_file'));
        assert.ok(summary.includes('External MCP'));
        assert.ok(summary.includes('ads_create_campaign'));
    });

    test('no external URL configured → no external sync attempted', async () => {
        let fetchCalls = 0;
        const countingFetch = (async (input: RequestInfo | URL): Promise<Response> => {
            fetchCalls += 1;
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
            assert.ok(url.endsWith('/mcp'));
            return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
        }) as unknown as typeof fetch;

        const { connector } = makeConnector({ fetchImpl: countingFetch });
        await connector.sync(DEFAULT_URL);
        // Only the default server is hit; the empty external URL must not
        // produce a second fetch.
        assert.equal(fetchCalls, 1);
        assert.equal(connector.externalMcpTools.length, 0);
    });
});

describe('McpConnector — JSON-RPC over UDS socket (MCP protocol)', () => {
    test('sync fetches tools via JSON-RPC over a Unix socket when HTTP is unreachable', async () => {
        // The real Mission Barisal socket at /tmp/zombiecoder/mcp.sock speaks
        // newline-delimited JSON-RPC, NOT HTTP (curl over it → HTTP 000, but
        // `tools/list` answers). The connector must fall back to the
        // JSON-RPC primitive. This test spins a hermetic temp socket speaking
        // the same protocol and injects it via udsSocketPath.
        const sockPath = makeMcpSocketPath();

        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const request = JSON.parse(data.toString('utf8').trim());
                assert.equal(request.method, 'tools/list');
                socket.write(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            tools: [
                                { name: 'uds_read_file', description: 'Read via UDS', inputSchema: { type: 'object', properties: {} } },
                                { name: 'uds_web_search', description: 'Search via UDS', inputSchema: { type: 'object', properties: {} } },
                            ],
                        },
                    }) + '\n'
                );
                socket.end();
            });
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const logs: string[] = [];
            const connector = new McpConnector({
                getMcpServerUrl: () => '',
                log: (m) => logs.push(m),
                // Enable the transport path (default tests use false). The
                // server URL points at an unreachable port so the probe fails
                // fast and we fall through to the JSON-RPC socket attempt.
                useTransport: true,
                udsSocketPath: sockPath,
            });

            const result = await connector.sync('http://127.0.0.1:1');
            assert.equal(result.defaultError, undefined);
            const names = result.tools.map((t) => t.name);
            assert.equal(names.includes('uds_read_file'), true);
            assert.equal(names.includes('uds_web_search'), true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            if (process.platform !== 'win32') {
                fs.rmSync(path.dirname(sockPath), { recursive: true, force: true });
            }
        }
    });

    test('falls back to HTTP /mcp when no JSON-RPC socket answers', async () => {
        // No socket at the injected path + unreachable server URL → the
        // connector must degrade to the plain HTTP POST (which is what the
        // running server on port 5000 serves). Mock fetch proves it.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-uds-test-'));
        const sockPath = path.join(dir, 'missing.sock');

        const fetchImpl = makeFetch([
            { name: 'http_read_file', description: 'Read via HTTP', inputSchema: { type: 'object', properties: {} } },
        ]);

        try {
            const logs: string[] = [];
            const connector = new McpConnector({
                getMcpServerUrl: () => '',
                log: (m) => logs.push(m),
                useTransport: true,
                udsSocketPath: sockPath,
                fetchImpl,
            });

            const result = await connector.sync('http://127.0.0.1:1');
            assert.equal(result.defaultError, undefined);
            assert.equal(result.tools.map((t) => t.name).includes('http_read_file'), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
