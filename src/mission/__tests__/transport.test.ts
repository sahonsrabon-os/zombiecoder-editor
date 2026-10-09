import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'node:http';
import * as net from 'node:net';
import {
    parseServerUrl,
    buildTransportChain,
    probeTransport,
    resolveActiveTransport,
    udsRequest,
    udsJsonRpcRequest,
    DEFAULT_UDS_PATH,
} from '../transport';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-test-'));
    tempDirs.push(dir);
    return dir;
}

let pipeSeq = 0;

/**
 * Platform-correct socket path for hermetic tests: a Unix socket file on
 * POSIX, a uniquely-named Windows named pipe on win32. Windows cannot create
 * Unix socket files — `net.Server.listen(<tmpdir>/mcp.sock)` throws EACCES —
 * so the transport must be exercised over a real named pipe there.
 */
function makeSocketPath(): string {
    if (process.platform === 'win32') {
        pipeSeq += 1;
        return `\\\\.\\pipe\\zombiecoder-transport-test-${process.pid}-${pipeSeq}`;
    }
    return path.join(makeTempDir(), 'mcp.sock');
}

after(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('parseServerUrl — Phase 4 URL parsing', () => {
    test('http URL', () => {
        const t = parseServerUrl('http://0.0.0.0:3000');
        assert.equal(t.kind, 'http');
        assert.equal(t.baseUrl, 'http://0.0.0.0:3000');
    });

    test('https URL with trailing slash + /v1', () => {
        const t = parseServerUrl('http://0.0.0.0:3000/v1/');
        assert.equal(t.kind, 'http');
        assert.equal(t.baseUrl, 'http://0.0.0.0:3000/v1');
    });

    test('bare host becomes http', () => {
        const t = parseServerUrl('localhost:5000');
        assert.equal(t.kind, 'http');
        assert.equal(t.baseUrl, 'http://localhost:5000');
    });

    test('ws URL becomes websocket, http-derived base', () => {
        const t = parseServerUrl('ws://localhost:5000');
        assert.equal(t.kind, 'websocket');
        assert.equal(t.baseUrl, 'http://localhost:5000');
    });

    test('Windows named pipe path', () => {
        const t = parseServerUrl('\\\\.\\pipe\\zombiecoder-mcp');
        assert.equal(t.kind, 'uds');
        assert.equal(t.socketPath, '\\\\.\\pipe\\zombiecoder-mcp');
    });

    test('unix:// socket path', () => {
        const t = parseServerUrl('unix:///zombiecoder/mcp.sock');
        assert.equal(t.kind, 'uds');
        assert.equal(t.socketPath, '/zombiecoder/mcp.sock');
    });

    test('http+unix:// socket path', () => {
        const t = parseServerUrl('http+unix:///tmp/test.sock');
        assert.equal(t.kind, 'uds');
        assert.equal(t.socketPath, '/tmp/test.sock');
    });

    test('bare .sock path', () => {
        const t = parseServerUrl('/tmp/test.sock');
        assert.equal(t.kind, 'uds');
        assert.equal(t.socketPath, '/tmp/test.sock');
    });

    test('empty URL falls back to http with empty base', () => {
        const t = parseServerUrl('');
        assert.equal(t.kind, 'http');
        assert.equal(t.baseUrl, '');
    });
});

describe('buildTransportChain — fallback ordering', () => {
    test('http URL → http, sse, websocket, uds', () => {
        const chain = buildTransportChain('http://0.0.0.0:3000');
        assert.deepEqual(
            chain.map((t) => t.kind),
            ['http', 'sse', 'websocket', 'uds']
        );
        assert.equal(chain[3].socketPath, DEFAULT_UDS_PATH);
    });

    test('ws URL → websocket, http, sse', () => {
        const chain = buildTransportChain('ws://localhost:5000');
        assert.deepEqual(
            chain.map((t) => t.kind),
            ['websocket', 'http', 'sse']
        );
    });

    test('uds path → uds, http, sse', () => {
        const chain = buildTransportChain('/zombiecoder/mcp.sock');
        assert.deepEqual(
            chain.map((t) => t.kind),
            ['uds', 'http', 'sse']
        );
        assert.equal(chain[0].socketPath, '/zombiecoder/mcp.sock');
    });
});

describe('probeTransport — availability checks', () => {
    test('UDS: existing HTTP-speaking socket is available', async () => {
        const sockPath = makeSocketPath();
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));
        try {
            const t = { kind: 'uds' as const, baseUrl: '', socketPath: sockPath };
            assert.equal(await probeTransport(t, undefined, { probeTimeoutMs: 2000 }), true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('UDS: JSON-RPC-only socket (non-HTTP) is unavailable', async () => {
        // The engine's UDS socket speaks newline-delimited JSON-RPC, NOT
        // HTTP. An HTTP GET over it dies with "Parse Error: Expected HTTP/,
        // RTSP/ or ICE/" — the probe must reject such a socket and let the
        // client fall back to HTTP (user complaint: UDS থেকে কানেকশন পাচ্ছে না).
        const sockPath = makeSocketPath();
        const server = net.createServer((socket) => {
            socket.on('data', () => {
                socket.write(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error' },
                    }) + '\n'
                );
                socket.end();
            });
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));
        try {
            const t = { kind: 'uds' as const, baseUrl: '', socketPath: sockPath };
            assert.equal(await probeTransport(t, undefined, { probeTimeoutMs: 2000 }), false);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('UDS: missing socket file is unavailable', async () => {
        const t = { kind: 'uds' as const, baseUrl: '', socketPath: '/nonexistent/nope.sock' };
        assert.equal(await probeTransport(t), false);
    });

    test('UDS: no socket path is unavailable', async () => {
        const t = { kind: 'uds' as const, baseUrl: '' };
        assert.equal(await probeTransport(t), false);
    });

    test('HTTP: reachable server is available (real server)', async () => {
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: ['a'] }));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port;

        try {
            const t = { kind: 'http' as const, baseUrl: `http://127.0.0.1:${port}` };
            assert.equal(await probeTransport(t, undefined, { probeTimeoutMs: 2000 }), true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('HTTP: unreachable port is unavailable', async () => {
        const t = { kind: 'http' as const, baseUrl: 'http://127.0.0.1:1' };
        assert.equal(await probeTransport(t, undefined, { probeTimeoutMs: 500 }), false);
    });
});

describe('resolveActiveTransport — picks first available', () => {
    test('returns primary when UDS socket exists', async () => {
        const sockPath = makeSocketPath();
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));
        try {
            const target = await resolveActiveTransport(`unix://${sockPath}`, undefined, {
                probeTimeoutMs: 2000,
            });
            assert.equal(target.kind, 'uds');
            assert.equal(target.socketPath, sockPath);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('falls back gracefully when socket is missing', async () => {
        // UDS socket missing + unknown localhost:5000 state (the dev server may
        // or may not be running) — the resolver must not throw and must return
        // one of the chain kinds.
        const target = await resolveActiveTransport('unix:///nonexistent/nope.sock', undefined, {
            probeTimeoutMs: 300,
        });
        assert.equal(['uds', 'http', 'sse', 'websocket'].includes(target.kind), true);
    });

    test('preferUds: localhost URL picks socket when it exists', async () => {
        // Inject a TEMP socket path via options.udsPath so the test never
        // touches the real /tmp/zombiecoder/mcp.sock (which a live engine
        // may own — writing it would throw ENXIO). Serve real HTTP over it
        // so the probe's verification succeeds.
        const sockPath = makeSocketPath();
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));
        try {
            const target = await resolveActiveTransport('http://0.0.0.0:3000', undefined, {
                preferUds: true,
                probeTimeoutMs: 2000,
                udsPath: sockPath,
            });
            assert.equal(target.kind, 'uds');
            assert.equal(target.socketPath, sockPath);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('preferUds: falls back to HTTP when socket is missing', async () => {
        // Inject a temp udsPath that does NOT exist (never touch the real
        // DEFAULT_UDS_PATH — a live engine socket would make preferUds pick
        // UDS and this test would flake). Real HTTP server → 'http' wins.
        const dir = makeTempDir();
        const missingSock = path.join(dir, 'missing.sock');
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port;

        try {
            const target = await resolveActiveTransport(`http://127.0.0.1:${port}`, undefined, {
                preferUds: true,
                probeTimeoutMs: 2000,
                udsPath: missingSock,
            });
            assert.equal(target.kind, 'http');
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});

describe('udsRequest — real Unix domain socket HTTP', () => {
    test('GET returns parsed JSON', async () => {
        const sockPath = makeSocketPath();

        const server = http.createServer((req, res) => {
            assert.equal(req.url, '/v1/models');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [{ id: 'mission' }] }));
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const response = await udsRequest({ socketPath: sockPath, path: '/v1/models' });
            assert.equal(response.ok, true);
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.data[0].id, 'mission');
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('POST streams an SSE-style body', async () => {
        const sockPath = makeSocketPath();

        const server = http.createServer((req, res) => {
            assert.equal(req.method, 'POST');
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: {"a":1}\n\n');
            res.write('data: {"b":2}\n\n');
            res.end();
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const response = await udsRequest({
                socketPath: sockPath,
                path: '/v1/chat/completions',
                method: 'POST',
                body: '{}',
            });
            assert.equal(response.ok, true);

            // Read the web ReadableStream the same way readChatStreamChunks does.
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let text = '';
            for (; ;) {
                const { done, value } = await reader.read();
                if (done) { break; }
                text += decoder.decode(value, { stream: true });
            }
            assert.equal(text.includes('data: {"a":1}'), true);
            assert.equal(text.includes('data: {"b":2}'), true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('propagates server errors (404)', async () => {
        const sockPath = makeSocketPath();

        const server = http.createServer((_req, res) => {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const response = await udsRequest({ socketPath: sockPath, path: '/nope' });
            assert.equal(response.ok, false);
            assert.equal(response.status, 404);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('rejects when socket does not exist', async () => {
        await assert.rejects(
            udsRequest({ socketPath: '/nonexistent/nope.sock', path: '/v1/models' })
        );
    });
});

describe('udsJsonRpcRequest — JSON-RPC (MCP) over Unix domain socket', () => {
    test('tools/list returns the parsed result', async () => {
        const sockPath = makeSocketPath();

        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const line = data.toString('utf8').trim();
                const request = JSON.parse(line);
                assert.equal(request.method, 'tools/list');
                socket.write(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            tools: [
                                { name: 'read_file', description: 'Read a file' },
                                { name: 'write_file', description: 'Write a file' },
                            ],
                        },
                    }) + '\n'
                );
                socket.end();
            });
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const response = await udsJsonRpcRequest({
                socketPath: sockPath,
                method: 'tools/list',
                params: { protocolVersion: '2024-11-05' },
                timeoutMs: 2000,
            });
            assert.equal(response.jsonrpc, '2.0');
            const tools = (response.result as { tools: unknown[] }).tools;
            assert.equal(tools.length, 2);
            assert.equal((tools[0] as { name: string }).name, 'read_file');
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('handles a response split across multiple chunks', async () => {
        const sockPath = makeSocketPath();

        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const request = JSON.parse(data.toString('utf8').trim());
                const payload = JSON.stringify({
                    jsonrpc: '2.0',
                    id: request.id,
                    result: { ok: true },
                });
                // Write half, then the rest — the client must reassemble.
                const mid = Math.floor(payload.length / 2);
                socket.write(payload.slice(0, mid));
                setTimeout(() => {
                    socket.write(payload.slice(mid) + '\n');
                    socket.end();
                }, 20);
            });
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            const response = await udsJsonRpcRequest({
                socketPath: sockPath,
                method: 'tools/list',
                timeoutMs: 2000,
            });
            assert.equal((response.result as { ok: boolean }).ok, true);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    test('rejects when the socket is missing', async () => {
        await assert.rejects(
            udsJsonRpcRequest({ socketPath: '/nonexistent/nope.sock', method: 'tools/list' })
        );
    });

    test('rejects on timeout when the server never answers', async () => {
        const sockPath = makeSocketPath();

        const server = net.createServer((socket) => {
            socket.on('data', () => {
                // Never respond — force the client's timeout.
            });
        });
        await new Promise<void>((resolve) => server.listen(sockPath, resolve));

        try {
            await assert.rejects(
                udsJsonRpcRequest({ socketPath: sockPath, method: 'tools/list', timeoutMs: 300 }),
                /timed out/
            );
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
