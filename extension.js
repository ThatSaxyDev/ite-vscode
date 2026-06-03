const vscode = require("vscode");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const fsp = fs.promises;
const RELEASE_MANIFEST_URL = "https://ite.kiishi.space/releases/manifest.json";
const LAST_PROMPTED_UPDATE_KEY = "ite.lastPromptedRuntimeUpdate";

let currentTerminal;
let statusBarItem;
let lastRuntimeState;
let runtimeUpdateCheckInFlight = false;

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
    return shouldResumeLastSession() ? ["--resume-last"] : [];
  }

  const args = configuredArgs.filter((arg) => typeof arg === "string");
  if (shouldResumeLastSession() && !args.includes("--resume-last")) {
    args.push("--resume-last");
  }
  return args;
}

function shouldResumeLastSession() {
  return getConfig().get("resumeLastSession", true) === true;
}

function getDefaultInstalledExecutable() {
  return path.join(getManagedInstallRoot(), "bin", process.platform === "win32" ? "ite.exe" : "ite");
}

function getManagedInstallRoot() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "iTE");
  }

  return path.join(os.homedir(), ".ite");
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

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const details = String(stderr || stdout || error.message).trim();
        reject(new Error(details || error.message));
        return;
      }

      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
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
    location: {
      viewColumn: vscode.ViewColumn.Beside,
    },
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

function getTargetKey() {
  const osName = process.platform;
  const archName = process.arch === "x64" ? "x64" : process.arch;

  if (!["darwin", "linux", "win32"].includes(osName)) {
    throw new Error(`iTE is not available for ${osName}.`);
  }

  if (!["arm64", "x64"].includes(archName)) {
    throw new Error(`iTE is not available for ${osName}-${archName}.`);
  }

  return `${osName}-${archName}`;
}

function requestUrl(url, onResponse, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          "User-Agent": "iTE VS Code",
        },
      },
      (response) => {
        const location = response.headers.location;
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          location &&
          redirects < 5
        ) {
          response.resume();
          resolve(requestUrl(new URL(location, url).toString(), onResponse, redirects + 1));
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Request failed with HTTP ${response.statusCode}: ${url}`));
          return;
        }

        resolve(onResponse(response));
      },
    );

    request.setTimeout(30000, () => {
      request.destroy(new Error(`Request timed out: ${url}`));
    });
    request.on("error", reject);
  });
}

async function downloadJson(url) {
  return requestUrl(
    url,
    (response) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(new Error(`Invalid release manifest: ${error.message}`));
          }
        });
        response.on("error", reject);
      }),
  );
}

async function downloadFile(url, destination, progress) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  return requestUrl(
    url,
    (response) =>
      new Promise((resolve, reject) => {
        const total = Number(response.headers["content-length"] || 0);
        let received = 0;
        let lastReport = 0;
        const output = fs.createWriteStream(destination);

        response.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0 && received - lastReport > 1024 * 1024) {
            lastReport = received;
            progress.report({
              message: `Downloading ${Math.round((received / total) * 100)}%`,
            });
          }
        });

        response.pipe(output);
        output.on("finish", () => output.close(resolve));
        output.on("error", reject);
        response.on("error", reject);
      }),
  );
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
    input.on("error", reject);
  });
}

async function readFirstLine(filePath) {
  try {
    const value = await fsp.readFile(filePath, "utf8");
    return value.split(/\r?\n/, 1)[0].trim();
  } catch {
    return "";
  }
}

async function readManagedInstallMetadata() {
  const stampPath = path.join(getManagedInstallRoot(), ".sha256");
  try {
    const value = await fsp.readFile(stampPath, "utf8");
    const lines = value.split(/\r?\n/);
    const metadata = {
      sha256: lines[0] ? lines[0].trim() : "",
      version: "",
    };

    for (const line of lines.slice(1)) {
      const [key, ...rest] = line.split("=");
      if (key === "version") {
        metadata.version = rest.join("=").trim();
      }
    }

    return metadata;
  } catch {
    return {
      sha256: "",
      version: "",
    };
  }
}

function parseVersion(text) {
  const match = String(text || "").match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match ? match[1] : "";
}

function compareVersions(a, b) {
  const parse = (value) =>
    String(value || "")
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }

  return 0;
}

async function getReleaseForCurrentTarget() {
  const manifest = await downloadJson(RELEASE_MANIFEST_URL);
  const target = getTargetKey();
  const asset = manifest && manifest.assets && manifest.assets[target];
  if (!asset || !asset.url) {
    throw new Error(`No iTE build is available for ${target}.`);
  }

  return {
    manifest,
    target,
    asset,
  };
}

async function findExecutable(root, executableName) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findExecutable(fullPath, executableName);
      if (found) {
        return found;
      }
    } else if (entry.name === executableName) {
      return fullPath;
    }
  }

  return undefined;
}

async function copyDirectoryContents(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source);
  for (const entry of entries) {
    await fsp.cp(path.join(source, entry), path.join(destination, entry), {
      recursive: true,
      force: true,
    });
  }
}

async function installArtifact(archivePath, asset, version) {
  if (asset.archiveType !== "tar.gz") {
    throw new Error(`Unsupported iTE archive type: ${asset.archiveType || "unknown"}`);
  }

  const installRoot = getManagedInstallRoot();
  const appDir = path.join(installRoot, "app");
  const binDir = path.join(installRoot, "bin");
  const binPath = getDefaultInstalledExecutable();
  const stampPath = path.join(installRoot, ".sha256");
  const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ite-install-"));

  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
    const children = await fsp.readdir(extractDir, { withFileTypes: true });
    const extracted = children.find((entry) => entry.isDirectory());
    if (!extracted) {
      throw new Error("iTE archive extraction produced an unexpected layout.");
    }

    await fsp.rm(appDir, { recursive: true, force: true });
    await fsp.mkdir(binDir, { recursive: true });
    await copyDirectoryContents(path.join(extractDir, extracted.name), appDir);

    const executable = await findExecutable(appDir, asset.executable || "ite");
    if (!executable) {
      throw new Error("iTE executable was not found after extraction.");
    }

    await fsp.chmod(executable, 0o755).catch(() => undefined);
    await fsp.rm(binPath, { force: true });
    try {
      const relativeExecutable = path.relative(binDir, executable);
      await fsp.symlink(relativeExecutable, binPath);
    } catch {
      await fsp.copyFile(executable, binPath);
      await fsp.chmod(binPath, 0o755).catch(() => undefined);
    }

    await fsp.writeFile(stampPath, `${asset.sha256 || ""}\nversion=${version || ""}\n`, "utf8");
    return binPath;
  } finally {
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function installManagedRuntime(progress) {
  progress.report({ message: "Checking latest release" });
  const { manifest, target, asset } = await getReleaseForCurrentTarget();

  const installRoot = getManagedInstallRoot();
  const stampPath = path.join(installRoot, ".sha256");
  const binPath = getDefaultInstalledExecutable();
  const existingStamp = await readFirstLine(stampPath);
  if (asset.sha256 && existingStamp === asset.sha256) {
    const existing = await checkExecutable(binPath);
    if (existing.installed) {
      return binPath;
    }
  }

  const archivePath = path.join(
    os.tmpdir(),
    `ite-${manifest.version || "latest"}-${target}.${asset.archiveType === "zip" ? "zip" : "tar.gz"}`,
  );

  try {
    progress.report({ message: `Downloading iTE ${manifest.version || ""}`.trim() });
    await fsp.rm(archivePath, { force: true });
    await downloadFile(asset.url, archivePath, progress);

    if (asset.sha256) {
      progress.report({ message: "Verifying download" });
      const actual = await sha256File(archivePath);
      if (actual !== asset.sha256) {
        throw new Error("Downloaded iTE archive failed checksum verification.");
      }
    }

    progress.report({ message: "Installing iTE" });
    return await installArtifact(archivePath, asset, manifest.version);
  } finally {
    await fsp.rm(archivePath, { force: true }).catch(() => undefined);
  }
}

async function installRuntime() {
  setRuntimeState({
    installed: false,
    source: "installer",
    message: "Installing iTE.",
  });

  const executable = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing iTE",
      cancellable: false,
    },
    installManagedRuntime,
  );

  await fsp.access(executable, fs.constants.X_OK);

  const runtime = {
    installed: true,
    executable,
    message: "Installed iTE.",
    source: "installed",
  };

  setRuntimeState({
    ...runtime,
    source: "installed",
  });

  await createIteTerminal({
    ...runtime,
    source: "installed",
  });
  return undefined;
}

async function getManagedRuntimeUpdate() {
  const configuredExecutable = getSystemExecutable();
  const managedExecutable = getDefaultInstalledExecutable();
  if (configuredExecutable !== "ite" && configuredExecutable !== managedExecutable) {
    return undefined;
  }

  const installed = await checkExecutable(managedExecutable);
  if (!installed.installed) {
    return undefined;
  }

  const { manifest, target, asset } = await getReleaseForCurrentTarget();
  const installedMetadata = await readManagedInstallMetadata();
  const installedVersion = installedMetadata.version || parseVersion(installed.message);
  const latestVersion = manifest.version || "";
  const latestSha = asset.sha256 || "";
  const updateKey = `${target}:${latestVersion}:${latestSha}`;

  if (latestSha && installedMetadata.sha256) {
    if (latestSha === installedMetadata.sha256) {
      return undefined;
    }

    return {
      updateKey,
      installedVersion,
      latestVersion,
      latestSha,
    };
  }

  if (latestVersion && installedVersion && compareVersions(latestVersion, installedVersion) > 0) {
    return {
      updateKey,
      installedVersion,
      latestVersion,
      latestSha,
    };
  }

  return undefined;
}

async function checkRuntimeUpdate(context) {
  if (runtimeUpdateCheckInFlight) {
    return;
  }

  runtimeUpdateCheckInFlight = true;
  try {
    const update = await getManagedRuntimeUpdate();
    if (!update) {
      return;
    }

    if (context.globalState.get(LAST_PROMPTED_UPDATE_KEY) === update.updateKey) {
      return;
    }

    const versionCopy = update.latestVersion
      ? `iTE ${update.latestVersion} is available.`
      : "A newer iTE runtime is available.";
    const action = await vscode.window.showInformationMessage(
      `${versionCopy} Update the VS Code runtime?`,
      "Update iTE",
      "Later",
      "Open Docs",
    );

    if (action === "Update iTE") {
      await installRuntime();
      await context.globalState.update(LAST_PROMPTED_UPDATE_KEY, update.updateKey);
    } else if (action === "Open Docs") {
      await context.globalState.update(LAST_PROMPTED_UPDATE_KEY, update.updateKey);
      await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
    } else if (action === "Later") {
      await context.globalState.update(LAST_PROMPTED_UPDATE_KEY, update.updateKey);
    }
  } finally {
    runtimeUpdateCheckInFlight = false;
  }
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
    "Install iTE to use the AI coding agent in a dedicated VS Code terminal.",
    "Install iTE",
    "Open Docs",
  );

  if (action === "Install iTE") {
    await installRuntime();
  } else if (action === "Open Docs") {
    await vscode.env.openExternal(vscode.Uri.parse("https://ite.kiishi.space/docs"));
  }
}

function isIteTerminalActive() {
  const iteTerminal = vscode.window.terminals.find(
    (t) => t.name === "iTE" && t.status === vscode.TerminalStatus.Running && t.visible,
  );
  return !!iteTerminal;
}

function isIteInstalled() {
  return lastRuntimeState && lastRuntimeState.installed;
}

async function promptResumeSession(context) {
  if (!shouldResumeLastSession()) {
    return;
  }

  if (isIteTerminalActive()) {
    return;
  }

  if (!isIteInstalled()) {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    "Welcome back! Ready to pick up where you left off?",
    "Resume Session",
    "Dismiss",
  );

  if (action === "Resume Session") {
    await openTerminal();
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
  setTimeout(() => {
    void checkRuntimeUpdate(context).catch(() => undefined);
  }, 5000);

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === currentTerminal) {
        currentTerminal = undefined;
      }
    }),
    vscode.window.onDidChangeWindowState((windowState) => {
      if (windowState.focused) {
        void promptResumeSession(context);
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
