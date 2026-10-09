/**
 * WorkspaceWatcher — runtime SSOT updates.
 *
 * Regenerates `.zombiecoder/SSOT.md` (debounced) whenever the user opens a
 * file, switches editors, or changes workspace folders, so the Single Source
 * of Truth always reflects the project the user is actually working on.
 *
 * `.zombiecoder` files are excluded from triggering a regeneration to avoid
 * an infinite write → open → regenerate loop.
 *
 * Phase 1 — Mission Foundation.
 */

import * as vscode from 'vscode';
import { SsotManager } from './ssotManager';

const SSOT_REGENERATE_DEBOUNCE_MS = 1500;

function isMissionManagedFile(fsPath: string): boolean {
    return fsPath.split(/[\\/]/).includes('.zombiecoder');
}

export class WorkspaceWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ssot: SsotManager,
        private readonly log: (message: string) => void
    ) { }

    public start(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
            vscode.workspace.onDidOpenTextDocument((doc) => this.scheduleIfRelevant(doc)),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor?.document) {
                    this.scheduleIfRelevant(editor.document);
                }
            })
        );
        this.log('WorkspaceWatcher started — runtime SSOT updates enabled');
    }

    private scheduleIfRelevant(doc: vscode.TextDocument): void {
        if (doc.uri.scheme !== 'file') {
            return;
        }
        const fsPath = doc.uri.fsPath;
        if (isMissionManagedFile(fsPath)) {
            return;
        }
        if (!fsPath.startsWith(this.ssot.rootDir)) {
            return;
        }
        this.schedule();
    }

    private schedule(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.ssot.regenerate();
        }, SSOT_REGENERATE_DEBOUNCE_MS);
    }

    public dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
