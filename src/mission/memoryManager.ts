/**
 * MemoryManager — client-side `.zombiecoder/agents/memory.json` store.
 *
 * Mirrors the server's three-file memory layout (SSOT.md → syllabus.md →
 * memory.json) so the extension keeps session context even against a remote
 * Mission Barisal server. The memory file is bounded to the most recent 200
 * entries to keep it small and cheap to inject.
 *
 * Phase 1 — Mission Foundation.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SessionMemoryEntry {
    sessionId: string;
    timestamp: string;
    agent: string;
    summary: string;
}

const MAX_MEMORY_ENTRIES = 200;

export class MemoryManager {
    private readonly agentsDir: string;

    constructor(
        private readonly workspaceRoot: string,
        private readonly log: (message: string) => void
    ) {
        this.agentsDir = path.join(workspaceRoot, '.zombiecoder', 'agents');
    }

    public ensureDirs(): void {
        fs.mkdirSync(path.join(this.workspaceRoot, '.zombiecoder'), { recursive: true });
        fs.mkdirSync(this.agentsDir, { recursive: true });
        fs.mkdirSync(path.join(this.agentsDir, 'sessions'), { recursive: true });
    }

    public getMemoryPath(): string {
        return path.join(this.agentsDir, 'memory.json');
    }

    public getSessionsDir(): string {
        return path.join(this.agentsDir, 'sessions');
    }

    public readMemory(): SessionMemoryEntry[] {
        try {
            const raw = fs.readFileSync(this.getMemoryPath(), 'utf8');
            const parsed = JSON.parse(raw) as { entries?: SessionMemoryEntry[] };
            return Array.isArray(parsed.entries) ? parsed.entries : [];
        } catch {
            return [];
        }
    }

    public appendSession(entry: Omit<SessionMemoryEntry, 'timestamp'>): void {
        const entries = this.readMemory();
        entries.push({ ...entry, timestamp: new Date().toISOString() });
        const bounded = entries.slice(-MAX_MEMORY_ENTRIES);

        try {
            fs.writeFileSync(
                this.getMemoryPath(),
                JSON.stringify({ entries: bounded }, null, 2),
                'utf8'
            );
            this.log(`Memory appended for ${entry.agent} (${entry.sessionId})`);
        } catch (error) {
            this.log(
                `Memory write failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
