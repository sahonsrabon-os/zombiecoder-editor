/**
 * MissionManager — orchestrates the client-side Mission Barisal system.
 *
 * On activation it silently (no user permission) creates the three-file
 * memory layout (SSOT.md + syllabus.md + memory.json), starts the workspace
 * watcher for runtime SSOT updates, and exposes the assembled Mission
 * context consumed by the Phase 2 context builder.
 *
 * Phase 1 — Mission Foundation.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SsotManager } from './ssotManager';
import { WorkspaceWatcher } from './workspaceWatcher';
import { FootprintScanner } from './footprintScanner';
import { MemoryManager } from './memoryManager';

export interface MissionContext {
    workspaceRoot: string;
    ssot: string;
    syllabus: string;
    memorySummary: string;
    /**
     * Phase 5 — plain-text list of known MCP tools (default + external).
     * Injected into the agent system message so agents know every tool
     * instead of wandering.
     */
    mcpTools: string;
}

export interface MissionManagerDeps {
    /**
     * Resolve the current MCP tool summary. Provided by the gateway provider
     * so MissionManager stays decoupled from the McpConnector.
     */
    getMcpTools?: () => string;
}

export class MissionManager implements vscode.Disposable {
    private readonly ssot: SsotManager;
    private readonly watcher: WorkspaceWatcher;
    private readonly footprint: FootprintScanner;
    private readonly memory: MemoryManager;
    private readonly log: (message: string) => void;
    private readonly deps: MissionManagerDeps;
    private initialized = false;

    constructor(
        context: vscode.ExtensionContext,
        log: (message: string) => void,
        deps?: MissionManagerDeps
    ) {
        this.log = log;
        this.deps = deps ?? {};
        const workspaceRoot =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionUri.fsPath;
        this.ssot = new SsotManager(workspaceRoot, log);
        this.watcher = new WorkspaceWatcher(this.ssot, log);
        this.footprint = new FootprintScanner(workspaceRoot, log);
        this.memory = new MemoryManager(workspaceRoot, log);
    }

    public get workspaceRoot(): string {
        return this.ssot.rootDir;
    }

    /**
     * Create `.zombiecoder/` (SSOT + syllabus + memory) client-side. Runs once
     * per extension activation. No user permission prompt on first run.
     */
    public ensureMissionFiles(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        try {
            this.memory.ensureDirs();
            const ssotContent = this.ssot.regenerate();
            const footprint = this.footprint.scan();
            this.footprint.updateSyllabus(footprint);
            this.watcher.start();

            this.log(
                `Mission files ensured: SSOT (${ssotContent.length} chars), ${footprint.languages.length} language(s) detected`
            );
        } catch (error) {
            this.log(
                `Mission init failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /** Assemble the context block injected as the clean system message. */
    public getMissionContext(): MissionContext {
        let syllabus = '';
        try {
            const syllabusPath = path.join(
                this.workspaceRoot,
                '.zombiecoder',
                'agents',
                'syllabus.md'
            );
            if (fs.existsSync(syllabusPath)) {
                syllabus = fs.readFileSync(syllabusPath, 'utf8');
            }
        } catch {
            syllabus = '';
        }

        const memory = this.memory.readMemory();
        const memorySummary =
            memory.length === 0
                ? '(no session memory yet)'
                : memory
                    .slice(-5)
                    .map((entry) => `- [${entry.timestamp}] ${entry.agent}: ${entry.summary}`)
                    .join('\n');

        return {
            workspaceRoot: this.workspaceRoot,
            ssot: this.ssot.readSSOT(),
            syllabus,
            memorySummary,
            mcpTools: this.deps.getMcpTools?.() ?? '(MCP tools not synced yet)',
        };
    }

    public dispose(): void {
        this.watcher.dispose();
    }
}
