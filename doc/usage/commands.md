# Command Palette Commands

All commands are prefixed **"ZombieCoder"** (category) and are available from
the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command                                            | Description                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| **ZombieCoder: Configure Server**  | Set the server URL and API key (also opened from "Add Models…").    |
| **ZombieCoder: Test Server Connection** | Probe connectivity and list available models.                   |
| **ZombieCoder: Refresh Models**    | Re-probe the inference server and refresh the model picker.         |
| **ZombieCoder: Edit Custom Headers** | Add, edit, or remove custom HTTP headers (stored in secret storage). |
| **ZombieCoder: Show Output Log**   | Open the extension's output channel.                                 |

## Command IDs

| Command                                   | ID                                                        |
| ----------------------------------------- | --------------------------------------------------------- |
| Configure Server                          | `zombiecoder.mission-barisal.manage`                      |
| Test Server Connection                    | `zombiecoder.mission-barisal.testConnection`              |
| Refresh Models                            | `zombiecoder.mission-barisal.refreshModels`               |
| Edit Custom Headers                       | `zombiecoder.mission-barisal.editCustomHeaders`           |
| Show Output Log                           | `zombiecoder.mission-barisal.showOutput`                  |

> **Note:** `zombiecoder.mission-barisal.manage` is also wired as the provider's
> `managementCommand`, so it opens automatically when you click **Manage Models...**
> in the Copilot model picker.

## Related VS Code commands

- **Chat: Manage Language Models** — built-in model manager where ZombieCoder
  appears as a provider.
- **Extensions: Install from VSIX...** — install the `.vsix` build.
