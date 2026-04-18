import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const localReleaseDir = path.join(repoRoot, ".local-release", "updater");
const privateKeyPath = path.join(localReleaseDir, "multi-cli-studio.key");
const publicKeyPath = `${privateKeyPath}.pub`;
const privateKeySecretPath = path.join(localReleaseDir, "TAURI_SIGNING_PRIVATE_KEY_B64.txt");
const passwordPath = path.join(localReleaseDir, "TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt");
const publicKeyValuePath = path.join(localReleaseDir, "TAURI_UPDATER_PUBKEY.txt");
const summaryPath = path.join(localReleaseDir, "GITHUB-SECRETS.txt");

const args = process.argv.slice(2);
const force = args.includes("--force");
const repository = detectGitHubRepository();

fs.mkdirSync(localReleaseDir, { recursive: true });

if (force) {
  for (const filePath of [privateKeyPath, publicKeyPath, privateKeySecretPath, passwordPath, publicKeyValuePath, summaryPath]) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath) || !fs.existsSync(passwordPath)) {
  const password = createPassword();
  fs.writeFileSync(passwordPath, `${password}\n`, "utf8");

  const result = spawnSync(resolveTauriBinary(), signerGenerateArgs(password), {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const privateKey = fs.readFileSync(privateKeyPath, "utf8").trim();
const publicKey = fs.readFileSync(publicKeyPath, "utf8").trim();
const privateKeySecret = privateKey;

fs.writeFileSync(privateKeySecretPath, `${privateKeySecret}\n`, "utf8");
fs.writeFileSync(publicKeyValuePath, `${publicKey}\n`, "utf8");
writeGitHubSecretsSummary(privateKeySecret, fs.readFileSync(passwordPath, "utf8").trim());
updateTauriConfig(publicKey, repository);

console.log("Desktop release setup is ready.");
console.log(`- Private key: ${path.relative(repoRoot, privateKeyPath)}`);
console.log(`- GitHub secret value: ${path.relative(repoRoot, privateKeySecretPath)}`);
console.log(`- GitHub secret password: ${path.relative(repoRoot, passwordPath)}`);
console.log(`- Public key written to: ${path.relative(repoRoot, tauriConfigPath)}`);
if (repository) {
  console.log(`- Release feed aligned to: ${repository}`);
}
console.log(`- Helper summary: ${path.relative(repoRoot, summaryPath)}`);

function resolveTauriBinary() {
  const binaryName = process.platform === "win32" ? "tauri.cmd" : "tauri";
  const binaryPath = path.join(repoRoot, "node_modules", ".bin", binaryName);
  if (!fs.existsSync(binaryPath)) {
    console.error("Local Tauri CLI was not found. Run `npm install` first.");
    process.exit(1);
  }
  return binaryPath;
}

function signerGenerateArgs(password) {
  const args = ["signer", "generate", "--ci", "-w", privateKeyPath, "-p", password];
  if (force) {
    args.push("-f");
  }
  return args;
}

function createPassword() {
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "A")
    .replace(/\//g, "B")
    .replace(/=/g, "C");
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

function updateTauriConfig(publicKey, repositoryName) {
  const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.updater) config.plugins.updater = {};
  config.plugins.updater.pubkey = publicKey;
  if (repositoryName) {
    config.plugins.updater.endpoints = [
      `https://github.com/${repositoryName}/releases/latest/download/latest.json`,
    ];
  }
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function writeGitHubSecretsSummary(privateKeyBase64, password) {
  const lines = [
    "GitHub repository secrets to create:",
    "",
    "TAURI_SIGNING_PRIVATE_KEY_B64",
    privateKeyBase64,
    "",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    password,
    "",
    "Repository Actions setting:",
    "Settings -> Actions -> General -> Workflow permissions -> Read and write permissions",
    "",
    "After adding the two secrets above, run the workflow:",
    "Actions -> Release Desktop -> Run workflow",
  ];
  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}
