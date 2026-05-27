# iTE for VS Code

iTE is the Interactive Terminal Environment: an AI coding agent for your terminal.

This extension brings iTE into VS Code by launching the iTE runtime in a dedicated VS Code terminal. It can use a VS Code managed runtime, or fall back to an existing system `ite` installation from `pipx` or another installer.

Learn more at [ite.kiishi.space](https://ite.kiishi.space).

## What users see after install

- An `iTE` status-bar item for opening iTE in VS Code.
- `iTE: Open iTE` in the Command Palette.
- An `iTE` terminal profile in VS Code's terminal profile selector.
- A first-run walkthrough that checks whether an iTE runtime is available.
- One-click managed runtime installation when no runtime is available.

## Requirements

The preferred VS Code path is the managed runtime. When you open iTE and no runtime is available, the extension can install the runtime into VS Code's extension storage.

If you already have iTE installed on your system, the extension can use it:

```bash
pipx install ite-agent
```

You can also install with `uv`:

```bash
uv tool install ite-agent
```

After installing the CLI yourself, verify it from a terminal:

```bash
ite --version
```

If VS Code cannot find `ite`, set `ite.executable` to the full path returned by:

```bash
which ite
```

On Windows, use:

```powershell
Get-Command ite
```

## Runtime behavior

If the extension cannot find a managed runtime or system `ite`, it does not silently fail. It will:

- show a warning state in the status bar
- offer to install the managed runtime
- offer to configure a system `ite` executable
- link to docs

## Runtime model

iTE supports two install paths:

- **Managed runtime for VS Code:** installed by the extension into VS Code extension storage.
- **System CLI:** installed separately with `pipx install ite-agent` or `uv tool install ite-agent`.

The managed runtime is preferred by default. You can disable that with `ite.preferManagedRuntime`.

## Try it locally against the local iTE repo

This repository includes a launch configuration that opens an empty Extension Development Host. From there, open or add the project folder you want iTE to run against.

For local development, point the Extension Development Host at the sibling local iTE runtime:

```text
/Users/kiishidavid/Documents/Dev/Projects/itetheagt/ite/.venv/bin/ite
```

1. In the `ite` repo, make sure the local runtime is active and has the latest code:

```bash
cd /Users/kiishidavid/Documents/Dev/Projects/itetheagt/ite
source .venv/bin/activate
ite --version
```

2. Open this extension repo in VS Code:

```bash
cd /Users/kiishidavid/Documents/Dev/Projects/itetheagt/ite-vscode
code .
```

3. Press `F5` and choose `Run iTE Extension Against Local Runtime`.
4. The Extension Development Host opens empty.
5. In that new window, open or add the project folder you want iTE to use as its working directory.
6. In the Extension Development Host, run `iTE: Open iTE` from the Command Palette.

For local development, this setting goes in either:

- the opened project folder's `.vscode/settings.json`
- the Extension Development Host's User Settings JSON

```json
{
  "ite.executable": "/Users/kiishidavid/Documents/Dev/Projects/itetheagt/ite/.venv/bin/ite",
  "ite.preferManagedRuntime": false,
  "ite.useSystemFallback": true
}
```

Before production packaging, remove those local workspace overrides or set production defaults back to:

```json
{
  "ite.executable": "ite",
  "ite.preferManagedRuntime": true,
  "ite.useSystemFallback": true
}
```

## Commands

- `iTE: Open iTE` opens the current iTE terminal if it exists, otherwise creates one and runs `ite`.
- `iTE: Open New iTE Terminal` always creates a fresh terminal and runs `ite`.
- `iTE: Check Installation` verifies that VS Code can find a managed or system runtime.
- `iTE: Install Managed Runtime` downloads and installs the VS Code managed runtime.

## Settings

- `ite.executable`: system executable used as fallback. Defaults to `ite`.
- `ite.args`: arguments passed to the iTE executable. Defaults to `[]`.
- `ite.runtimeManifestUrl`: manifest URL used to install the managed runtime.
- `ite.preferManagedRuntime`: prefer the managed runtime when available. Defaults to `true`.
- `ite.useSystemFallback`: use system `ite` when the managed runtime is unavailable. Defaults to `true`.

Use this if iTE is not on the VS Code PATH, for example:

```json
{
  "ite.executable": "/Users/you/.local/bin/ite"
}
```

## Package for local install

Install dependencies:

```bash
npm install
```

Build a `.vsix` package:

```bash
npm run package
```

Install the generated package:

```bash
code --install-extension ite-vscode-0.0.1.vsix
```

## Publish to the VS Code Marketplace

1. Create a Visual Studio Marketplace publisher.
2. Update `publisher` in `package.json` to match the publisher ID.
3. Create a Marketplace personal access token.
4. Login and publish:

```bash
npx vsce login <publisher-id>
npm run publish
```

Once published, users can install the extension from VS Code's Extensions view and immediately open iTE from the status bar, Command Palette, or terminal profile selector.
