# iTE for VS Code

iTE is an AI coding agent for your terminal.

This extension brings iTE into VS Code by launching iTE in a dedicated VS Code terminal. If iTE is not installed yet, the extension opens the official one-shot installer in that terminal.

Learn more at [ite.kiishi.space](https://ite.kiishi.space).

## What users see after install

- An `iTE` status-bar item for opening iTE in VS Code.
- `iTE: Open iTE` in the Command Palette.
- An `iTE` terminal profile in VS Code's terminal profile selector.
- A first-run walkthrough that checks whether iTE is available.
- One-click installation through the official iTE installer when no executable is available.

## Requirements

The extension expects the normal iTE executable. When you open iTE and no executable is available, the extension runs the official installer in a visible VS Code terminal:

```bash
curl -fsSL https://ite.kiishi.space/install.sh | sh
```

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

If the extension cannot find `ite`, it does not silently fail. It will:

- show a warning state in the status bar
- offer to install iTE
- link to docs

## Runtime model

iTE uses the same runtime in VS Code that it uses in a normal terminal. The official installer places the executable at `~/.ite/bin/ite` on macOS and Linux. The extension also checks that path directly, so a newly installed iTE can run even before VS Code's PATH has refreshed.

## Try it locally

This repository includes a launch configuration that opens an empty Extension Development Host. From there, open or add the project folder you want iTE to run against.

1. Open this extension repo in VS Code:

```bash
cd path/to/ite-vscode
code .
```

2. Press `F5` and choose `Run iTE Extension`.
3. The Extension Development Host opens empty.
4. In that new window, open or add the project folder you want iTE to use as its working directory.
5. In the Extension Development Host, run `iTE: Open iTE` from the Command Palette.

To test the production new-user path, leave the iTE settings unset. The extension will use its defaults and prompt to install iTE when no executable is available.

To test against a locally built iTE executable, set `ite.executable` only in your local User Settings or an uncommitted workspace settings file:

```json
{
  "ite.executable": "/absolute/path/to/ite"
}
```

Before production packaging, remove those local overrides. Production should rely on the extension defaults:

```json
{
  "ite.executable": "ite",
  "ite.args": []
}
```

## Commands

- `iTE: Open iTE` opens the current iTE terminal if it exists, otherwise creates one and runs `ite`.
- `iTE: Open New iTE Terminal` always creates a fresh terminal and runs `ite`.
- `iTE: Check Installation` verifies that VS Code can find iTE.
- `iTE: Install iTE` opens the official installer in a VS Code terminal.

## Settings

- `ite.executable`: executable used to run iTE. Defaults to `ite`.
- `ite.args`: arguments passed to the iTE executable. Defaults to `[]`.

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
