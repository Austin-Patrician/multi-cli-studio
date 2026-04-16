import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const repoArg = args.find((value) => !value.startsWith("--")) ?? null;
const repository = repoArg ?? detectGitHubRepository();

if (!repository) {
  console.error("Could not determine a GitHub repository. Pass one explicitly, for example: node ./scripts/configure-release-feed.mjs owner/repo");
  process.exit(1);
}

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  console.error(`Invalid GitHub repository: ${repository}`);
  process.exit(1);
}

const expectedEndpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));

if (!config.plugins) config.plugins = {};
if (!config.plugins.updater) config.plugins.updater = {};

const currentEndpoints = Array.isArray(config.plugins.updater.endpoints) ? config.plugins.updater.endpoints : [];
const isAlreadyConfigured = currentEndpoints.length === 1 && currentEndpoints[0] === expectedEndpoint;

if (checkOnly) {
  if (!isAlreadyConfigured) {
    console.error(`Release feed mismatch.\nExpected: ${expectedEndpoint}\nActual: ${currentEndpoints.join(", ") || "(empty)"}`);
    process.exit(1);
  }
  console.log(`Release feed is aligned with ${repository}.`);
  process.exit(0);
}

config.plugins.updater.endpoints = [expectedEndpoint];
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Configured Tauri updater feed for ${repository}.`);

function detectGitHubRepository() {
  try {
    const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseGitHubRepository(remoteUrl);
  } catch {
    return null;
  }
}

function parseGitHubRepository(value) {
  const match = value.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}
