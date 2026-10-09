/**
 * SsotManager — client-side port of the Mission Barisal server's SSOT
 * generator (api.js:950-1260: scanProject / generateSSOT / buildTree /
 * autoSSOT / readSSOT).
 *
 * Produces and maintains `.zombiecoder/SSOT.md` inside the active workspace
 * so Mission Barisal agents always have the Single Source of Truth for the
 * project — even when the extension talks to a remote server that has no
 * access to the local filesystem.
 *
 * Phase 1 — Mission Foundation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getPlatformName } from '../branding';

export interface ProjectInfo {
    name: string;
    root: string;
    language: string;
    framework: string;
    type: string;
    hasPackageJson: boolean;
    hasComposerJson: boolean;
    hasRequirementsTxt: boolean;
    hasGemfile: boolean;
    hasCargoToml: boolean;
    hasGoMod: boolean;
    hasMakefile: boolean;
    hasDockerfile: boolean;
    hasGit: boolean;
    entryFile: string;
    sourceDirs: string[];
    fileCount: number;
    jsCount: number;
    pyCount: number;
    phpCount: number;
    tsCount: number;
}

/** Mission Barisal agent roster — mirrors the server's AGENTS table. */
export const MISSION_AGENTS: ReadonlyArray<{
    id: string;
    name: string;
    role: string;
    priority: number;
}> = [
        { id: 'code-guru', name: 'Code Guru - Monu', role: 'architecture', priority: 1 },
        { id: 'bug-hunter', name: 'Bug Hunter - Jewel', role: 'debugging', priority: 2 },
        { id: 'security-hero', name: 'Security Hero - Bablu', role: 'general', priority: 3 },
        { id: 'perf-wizard', name: 'Performance Wizard - Rashed', role: 'general', priority: 4 },
        { id: 'doc-king', name: 'Documentation King - Halim', role: 'general', priority: 5 },
        { id: 'qa-tyrant', name: 'Quality Tyrant - Mojnu', role: 'general', priority: 6 },
    ];

/** Directories excluded from the structure tree (kept in sync with the server). */
const TREE_SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'out']);

/** Candidate entry files probed in priority order. */
const ENTRY_CANDIDATES: readonly string[] = [
    'api.js',
    'app.js',
    'index.js',
    'server.js',
    'main.js',
    'index.ts',
    'main.ts',
    'main.py',
    'index.php',
    'main.go',
    'app.py',
];

export class SsotManager {
    /** projectDir → { content, mtimeMs } — avoids repeated disk reads (server: _ssotCacheMap). */
    private readonly cache = new Map<string, { content: string; mtimeMs: number }>();

    constructor(
        private readonly workspaceRoot: string,
        private readonly log: (message: string) => void
    ) { }

    public get rootDir(): string {
        return this.workspaceRoot;
    }

    public get ssotPath(): string {
        return path.join(this.workspaceRoot, '.zombiecoder', 'SSOT.md');
    }

    /** Port of server scanProject(dir) — api.js:950-1090. */
    public scanProject(rootDir: string): ProjectInfo {
        const info: ProjectInfo = {
            name: path.basename(rootDir),
            root: rootDir,
            language: 'unknown',
            framework: '',
            type: 'unknown',
            hasPackageJson: false,
            hasComposerJson: false,
            hasRequirementsTxt: false,
            hasGemfile: false,
            hasCargoToml: false,
            hasGoMod: false,
            hasMakefile: false,
            hasDockerfile: false,
            hasGit: false,
            entryFile: '',
            sourceDirs: [],
            fileCount: 0,
            jsCount: 0,
            pyCount: 0,
            phpCount: 0,
            tsCount: 0,
        };

        try {
            if (!fs.existsSync(rootDir)) {
                return info;
            }

            const entries = fs.readdirSync(rootDir);
            info.fileCount = entries.length;

            for (const entry of entries) {
                const fullPath = path.join(rootDir, entry);
                const stat = fs.statSync(fullPath);

                if (entry === 'package.json') {
                    info.hasPackageJson = true;
                    info.type = 'node';
                } else if (entry === 'composer.json') {
                    info.hasComposerJson = true;
                    info.type = 'php';
                } else if (
                    entry === 'requirements.txt' ||
                    entry === 'setup.py' ||
                    entry === 'pyproject.toml'
                ) {
                    info.hasRequirementsTxt = true;
                    info.type = 'python';
                } else if (entry === 'Gemfile') {
                    info.hasGemfile = true;
                    info.type = 'ruby';
                } else if (entry === 'Cargo.toml') {
                    info.hasCargoToml = true;
                    info.type = 'rust';
                } else if (entry === 'go.mod') {
                    info.hasGoMod = true;
                    info.type = 'go';
                } else if (entry === 'Makefile') {
                    info.hasMakefile = true;
                } else if (entry === 'Dockerfile') {
                    info.hasDockerfile = true;
                } else if (entry === '.git') {
                    info.hasGit = true;
                } else if (entry.endsWith('.js')) {
                    info.jsCount++;
                } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
                    info.tsCount++;
                } else if (entry.endsWith('.py')) {
                    info.pyCount++;
                } else if (entry.endsWith('.php')) {
                    info.phpCount++;
                } else if (
                    stat.isDirectory() &&
                    !entry.startsWith('.') &&
                    !TREE_SKIP_DIRS.has(entry)
                ) {
                    info.sourceDirs.push(entry);
                }
            }

            // Detect language from file extensions if no marker file found.
            if (info.type === 'unknown') {
                if (info.hasPackageJson || info.jsCount > 0 || info.tsCount > 0) {
                    info.type = 'node';
                } else if (info.phpCount > 0) {
                    info.type = 'php';
                } else if (info.pyCount > 0) {
                    info.type = 'python';
                }
            }

            // Set language based on type + file evidence.
            if (info.type === 'node') {
                info.language = info.tsCount > info.jsCount ? 'typescript' : 'javascript';
            } else if (info.type === 'php') {
                info.language = 'php';
            } else if (info.type === 'python') {
                info.language = 'python';
            } else if (info.type === 'ruby') {
                info.language = 'ruby';
            } else if (info.type === 'rust') {
                info.language = 'rust';
            } else if (info.type === 'go') {
                info.language = 'go';
            }

            // Detect framework from package.json.
            if (info.hasPackageJson) {
                try {
                    const pkg = JSON.parse(
                        fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
                    ) as {
                        name?: string;
                        dependencies?: Record<string, string>;
                        devDependencies?: Record<string, string>;
                    };
                    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                    if (deps.next) {
                        info.framework = 'next.js';
                    } else if (deps.react) {
                        info.framework = 'react';
                    } else if (deps.vue) {
                        info.framework = 'vue';
                    } else if (deps.express) {
                        info.framework = 'express';
                    } else if (deps.nuxt) {
                        info.framework = 'nuxt';
                    } else if (deps['@angular/core']) {
                        info.framework = 'angular';
                    }
                    info.name = pkg.name ?? info.name;
                    if (deps.typescript || pkg.devDependencies?.typescript) {
                        info.language = 'typescript';
                    }
                } catch {
                    // ignore malformed package.json
                }
            }

            // Detect framework from composer.json.
            if (info.hasComposerJson) {
                try {
                    const pkg = JSON.parse(
                        fs.readFileSync(path.join(rootDir, 'composer.json'), 'utf8')
                    ) as {
                        name?: string;
                        require?: Record<string, string>;
                        'require-dev'?: Record<string, string>;
                    };
                    const deps = { ...pkg.require, ...pkg['require-dev'] };
                    if (deps.laravel) {
                        info.framework = 'laravel';
                    } else if (deps.symfony) {
                        info.framework = 'symfony';
                    }
                    info.name = pkg.name ?? info.name;
                } catch {
                    // ignore malformed composer.json
                }
            }

            // Find entry files.
            for (const candidate of ENTRY_CANDIDATES) {
                if (entries.includes(candidate)) {
                    info.entryFile = candidate;
                    break;
                }
            }
        } catch (error) {
            this.log(
                `WARN project scan failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        return info;
    }

    /** Port of server buildTree(dir, depth, maxDepth) — api.js:1150-1175. */
    public buildTree(dir: string, depth: number, maxDepth: number): string {
        if (depth > maxDepth) {
            return '';
        }
        let result = '';
        const indent = '  '.repeat(depth);
        try {
            const entries = fs.readdirSync(dir);
            const filtered = entries.filter(
                (entry) => !entry.startsWith('.') && !TREE_SKIP_DIRS.has(entry)
            );
            for (const entry of filtered) {
                const fullPath = path.join(dir, entry);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    result += `${indent}  ${entry}/\n`;
                    result += this.buildTree(fullPath, depth + 1, maxDepth);
                } else {
                    result += `${indent}  ${entry}\n`;
                }
            }
        } catch {
            // unreadable directory — skip silently, mirroring the server
        }
        return result;
    }

    /** Port of server generateSSOT(rootDir, projectInfo) — api.js:1100-1215. */
    public generateSSOT(rootDir: string, info: ProjectInfo): string {
        const header = `# ${info.name} — Project Context (Auto-generated by ${getPlatformName()})

> This file is automatically managed by ${getPlatformName()} v3.
> Agents use this as the Single Source of Truth for the project.

## Project Identity
- **Name:** ${info.name}
- **Root:** ${info.root}
- **Type:** ${info.type} (${info.language})
- **Framework:** ${info.framework || 'none detected'}
- **Entry Point:** ${info.entryFile || 'not detected'}
- **Source Dirs:** ${info.sourceDirs.join(', ') || 'none'}
- **File Count:** ${info.fileCount}

## Detected Technologies
| Technology | Present | Files |
|-----------|---------|-------|
| JavaScript | ${info.type === 'node' ? 'yes' : 'no'} | ${info.jsCount} .js |
| TypeScript | ${info.language === 'typescript' ? 'yes' : 'no'} | ${info.tsCount} .ts |
| Python | ${info.type === 'python' ? 'yes' : 'no'} | ${info.pyCount} .py |
| PHP | ${info.type === 'php' ? 'yes' : 'no'} | ${info.phpCount} .php |
| Node.js | ${info.hasPackageJson ? 'yes' : 'no'} | package.json |
| Docker | ${info.hasDockerfile ? 'yes' : 'no'} | — |
| Git | ${info.hasGit ? 'yes' : 'no'} | — |

## Project Structure
`;

        let structure = '';
        try {
            structure = this.buildTree(rootDir, 0, 3);
        } catch {
            structure = '  (error reading structure)';
        }

        let footer = `
## ${getPlatformName()} Context
- **Server:** ${getPlatformName()} v3 — Multi-Agent Code Platform
- **Owner:** Sahon Srabon (ZombieCoder) · Barisal, Bangladesh
- **Agents:** 6 specialist agents + mission mode (all 6 debate in parallel)
- **MCP Endpoint:** \`/mcp\`

| ID | Name | Role | Priority |
|----|------|------|----------|
`;
        for (const agent of MISSION_AGENTS) {
            footer += `| \`${agent.id}\` | ${agent.name} | ${agent.role} | ${agent.priority} |\n`;
        }

        footer += `
## Agent Instructions
- Agents MUST reference this SSOT.md when answering project-related questions.
- If the user asks about the project code, agents should check this file first.
- Any code changes recommendations should be based on the detected framework and tech stack above.
- If information is not in SSOT, agents should say "এই তথ্য বর্তমানে SSOT এ নেই" and suggest adding it.
`;

        return header + structure + footer;
    }

    /** Port of server autoSSOT(projectDir) — api.js:1190-1225. Creates the file. */
    public regenerate(): string {
        const targetDir = path.join(this.workspaceRoot, '.zombiecoder');
        const targetPath = path.join(targetDir, 'SSOT.md');

        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            const projectInfo = this.scanProject(this.workspaceRoot);
            const content = this.generateSSOT(this.workspaceRoot, projectInfo);
            fs.writeFileSync(targetPath, content, 'utf8');

            // Server fidelity: autoSSOT (api.js:1190-1223) does NOT populate
            // _ssotCacheMap — it only writes the file. readSSOT then does a
            // cache MISS and returns the TRIMMED file content. We must NOT
            // cache here either, or readSSOT would return raw content with
            // the trailing newline instead of the trimmed server behavior.

            this.log(
                `SSOT generated: ${targetPath} (${content.length} chars, ${projectInfo.type}/${projectInfo.language})`
            );
            return content;
        } catch (error) {
            this.log(
                `SSOT generate failed: ${error instanceof Error ? error.message : String(error)}`
            );
            return '';
        }
    }

    /** Port of server readSSOT(projectDir) with mtime-validated cache — api.js:1226-1270. */
    public readSSOT(): string {
        try {
            const targetPath = this.ssotPath;
            if (fs.existsSync(targetPath)) {
                const stat = fs.statSync(targetPath);
                const cached = this.cache.get(targetPath);
                if (cached && cached.mtimeMs === stat.mtimeMs && cached.content) {
                    return cached.content;
                }
                const content = fs.readFileSync(targetPath, 'utf8').trim();
                if (content.length > 0) {
                    this.cache.set(targetPath, { content, mtimeMs: stat.mtimeMs });
                    return content;
                }
            }
        } catch (error) {
            this.log(
                `SSOT read failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        return '';
    }
}
