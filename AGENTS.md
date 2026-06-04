# ite-vscode

Based on my investigation, here's the AGENTS.md:

# AGENTS.md

## Project Overview

**Project:** `ite-vscode`

VS Code extension for iTE (Interactive Terminal Environment) — an AI coding agent for the terminal. Runs iTE in a dedicated VS Code terminal beside the current editor. Handles automatic runtime detection, managed installation from `ite.kiishi.space`, and session resume.

## Architecture

```
ite-vscode/
├── extension.js          # Single-file extension (CommonJS)
├── package.json          # VS Code extension manifest
├── builds/               # Packaged .vsix files
├── media/                # Icons and documentation screenshots
└── .vscode/
    └── launch.json       # VS Code debug config
```

- **Entry point**: `extension.js` (plain JavaScript, no TypeScript, no build step)
- **Module system**: CommonJS (`require`/`module.exports`)
- **No `src/` directory** — code lives at root
- **Runtime**: Node.js (VS Code extension host), uses only Node built-ins (`fs`, `http`, `https`, `crypto`, `os`, `path`, `child_process`) + `vscode` API

### Key Components

| Concern | Location |
|---------|----------|
| Extension activate/deactivate | `extension.js:851-886` |
| Runtime detection | `extension.js:133-190` |
| Managed install/download | `extension.js:377-641` |
| Terminal management | `extension.js:209-275` |
| Status bar integration | `extension.js:742-767` |
| Auto-update checking | `extension.js:643-725` |
| Session resume prompts | `extension.js:808-844` |

### Registered Commands

| Command ID | Handler |
|------------|---------|
| `ite.openTerminal` | `openTerminal` |
| `ite.openNewTerminal` | `openNewTerminal` |
| `ite.resumeLastSession` | `resumeLastSession` |
| `ite.checkInstallation` | `checkInstallation` |
| `ite.installRuntime` | `installRuntime` |

### Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ite.executable` | `"ite"` | Path to iTE CLI binary |
| `ite.args` | `[]` | CLI arguments passed to iTE |
| `ite.resumeLastSession` | `true` | Auto-resume last session on launch |

## Development Guidelines

**Running the extension:**
| Action | Method |
|--------|--------|
| Debug | Open in VS Code, press `F5` (uses `.vscode/launch.json`) |
| Package | Use `@vscode/vsce` to build `.vsix` |
| Install deps | `npm install` |

**Code Patterns:**
- **Module system**: CommonJS — `require("vscode")`, `module.exports = { activate, deactivate }`
- **Error handling**: Wraps async commands via `registerCommand` helper (`extension.js:38-48`) which catches errors and calls `handleCommandError` — cancellation errors are silently ignored
- **Function style**: `async function` with `const`/`let`, no classes
- **Network**: Raw Node.js `http`/`https` module (no `fetch` or third-party HTTP library)
- **Runtime detection**: Tries configured executable → managed install path, runs `--version` to verify
- **Install flow**: Downloads manifest from `https://ite.kiishi.space/releases/manifest.json` → downloads `tar.gz` → extracts → symlinks to `~/.ite/bin/ite`
- **State management**: Module-level mutable variables (`currentTerminal`, `statusBarItem`, `lastRuntimeState`)

**Tool Preferences by File Type:**
| File type | Tool |
|-----------|------|
| `.js` | Node.js (no typecheck/lint configured) |
| `.vsix` | `@vscode/vsce package` |
| `.json` | `vscode` manifest validation |

## Configuration

- **Extension manifest**: `package.json` (VS Code `contributes`, `activationEvents`, `main`)
- **Debug config**: `.vscode/launch.json`
- **Install root**: `~/.ite/` (managed runtime location)
- **Release endpoint**: `https://ite.kiishi.space/releases/manifest.json`
