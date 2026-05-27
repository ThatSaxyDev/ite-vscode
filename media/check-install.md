iTE is the Interactive Terminal Environment: an AI coding agent for your terminal.

This VS Code extension needs an iTE runtime before it can open iTE.

The preferred VS Code path is a managed runtime installed by the extension. If you already use iTE in your terminal, the extension can also fall back to the system CLI:

```bash
pipx install ite-agent
```

You can also install with:

```bash
uv tool install ite-agent
```

If iTE is already installed but VS Code cannot find it, set `ite.executable` to the full path returned by `which ite`.

Learn more at [ite.kiishi.space](https://ite.kiishi.space).
