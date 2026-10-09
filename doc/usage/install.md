# Install

## From a `.vsix` file (recommended for this release)

1. Download `zombiecoder-mission-barisal-1.7.1.vsix`.
2. Open VS Code.
3. Open the Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
4. Run **Extensions: Install from VSIX...**.
5. Select the downloaded `.vsix` file.
6. Reload VS Code when prompted.

## From the Marketplace (when published)

1. Open the Extensions view: `Ctrl+Shift+X` / `Cmd+Shift+X`.
2. Search for **"ZombieCoder"**.
3. Click **Install**.

## Prerequisites

- **VS Code** 1.120.0 or later.
- **GitHub Copilot** extension installed and signed in.
- An **inference server** running an OpenAI-compatible API
  (vLLM, Ollama, llama.cpp, LocalAI, LiteLLM, or the Mission Barisal 7-agent server).

## Verify installation

1. Open GitHub Copilot Chat (`Ctrl+Alt+I` / `Cmd+Alt+I`).
2. Click the model selector at the bottom.
3. Click **Manage Models...**.
4. The **ZombieCoder** provider should appear in the list.

## Update

- **VSIX:** install the new `.vsix` over the old one and reload.
- **Marketplace:** VS Code updates automatically.

## Uninstall

Extensions view → right-click **ZombieCoder** → **Uninstall**,
then reload. Settings remain in your `settings.json` until you remove them.
