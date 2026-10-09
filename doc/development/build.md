# Build & Package

## Prerequisites

- Node.js 18+ and npm.
- The repository installed with `npm install` (uses `@vscode/vsce` for packaging).

## Compile (type-check)

```bash
npm run test-compile
```

Runs `tsc -p ./` against both `tsconfig.json` and `tsconfig.test.json` and reports
type errors without emitting (the runtime bundle is produced by esbuild).

## Watch mode (development)

```bash
npm run esbuild-watch
```

Rebuilds `out/extension.js` on every source change. Use this while developing.

## Lint

```bash
npm run lint
```

Runs ESLint over `src/` using `eslint.config.mjs`.

## Test

```bash
npm test
```

1. `test-build` — compiles tests to `out-test/`.
2. `node --test out-test/**/*.test.js` — runs the unit test suite
   (api, chat, completions, config, discovery, mission, models, provider, status).

See [Testing](testing.md) for details.

## Package a `.vsix`

```bash
npm run package
```

Runs `vsce package --no-yarn` and produces
`zombiecoder-mission-barisal-1.7.0.vsix` in the project root.

`vsce` validates the manifest (name, publisher, repository, license, icon) before
packaging. The `.vscodeignore` file excludes source, tests, scripts, and
`node_modules` from the package.

## What goes into the `.vsix`

- `out/extension.js` (esbuild bundle, `external: vscode`)
- `package.json`, `README.md`, `LICENSE`
- `assets/` (icons + screenshots)

## Version bump

1. Edit `version` in `package.json`.
2. Update the version badge in `README.md`.
3. Rebuild + package.
