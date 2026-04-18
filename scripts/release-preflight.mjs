import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const localReleaseDir = path.join(repoRoot, ".local-release", "updater");
const privateKeyPath = path.join(localReleaseDir, "multi-cli-studio.key");
const privateKeySecretPath = path.join(localReleaseDir, "TAURI_SIGNING_PRIVATE_KEY_B64.txt");
const passwordPath = path.join(localReleaseDir, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt");

const UPDATER_PUBKEY_PLACEHOLDER = "TAURI_UPDATER_PUBKEY_PLACEHOLDER";

const args = process.argv.slice(2);
const requireSecrets = args.includes("--require-secrets");
const repoFlagIndex = args.indexOf("--github-repo");
const repository =
  repoFlagIndex >= 0 && args[repoFlagIndex + 1]
    ? args[repoFlagIndex + 1]
    : detectGitHubRepository();

const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
const updater = config.plugins?.updater ?? {};
const endpoint = Array.isArray(updater.endpoints) ? updater.endpoints[0] ?? "" : "";
const pubkey = typeof updater.pubkey === "string" ? updater.pubkey.trim() : "";
const issues = [];
const notes = [];

if (!pubkey || pubkey === UPDATER_PUBKEY_PLACEHOLDER) {
  issues.push("Tauri updater public key is still a placeholder. Run `npm run release:setup` first.");
}

if (!endpoint) {
  issues.push("Tauri updater endpoint is empty.");
} else if (repository) {
  const expectedEndpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
  if (endpoint !== expectedEndpoint) {
    issues.push(`Tauri updater endpoint does not match the GitHub repository.\nExpected: ${expectedEndpoint}\nActual: ${endpoint}`);
  }
}

if (!fs.existsSync(privateKeyPath) || !fs.existsSync(privateKeySecretPath) || !fs.existsSync(passwordPath)) {
  notes.push("Local updater secret files are missing. You can recreate them with `npm run release:setup`.");
}

if (requireSecrets) {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY_B64?.trim()) {
    issues.push("GitHub secret `TAURI_SIGNING_PRIVATE_KEY_B64` is missing.");
  } else if (!isRecognizedSecretKey(process.env.TAURI_SIGNING_PRIVATE_KEY_B64)) {
    issues.push("GitHub secret `TAURI_SIGNING_PRIVATE_KEY_B64` is not a valid Tauri updater secret key.");
  }
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD?.trim()) {
    issues.push("GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is missing.");
  }
}

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`ERROR: ${issue}`);
  }
  for (const note of notes) {
    console.error(`NOTE: ${note}`);
  }
  process.exit(1);
}

console.log("Desktop release preflight passed.");
console.log(`- Feed: ${endpoint}`);
if (repository) {
  console.log(`- Repository: ${repository}`);
}
if (fs.existsSync(privateKeySecretPath) && fs.existsSync(passwordPath)) {
  console.log(`- Local secret file: ${path.relative(repoRoot, privateKeySecretPath)}`);
  console.log(`- Local password file: ${path.relative(repoRoot, passwordPath)}`);
}

function detectGitHubRepository() {
  try {
    const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isRecognizedSecretKey(value) {
  const normalized = value.replace(/\r/g, "").trim();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("untrusted comment:")) {
    return true;
  }
  const compact = normalized.replace(/\s+/g, "");
  try {
    const decoded = Buffer.from(compact, "base64").toString("utf8");
    return decoded.includes("untrusted comment:");
  } catch {
    return false;
  }
}
