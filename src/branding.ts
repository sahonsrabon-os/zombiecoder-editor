/**
 * branding — the single source of truth for every user-facing product name.
 *
 * "Fully dynamic": the product name is seeded once at activation from the
 * extension manifest's `displayName` (see `setProductName`), so renaming the
 * extension in `package.json` flows through every status bar, toast, tooltip,
 * quick-pick and output-channel label without touching a single source file.
 * A compile-time fallback keeps pure modules — and unit tests, which never
 * load `vscode` — rendering sensibly.
 *
 * Two distinct names are tracked:
 *   - {@link getProductName}  — the extension/editor product (this extension).
 *   - {@link getPlatformName} — the backend platform it talks to (the
 *     7-agent server). Kept separate so "you are a <platform> agent" prompts
 *     stay semantically correct even if the extension is rebranded.
 *
 * This module deliberately has **no `vscode` import** so it can be used from
 * pure renderers that are unit-tested outside the editor.
 */

/** Fallback used before activation and in `vscode`-free unit tests. */
export const DEFAULT_PRODUCT_NAME = 'ZombieCoder';

/** Fallback platform name (the 7-agent inference server). */
export const DEFAULT_PLATFORM_NAME = 'Mission Barisal';

let productName = DEFAULT_PRODUCT_NAME;
let platformName = DEFAULT_PLATFORM_NAME;

/**
 * Seed the user-facing product name. Called once from `activate()` with the
 * extension manifest's `displayName`. Empty/whitespace values are ignored so a
 * malformed manifest can never blank out the UI.
 */
export function setProductName(name: string | undefined): void {
  const trimmed = (name ?? '').trim();
  if (trimmed) {
    productName = trimmed;
  }
}

/** Seed the backend platform name (optional; defaults to Mission Barisal). */
export function setPlatformName(name: string | undefined): void {
  const trimmed = (name ?? '').trim();
  if (trimmed) {
    platformName = trimmed;
  }
}

/** The current extension/product name, e.g. `ZombieCoder`. */
export function getProductName(): string {
  return productName;
}

/** The current backend platform name, e.g. `Mission Barisal`. */
export function getPlatformName(): string {
  return platformName;
}

/**
 * Compose a `"<Product> — <suffix>"` label for quick-pick titles, input-box
 * titles and similar chrome. Returns the bare product name when `suffix` is
 * empty.
 */
export function brandLabel(suffix: string): string {
  const trimmed = suffix.trim();
  return trimmed ? `${productName} — ${trimmed}` : productName;
}
