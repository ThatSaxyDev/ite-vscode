const vscode = require("vscode");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");

let currentTerminal;
let statusBarItem;
let lastRuntimeState;
let extensionContext;
let outputChannel;

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

function getOutputChannel() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("iTE");
  }
  return outputChannel;
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

function preferManagedRuntime() {
  return getConfig().get("preferManagedRuntime", true);
}

function useSystemFallback() {
  return getConfig().get("useSystemFallback", true);
}

function getRuntimeManifestUrl() {
  return getConfig().get(
    "runtimeManifestUrl",
    "https://ite.kiishi.space/releases/vscode/manifest.json",
  );
}

function getStorageRoot() {
  return extensionContext.globalStorageUri.fsPath;
}

function getManagedRuntimeMetadataPath() {
  return path.join(getStorageRoot(), "runtime", "runtime.json");
}

function getPlatformKey() {
  const platform = process.platform;
  const arch = {
    arm64: "arm64",
    x64: "x64",
  }[process.arch] || process.arch;

  return `${platform}-${arch}`;
}

function executableExists(executable) {
  return fs.existsSync(executable);
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

async function getManagedRuntime() {
  const metadataPath = getManagedRuntimeMetadataPath();
  if (!fs.existsSync(metadataPath)) {
    return {
      installed: false,
      source: "managed",
      message: "Managed runtime is not installed.",
    };
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    if (!metadata.executable || !executableExists(metadata.executable)) {
      return {
        installed: false,
        source: "managed",
        message: "Managed runtime metadata exists, but the executable is missing.",
      };
    }

    const result = await checkExecutable(metadata.executable);
    return {
      ...result,
      source: "managed",
      version: metadata.version,
    };
  } catch (error) {
    return {
      installed: false,
      source: "managed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getSystemRuntime() {
  if (!useSystemFallback()) {
    return {
      installed: false,
      source: "system",
      executable: getSystemExecutable(),
      message: "System fallback is disabled.",
    };
  }

  const result = await checkExecutable(getSystemExecutable());
  return {
    ...result,
    source: "system",
  };
}

async function resolveRuntime() {
  const managed = await getManagedRuntime();
  if (preferManagedRuntime() && managed.installed) {
    return managed;
  }

  const system = await getSystemRuntime();
  if (system.installed) {
    return system;
  }

  if (managed.installed) {
    return managed;
  }

  return {
    installed: false,
    source: "none",
    message: managed.message || system.message || "No iTE runtime was found.",
    managed,
    system,
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
    "iTE needs a runtime before it can open in VS Code.",
    "Install Runtime",
    "Use System iTE",
    "Open Docs",
  );

  if (action === "Install Runtime") {
    return installRuntime();
  }

  if (action === "Use System iTE") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "ite.executable",
    );
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
      `iTE is ready using the ${runtime.source} runtime${
        runtime.message ? `: ${runtime.message}` : "."
      }`,
    );
    return;
  }

  const action = await vscode.window.showWarningMessage(
    "No iTE runtime was found. Install the managed runtime from VS Code, or configure a system `ite` executable.",
    "Install Runtime",
    "Configure System Path",
    "Open Docs",
  );

  if (action === "Install Runtime") {
    await installRuntime();
  } else if (action === "Configure System Path") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "ite.executable",
    );
  } else if (action === "Open Docs") {
    await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
  }
}

async function installRuntime() {
  const manifestUrl = getRuntimeManifestUrl();
  if (!manifestUrl) {
    await vscode.window.showErrorMessage("Set `ite.runtimeManifestUrl` before installing the managed runtime.");
    return undefined;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing iTE runtime",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Fetching release manifest..." });
      const manifest = await fetchJson(manifestUrl);
      const platformKey = getPlatformKey();
      const asset = manifest.assets && manifest.assets[platformKey];
      if (!asset) {
        throw new Error(`No iTE runtime is available for ${platformKey}.`);
      }

      const runtimeRoot = path.join(getStorageRoot(), "runtime");
      const downloadsRoot = path.join(runtimeRoot, "downloads");
      const installRoot = path.join(runtimeRoot, String(manifest.version));
      fs.mkdirSync(downloadsRoot, { recursive: true });
      fs.rmSync(installRoot, { recursive: true, force: true });
      fs.mkdirSync(installRoot, { recursive: true });

      const assetUrl = resolveAssetUrl(asset.url, manifestUrl);
      const archivePath = path.join(downloadsRoot, path.basename(new URL(assetUrl).pathname));
      progress.report({ message: "Downloading runtime..." });
      await downloadFile(assetUrl, archivePath);

      if (asset.sha256) {
        progress.report({ message: "Verifying runtime..." });
        verifySha256(archivePath, asset.sha256);
      }

      progress.report({ message: "Extracting runtime..." });
      await extractArchive(archivePath, installRoot, asset.archiveType);

      const executable = path.join(installRoot, "ite", asset.executable || defaultExecutableName());
      if (!fs.existsSync(executable)) {
        throw new Error(`Runtime executable was not found after extraction: ${executable}`);
      }

      if (process.platform !== "win32") {
        fs.chmodSync(executable, 0o755);
      }

      const metadata = {
        version: manifest.version,
        source: "managed",
        platform: platformKey,
        executable,
        installedAt: new Date().toISOString(),
      };
      fs.writeFileSync(getManagedRuntimeMetadataPath(), JSON.stringify(metadata, null, 2));

      const runtime = await getManagedRuntime();
      setRuntimeState(runtime);
      await vscode.window.showInformationMessage("iTE runtime installed.");
      return runtime;
    },
  );
}

function defaultExecutableName() {
  return process.platform === "win32" ? "ite.exe" : "ite";
}

function resolveAssetUrl(assetUrl, manifestUrl) {
  return new URL(assetUrl, manifestUrl).toString();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Request failed with HTTP ${response.statusCode}: ${url}`));
          response.resume();
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
          response.resume();
          return;
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (error) => {
        file.close();
        reject(error);
      });
  });
}

function verifySha256(filePath, expected) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (hash.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error("Downloaded iTE runtime failed checksum verification.");
  }
}

function extractArchive(archivePath, destination, archiveType) {
  if (archiveType === "zip" || archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      return runCommand("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Expand-Archive",
        "-LiteralPath",
        archivePath,
        "-DestinationPath",
        destination,
        "-Force",
      ]);
    }

    return runCommand("unzip", ["-q", archivePath, "-d", destination]);
  }

  return runCommand("tar", ["-xzf", archivePath, "-C", destination]);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function registerTerminalProfile(context) {
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider("ite.terminalProfile", {
      async provideTerminalProfile() {
        const runtime = await ensureRuntimeOrPrompt();
        if (!runtime || !runtime.installed) {
          throw new Error("No iTE runtime is available.");
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
    ? `Open iTE in VS Code using the ${runtime.source} runtime`
    : "Install or configure the iTE runtime";
}

function registerStatusBar(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = "iTE";
  statusBarItem.text = "$(window) iTE";
  statusBarItem.tooltip = "Open iTE in VS Code";
  statusBarItem.command = "ite.openWebview";
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
      "iTE is ready in VS Code. Open the AI coding agent in a VS Code panel.",
      "Open iTE",
    );

    if (action === "Open iTE") {
      await openWebview();
    }
    return;
  }

  const action = await vscode.window.showInformationMessage(
    "Install the iTE runtime to use the AI coding agent directly inside VS Code.",
    "Install Runtime",
    "Use Existing CLI",
  );

  if (action === "Install Runtime") {
    await installRuntime();
  } else if (action === "Use Existing CLI") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "ite.executable",
    );
  }
}

async function refreshRuntimeState() {
  const runtime = await resolveRuntime();
  setRuntimeState(runtime);
}

let currentWebviewPanel;
let webServerProcess;
let webServerUrl;
let webServerCwd;
let webServerOutput = "";

function stopWebServer() {
  const child = webServerProcess;
  webServerProcess = undefined;
  webServerUrl = undefined;
  webServerCwd = undefined;

  if (!child || child.killed) {
    return;
  }

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    }
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 1500);
  } catch (error) {
    getOutputChannel().appendLine(
      `Failed to stop iTE webview runtime: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function stopWebviewRuntime() {
  if (currentWebviewPanel) {
    currentWebviewPanel.dispose();
    return;
  }
  stopWebServer();
}

function appendRuntimeOutput(source, data) {
  const text = String(data || "");
  if (!text) {
    return;
  }
  webServerOutput += text;
  if (webServerOutput.length > 12000) {
    webServerOutput = webServerOutput.slice(-12000);
  }
  getOutputChannel().append(`[${source}] ${text}`);
}

function waitForReadyLine(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for iTE webview runtime to start.\n${webServerOutput}`,
        ),
      );
    }, timeoutMs);

    function finish(error, ready) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) {
        reject(error);
      } else {
        resolve(ready);
      }
    }

    function inspectLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) {
        return;
      }
      try {
        const payload = JSON.parse(trimmed);
        if (payload && payload.type === "ready" && payload.url) {
          finish(undefined, payload);
        }
      } catch {
        // Non-JSON server output is expected after the ready line.
      }
    }

    function onStdout(data) {
      appendRuntimeOutput("stdout", data);
      buffer += String(data);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        inspectLine(line);
      }
    }

    function onStderr(data) {
      appendRuntimeOutput("stderr", data);
    }

    function onError(error) {
      finish(error);
    }

    function onExit(code, signal) {
      finish(
        new Error(
          `iTE webview runtime exited before it was ready (code=${code}, signal=${signal}).\n${webServerOutput}`,
        ),
      );
    }

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });

      req.on("error", retry);
    }

    function retry() {
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url} to respond.`));
        return;
      }
      setTimeout(attempt, 150);
    }

    attempt();
  });
}

async function startWebServer(runtime, cwd, progress) {
  if (webServerProcess && webServerUrl && webServerCwd === cwd) {
    return webServerUrl;
  }

  stopWebServer();
  webServerOutput = "";
  progress.report({ message: "Starting iTE runtime..." });

  const args = [
    "--cwd",
    cwd,
    ...getIteArgs(),
    "serve-vscode",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ];

  const child = spawn(runtime.executable, args, {
    cwd,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  webServerProcess = child;
  webServerCwd = cwd;

  child.on("exit", (code, signal) => {
    if (webServerProcess === child) {
      webServerProcess = undefined;
      webServerUrl = undefined;
      webServerCwd = undefined;
      if (currentWebviewPanel) {
        currentWebviewPanel.webview.html = getWebviewErrorHtml(
          `iTE webview runtime stopped (code=${code}, signal=${signal}).`,
        );
      }
    }
  });

  const ready = await waitForReadyLine(child, 20000);
  webServerUrl = ready.url;

  progress.report({ message: "Waiting for webview..." });
  await waitForHttpReady(webServerUrl, 10000);
  return webServerUrl;
}

async function openWebview() {
  const runtime = await ensureRuntimeOrPrompt();
  if (!runtime || !runtime.installed) {
    return;
  }

  // If webview already open, show it
  if (currentWebviewPanel) {
    currentWebviewPanel.reveal();
    return;
  }

  // Get workspace CWD
  const cwd = getWorkspaceCwd() || process.cwd();

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Opening iTE in VS Code",
      cancellable: false,
    },
    async (progress) => {
      try {
        const url = await startWebServer(runtime, cwd, progress);
        progress.report({ message: "Creating VS Code panel..." });

        // Create the webview panel
        const panel = vscode.window.createWebviewPanel(
          "ite",
          "iTE",
          vscode.ViewColumn.One,
          getWebviewOptions(url)
        );

        currentWebviewPanel = panel;

        // Get the HTML for the webview
        panel.webview.html = getWebviewHtml(panel.webview, url);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.type === "openExternal" && webServerUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(webServerUrl));
          } else if (message.type === "openTerminal") {
            await openNewTerminal();
          } else if (message.type === "reload" && webServerUrl) {
            panel.webview.html = getWebviewHtml(panel.webview, webServerUrl);
          }
        });

        // Clean up when panel is closed
        panel.onDidDispose(() => {
          currentWebviewPanel = null;
          stopWebServer();
        });

      } catch (error) {
        stopWebServer();
        throw error;
      }
    }
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getNonce() {
  return crypto.randomBytes(16).toString("base64");
}

function getWebviewOptions(url) {
  const options = {
    enableScripts: true,
    retainContextWhenHidden: true,
  };

  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    if (Number.isInteger(port) && port > 0) {
      options.portMapping = [
        {
          webviewPort: port,
          extensionHostPort: port,
        },
      ];
    }
  } catch {
    // Keep the basic webview options if URL parsing fails.
  }

  return options;
}

function getWebviewHtml(webview, url) {
  const nonce = getNonce();
  const escapedUrl = escapeHtml(url);
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:* http://localhost:*; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>iTE</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #0c1116;
    }
    .shell {
      width: 100vw;
      height: 100vh;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #0c1116;
    }
    .fallback {
      position: fixed;
      right: 12px;
      bottom: 12px;
      display: flex;
      gap: 8px;
      opacity: 0;
      transition: opacity 120ms ease;
      pointer-events: none;
    }
    body:hover .fallback,
    .fallback:focus-within {
      opacity: 1;
      pointer-events: auto;
    }
    button {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.92);
      color: #e5e7eb;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 7px 10px;
      cursor: pointer;
    }
    button:hover {
      background: rgba(30, 41, 59, 0.96);
    }
  </style>
</head>
<body>
  <div class="shell">
    <iframe src="${escapedUrl}" title="iTE" allow="clipboard-read; clipboard-write"></iframe>
  </div>
  <div class="fallback">
    <button type="button" data-command="reload">Reload</button>
    <button type="button" data-command="openExternal">Open in Browser</button>
    <button type="button" data-command="openTerminal">Terminal Fallback</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        vscode.postMessage({ type: button.dataset.command });
      });
    });
  </script>
</body>
</html>`;
}

function getWebviewErrorHtml(message) {
  const escapedMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0c1116;
      color: #e5e7eb;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 520px;
      padding: 24px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: #aeb8c5;
    }
  </style>
</head>
<body>
  <main>
    <h1>iTE stopped</h1>
    <p>${escapedMessage}</p>
  </main>
</body>
</html>`;
}

function activate(context) {
  extensionContext = context;
  registerCommand(context, "ite.openTerminal", openTerminal);
  registerCommand(context, "ite.openNewTerminal", openNewTerminal);
  registerCommand(context, "ite.openWebview", openWebview);
  registerCommand(context, "ite.stopWebview", stopWebviewRuntime);
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
  stopWebServer();
  statusBarItem = undefined;
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
}

module.exports = {
  activate,
  deactivate,
};
