import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("Usage: node ./scripts/materialize-tauri-signing-key.mjs <output-path>");
  process.exit(1);
}

const secret = process.env.TAURI_SIGNING_PRIVATE_KEY_B64 ?? "";
if (!secret.trim()) {
  console.error("TAURI_SIGNING_PRIVATE_KEY_B64 is empty.");
  process.exit(1);
}

const normalized = secret.replace(/\r/g, "");
let keyText = "";

if (normalized.includes("untrusted comment:")) {
  // Some UIs or past workflows may store the decoded minisign secret key.
  // Tauri expects the encoded single-line form that `tauri signer generate` writes to disk.
  keyText = Buffer.from(normalized.trimEnd() + "\n", "utf8").toString("base64");
} else {
  const compact = normalized.replace(/\s+/g, "");
  let decoded = "";
  try {
    decoded = Buffer.from(compact, "base64").toString("utf8");
  } catch (error) {
    console.error(`Failed to decode base64 signing key: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (!decoded.includes("untrusted comment:")) {
    console.error("Decoded signing key does not look like a minisign secret key.");
    process.exit(1);
  }
  keyText = compact;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, keyText, "utf8");
console.log(`Wrote Tauri signing key to ${outputPath}`);
