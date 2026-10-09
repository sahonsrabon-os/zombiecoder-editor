/**
 * FootprintScanner — language-based workspace footprint.
 *
 * Walks the workspace (bounded depth, skipping vendored/build output) and
 * tallies source files by language. The resulting footprint is written into
 * `.zombiecoder/agents/syllabus.md` as a "Workspace Footprint" section so
 * agents can immediately see which languages the project uses without
 * re-scanning the filesystem.
 *
 * Phase 1 — Mission Foundation.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Footprint {
    languages: string[];
    counts: Record<string, number>;
    samples: Record<string, string[]>;
}

const LANGUAGE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
    typescript: ['.ts', '.tsx', '.mts', '.cts'],
    javascript: ['.js', '.jsx', '.mjs', '.cjs'],
    python: ['.py', '.pyw'],
    php: ['.php'],
    ruby: ['.rb'],
    rust: ['.rs'],
    go: ['.go'],
    java: ['.java'],
    csharp: ['.cs'],
    cpp: ['.cpp', '.hpp', '.cc', '.cxx'],
    c: ['.c', '.h'],
    html: ['.html', '.htm'],
    css: ['.css', '.scss', '.less'],
    sql: ['.sql'],
    shell: ['.sh', '.bash', '.zsh'],
    json: ['.json'],
    markdown: ['.md'],
    yaml: ['.yml', '.yaml'],
};

const SKIP_DIRS = new Set([
    'node_modules',
    'vendor',
    '.git',
    'dist',
    'build',
    'out',
    '.zombiecoder',
    '.vscode',
    'coverage',
]);

const MAX_WALK_DEPTH = 6;
const MAX_SAMPLES_PER_LANGUAGE = 5;

export class FootprintScanner {
    constructor(
        private readonly workspaceRoot: string,
        private readonly log: (message: string) => void
    ) { }

    public scan(): Footprint {
        const counts: Record<string, number> = {};
        const samples: Record<string, string[]> = {};
        this.walk(this.workspaceRoot, counts, samples, 0);

        const languages = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([language]) => language);

        return { languages, counts, samples };
    }

    private walk(
        dir: string,
        counts: Record<string, number>,
        samples: Record<string, string[]>,
        depth: number
    ): void {
        if (depth > MAX_WALK_DEPTH) {
            return;
        }

        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(fullPath);
            } catch {
                continue;
            }

            if (stat.isDirectory()) {
                if (!SKIP_DIRS.has(entry) && !entry.startsWith('.')) {
                    this.walk(fullPath, counts, samples, depth + 1);
                }
                continue;
            }

            const ext = path.extname(entry).toLowerCase();
            for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
                if (extensions.includes(ext)) {
                    counts[language] = (counts[language] ?? 0) + 1;
                    if ((samples[language]?.length ?? 0) < MAX_SAMPLES_PER_LANGUAGE) {
                        (samples[language] ??= []).push(fullPath);
                    }
                    break;
                }
            }
        }
    }

    /** Append/replace the "Workspace Footprint" section in the agent syllabus. */
    public updateSyllabus(footprint: Footprint): void {
        if (footprint.languages.length === 0) {
            return;
        }

        const syllabusPath = path.join(
            this.workspaceRoot,
            '.zombiecoder',
            'agents',
            'syllabus.md'
        );
        if (!fs.existsSync(syllabusPath)) {
            return;
        }

        try {
            const syllabus = fs.readFileSync(syllabusPath, 'utf8');
            const sectionMarker = '## 9. WORKSPACE FOOTPRINT';

            const rows = footprint.languages
                .map((language) => {
                    const sampleFiles = (footprint.samples[language] ?? [])
                        .slice(0, 2)
                        .map((file) => `\`${path.basename(file)}\``)
                        .join(', ');
                    return `| ${language} | ${footprint.counts[language]} | ${sampleFiles || '—'} |`;
                })
                .join('\n');

            const newSection = `${sectionMarker}

Auto-detected from the active workspace by the extension (Phase 1 footprint scanner):

| Language | File Count | Sample Files |
|----------|-----------|--------------|
${rows}

---
`;

            let updated: string;
            const markerIndex = syllabus.indexOf(sectionMarker);
            if (markerIndex >= 0) {
                updated = syllabus.slice(0, markerIndex) + newSection.trimEnd() + '\n';
            } else {
                updated = syllabus.trimEnd() + '\n\n' + newSection.trimEnd() + '\n';
            }

            fs.writeFileSync(syllabusPath, updated, 'utf8');
            this.log(
                `Syllabus footprint updated: ${footprint.languages.join(', ')} (${footprint.languages.length} languages)`
            );
        } catch (error) {
            this.log(
                `Syllabus footprint update failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}
