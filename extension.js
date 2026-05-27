const vscode = require("vscode");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const UNIX_INSTALL_SCRIPT_URL = "https://ite.kiishi.space/install.sh";
const WINDOWS_INSTALL_SCRIPT_URL = "https://ite.kiishi.space/install.ps1";

let currentTerminal;
let statusBarItem;
let lastRuntimeState;

function isCancellation(error) {
  return (
    error &&
    (error.name === "Canceled" ||
      error.message === "Canceled" ||
      String(error).includes("Canceled"))
  );
}

function handleCommandError(error) {
  if (isCancellation(error)) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`iTE failed: ${message}`);
}

function registerCommand(context, command, callback) {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async () => {
      try {
        await callback();
      } catch (error) {
        handleCommandError(error);
      }
    }),
  );
}

function getConfig() {
  return vscode.workspace.getConfiguration("ite");
}

function getWorkspaceCwd() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

function getSystemExecutable() {
  const executable = getConfig().get("executable", "ite").trim();
  return executable || "ite";
}

function getIteArgs() {
  const configuredArgs = getConfig().get("args", []);
  if (!Array.isArray(configuredArgs)) {
    return [];
  }

  return configuredArgs.filter((arg) => typeof arg === "string");
}

function getDefaultInstalledExecutable() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "iTE", "bin", "ite.exe");
  }

  return path.join(os.homedir(), ".ite", "bin", "ite");
}

function getRuntimeCandidates() {
  const configuredExecutable = getSystemExecutable();
  const installedExecutable = getDefaultInstalledExecutable();
  const candidates = [
    {
      executable: configuredExecutable,
      source: configuredExecutable === "ite" ? "PATH" : "configured",
    },
  ];

  if (installedExecutable !== configuredExecutable) {
    candidates.push({
      executable: installedExecutable,
      source: "installed",
    });
  }

  return candidates;
}

function checkExecutable(executable) {
  return new Promise((resolve) => {
    execFile(executable, ["--version"], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          installed: false,
          executable,
          message: error.message,
        });
        return;
      }

      resolve({
        installed: true,
        executable,
        message: String(stdout || stderr).trim(),
      });
    });
  });
}

async function resolveRuntime() {
  const failed = [];
  for (const candidate of getRuntimeCandidates()) {
    const result = await checkExecutable(candidate.executable);
    if (result.installed) {
      return {
        ...result,
        source: candidate.source,
      };
    }
    failed.push(result.message);
  }

  return {
    installed: false,
    source: "none",
    executable: getSystemExecutable(),
    message: failed.find(Boolean) || "No iTE executable was found.",
  };
}

function setRuntimeState(result) {
  lastRuntimeState = result;
  updateStatusBar(result);
}

function getTerminalOptions(runtime) {
  return {
    name: "iTE",
    cwd: getWorkspaceCwd(),
    shellPath: runtime.executable,
    shellArgs: getIteArgs(),
  };
}

async function createIteTerminal(runtime) {
  currentTerminal = vscode.window.createTerminal(getTerminalOptions(runtime));
  currentTerminal.show();
}

async function ensureRuntimeOrPrompt() {
  const runtime = await resolveRuntime();
  setRuntimeState(runtime);

  if (runtime.installed) {
    return runtime;
  }

  const action = await vscode.window.showWarningMessage(
    "iTE is not installed yet. Install iTE to open it in VS Code.",
    "Install iTE",
    "Open Docs",
  );

  if (action === "Install iTE") {
    await installRuntime();
    return undefined;
  }

  if (action === "Open Docs") {
    await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
  }

  return undefined;
}

async function openTerminal() {
  if (currentTerminal) {
    currentTerminal.show();
    return;
  }

  const runtime = await ensureRuntimeOrPrompt();
  if (!runtime || !runtime.installed) {
    return;
  }

  await createIteTerminal(runtime);
}

async function openNewTerminal() {
  const runtime = await ensureRuntimeOrPrompt();
  if (!runtime || !runtime.installed) {
    return;
  }

  await createIteTerminal(runtime);
}

async function checkInstallation() {
  const runtime = await resolveRuntime();
  setRuntimeState(runtime);

  if (runtime.installed) {
    await vscode.window.showInformationMessage(
      `iTE is ready using the ${runtime.source} executable${
        runtime.message ? `: ${runtime.message}` : "."
      }`,
    );
    return;
  }

  const action = await vscode.window.showWarningMessage(
    "iTE is not installed yet. Install iTE to use it in VS Code.",
    "Install iTE",
    "Open Docs",
  );

  if (action === "Install iTE") {
    await installRuntime();
  } else if (action === "Open Docs") {
    await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getInstallTerminalOptions() {
  const options = {
    name: "iTE",
    cwd: getWorkspaceCwd(),
  };

  if (process.platform === "win32") {
    options.shellPath = "powershell.exe";
    options.shellArgs = ["-NoProfile"];
  }

  return options;
}

function getInstallAndRunCommand() {
  const args = getIteArgs();

  if (process.platform === "win32") {
    const quotedArgs = args.map(powershellQuote).join(" ");
    const runArgs = quotedArgs ? ` ${quotedArgs}` : "";
    return [
      "$ErrorActionPreference = 'Stop'",
      `irm ${WINDOWS_INSTALL_SCRIPT_URL} | iex`,
      "$ite = Join-Path $env:LOCALAPPDATA 'iTE\\bin\\ite.exe'",
      `if (Test-Path $ite) { & $ite${runArgs} } else { Write-Error 'iTE installed, but the executable was not found.' }`,
    ].join("; ");
  }

  const quotedArgs = args.map(shellQuote).join(" ");
  const script = [
    "set -e",
    'INSTALLER="$(mktemp)"',
    'trap \'rm -f "$INSTALLER"\' EXIT',
    `curl -fsSL ${UNIX_INSTALL_SCRIPT_URL} -o "$INSTALLER"`,
    'sh "$INSTALLER"',
    'ITE_BIN="$HOME/.ite/bin/ite"',
    'test -x "$ITE_BIN" || { echo "iTE installer finished, but $ITE_BIN was not found." >&2; exit 1; }',
    'exec "$ITE_BIN" "$@"',
  ].join("; ");
  const runArgs = quotedArgs ? ` ${quotedArgs}` : "";
  return `sh -c ${shellQuote(script)} sh${runArgs}`;
}

async function installRuntime() {
  const terminal = vscode.window.createTerminal(getInstallTerminalOptions());
  currentTerminal = terminal;
  terminal.show();
  terminal.sendText(getInstallAndRunCommand(), true);
  setRuntimeState({
    installed: false,
    source: "installer",
    message: "Installing iTE in the terminal.",
  });
  await vscode.window.showInformationMessage(
    "The iTE installer is running in the terminal. iTE will start there after installation completes.",
  );
  return undefined;
}

function registerTerminalProfile(context) {
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("ite.terminalProfile", {
      async provideTerminalProfile() {
        const runtime = await ensureRuntimeOrPrompt();
        if (!runtime || !runtime.installed) {
          throw new Error("No iTE executable is available.");
        }

        return new vscode.TerminalProfile(getTerminalOptions(runtime));
      },
    }),
  );
}

function updateStatusBar(runtime) {
  if (!statusBarItem) {
    return;
  }

  const installed = Boolean(runtime && runtime.installed);
  statusBarItem.text = installed ? "$(window) iTE" : "$(cloud-download) iTE";
  statusBarItem.tooltip = installed
    ? `Open iTE terminal using the ${runtime.source} executable`
    : runtime && runtime.message
      ? runtime.message
      : "Install iTE";
}

function registerStatusBar(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = "iTE";
  statusBarItem.text = "$(window) iTE";
  statusBarItem.tooltip = "Open iTE terminal";
  statusBarItem.command = "ite.openTerminal";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

async function showWelcomeOnce(context) {
  const key = "ite.welcomeShown";
  if (context.globalState.get(key)) {
    return;
  }

  const runtime = await resolveRuntime();
  setRuntimeState(runtime);
  await context.globalState.update(key, true);

  if (runtime.installed) {
    const action = await vscode.window.showInformationMessage(
      "iTE is ready in VS Code. Open the AI coding agent in a dedicated terminal.",
      "Open iTE",
    );

    if (action === "Open iTE") {
      await openTerminal();
    }
    return;
  }

  const action = await vscode.window.showInformationMessage(
    "Install iTE to use the AI coding agent directly inside VS Code.",
    "Install iTE",
    "Open Docs",
  );

  if (action === "Install iTE") {
    await installRuntime();
  } else if (action === "Open Docs") {
    await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
  }
}

async function refreshRuntimeState() {
  const runtime = await resolveRuntime();
  setRuntimeState(runtime);
}

function activate(context) {
  registerCommand(context, "ite.openTerminal", openTerminal);
  registerCommand(context, "ite.openNewTerminal", openNewTerminal);
  registerCommand(context, "ite.checkInstallation", checkInstallation);
  registerCommand(context, "ite.installRuntime", installRuntime);
  registerTerminalProfile(context);
  registerStatusBar(context);
  void refreshRuntimeState().catch(handleCommandError);
  void showWelcomeOnce(context).catch(handleCommandError);

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === currentTerminal) {
        currentTerminal = undefined;
      }
    }),
  );
}

function deactivate() {
  statusBarItem = undefined;
}

module.exports = {
  activate,
  deactivate,
};
