iTE is an AI coding agent for your terminal.

This VS Code extension needs iTE before it can open iTE.

If iTE is not installed yet, the extension opens the official installer in a visible VS Code terminal:

```bash
curl -fsSL https://ite.kiishi.space/install.sh | sh
```

If you already use iTE in your terminal, the extension can use that executable:

```bash
pipx install ite-agent
```

You can also install with:

```bash
uv tool install ite-agent
```

If iTE is already installed but VS Code cannot find it, set `ite.executable` to the full path returned by `which ite`.

Learn more at [ite.kiishi.space](https://ite.kiishi.space).
