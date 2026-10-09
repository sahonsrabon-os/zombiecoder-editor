import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SsotManager, MISSION_AGENTS } from '../ssotManager';

const tempDirs: string[] = [];

function makeTempProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-ssot-'));
    tempDirs.push(dir);
    return dir;
}

after(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('SsotManager — client-side SSOT engine (Phase 1)', () => {
    test('scanProject detects node + typescript from package.json and source files', () => {
        const root = makeTempProject();
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ name: 'my-app', dependencies: { express: '^4.0.0' }, devDependencies: { typescript: '^5.0.0' } })
        );
        fs.mkdirSync(path.join(root, 'src'));
        // Root-level .ts files are what scanProject counts (server behavior —
        // it only readdirSync's the root; files in subdirs land in sourceDirs).
        fs.writeFileSync(path.join(root, 'index.ts'), 'export const x = 1;\n');
        fs.writeFileSync(path.join(root, 'util.ts'), 'export const y = 2;\n');
        fs.writeFileSync(path.join(root, 'src', 'helper.ts'), 'export const z = 3;\n');

        const ssot = new SsotManager(root, () => { });
        const info = ssot.scanProject(root);

        assert.equal(info.hasPackageJson, true);
        assert.equal(info.type, 'node');
        assert.equal(info.language, 'typescript');
        assert.equal(info.framework, 'express');
        assert.equal(info.tsCount, 2);
        assert.equal(info.entryFile, 'index.ts');
        assert.deepEqual(info.sourceDirs, ['src']);
    });

    test('generateSSOT emits identity, technology table, structure and agent roster', () => {
        const root = makeTempProject();
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'my-app' }));
        fs.writeFileSync(path.join(root, 'server.js'), 'console.log("hi");');

        const ssot = new SsotManager(root, () => { });
        const info = ssot.scanProject(root);
        const content = ssot.generateSSOT(root, info);

        assert.equal(content.includes('# my-app — Project Context'), true);
        assert.equal(content.includes('## Project Identity'), true);
        assert.equal(content.includes('## Detected Technologies'), true);
        assert.equal(content.includes('## Project Structure'), true);
        assert.equal(content.includes('server.js'), true);
        assert.equal(content.includes('## Mission Barisal Context'), true);
        assert.equal(content.includes('## Agent Instructions'), true);
        for (const agent of MISSION_AGENTS) {
            assert.equal(content.includes(`| \`${agent.id}\` |`), true, `missing agent ${agent.id}`);
        }
    });

    test('regenerate writes .zombiecoder/SSOT.md and readSSOT returns it', () => {
        const root = makeTempProject();
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'write-app' }));

        const ssot = new SsotManager(root, () => { });
        const content = ssot.regenerate();

        const ssotPath = path.join(root, '.zombiecoder', 'SSOT.md');
        assert.equal(fs.existsSync(ssotPath), true);
        assert.equal(content.length > 0, true);
        // regenerate returns exactly what was written to disk (trailing newline included).
        assert.equal(content, fs.readFileSync(ssotPath, 'utf8'));
        // readSSOT trims, so it matches the trimmed file content.
        assert.equal(ssot.readSSOT(), content.trim());
    });

    test('buildTree skips dotfiles and node_modules', () => {
        const root = makeTempProject();
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, '.gitignore'), 'ignored');
        fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {};');

        const ssot = new SsotManager(root, () => { });
        const tree = ssot.buildTree(root, 0, 3);

        assert.equal(tree.includes('node_modules'), false);
        assert.equal(tree.includes('.gitignore'), false);
        assert.equal(tree.includes('src/'), true);
        assert.equal(tree.includes('main.ts'), true);
    });
});
