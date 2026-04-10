import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const versionArg = args.find((value) => value !== "--check") ?? null;

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageVersion = packageJson.version;
const targetVersion = versionArg ?? packageVersion;

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  console.error(`Invalid version: ${targetVersion}`);
  process.exit(1);
}

const cargoTomlRaw = fs.readFileSync(cargoTomlPath, "utf8");
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));

const cargoVersionMatch = cargoTomlRaw.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoVersionMatch) {
  console.error("Could not find version in src-tauri/Cargo.toml");
  process.exit(1);
}

const currentVersions = {
  package: packageVersion,
  cargo: cargoVersionMatch[1],
  tauri: String(tauriConfig.version ?? ""),
};

if (checkOnly) {
  const mismatches = Object.entries(currentVersions).filter(([, value]) => value !== targetVersion);
  if (mismatches.length > 0) {
    console.error(`Version mismatch. Expected ${targetVersion}.`);
    for (const [source, value] of mismatches) {
      console.error(`- ${source}: ${value}`);
    }
    process.exit(1);
  }
  console.log(`Versions are aligned at ${targetVersion}.`);
  process.exit(0);
}

packageJson.version = targetVersion;
const nextCargoToml = cargoTomlRaw.replace(
  /^version\s*=\s*"([^"]+)"/m,
  `version = "${targetVersion}"`
);
tauriConfig.version = targetVersion;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
fs.writeFileSync(cargoTomlPath, nextCargoToml, "utf8");
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8");

console.log(`Synchronized package.json, src-tauri/Cargo.toml, and src-tauri/tauri.conf.json to ${targetVersion}.`);
