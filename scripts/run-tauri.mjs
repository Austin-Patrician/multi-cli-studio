import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , command, ...extraArgs] = process.argv;

if (!command) {
  console.error("Usage: node ./scripts/run-tauri.mjs <command> [...args]");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const env = {
  ...process.env,
  PATH: withCargoBin(process.env.PATH),
  CARGO_NET_OFFLINE: "false",
};

const child =
  process.platform === "win32"
    ? spawn(resolveWindowsPowerShell(), ["-File", path.join(scriptDir, "run-tauri.ps1"), command, ...extraArgs], {
        cwd: repoRoot,
        stdio: "inherit",
        env,
      })
    : spawn(resolveUnixTauriBinary(scriptDir), [command, ...extraArgs], {
        cwd: repoRoot,
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

function withCargoBin(existingPath = "") {
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  if (!fs.existsSync(cargoBin)) {
    return existingPath;
  }

  return [cargoBin, existingPath].filter(Boolean).join(path.delimiter);
}

function resolveWindowsPowerShell() {
  const candidates = [
    process.env.PWSH_PATH,
    "pwsh",
    "powershell",
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
  ].filter(Boolean);

  const matched = candidates.find((candidate) => {
    if (!candidate) return false;
    if (candidate.includes("\\") || candidate.includes("/")) {
      return fs.existsSync(candidate);
    }
    return true;
  });

  if (!matched) {
    throw new Error("PowerShell was not found. Install PowerShell 7 or Windows PowerShell before running Tauri.");
  }

  return matched;
}

function resolveUnixTauriBinary(baseDir) {
  const tauriBin = path.resolve(baseDir, "..", "node_modules", ".bin", "tauri");
  if (!fs.existsSync(tauriBin)) {
    throw new Error("Local Tauri CLI was not found at node_modules/.bin/tauri. Run npm install first.");
  }
  return tauriBin;
}
