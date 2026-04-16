# Desktop GitHub Release Flow

This repository ships desktop builds with a low-cost GitHub-based pipeline:

- macOS: GitHub Releases + ad-hoc signing
- Windows: GitHub Releases + NSIS installer
- In-app updates: Tauri updater + `latest.json`

No Apple Developer membership or Windows code-signing certificate is required.

## One-time setup

Run this once in the repo:

```bash
npm install
npm run release:setup
```

That command will:

- generate a Tauri updater keypair
- write the updater public key into `src-tauri/tauri.conf.json`
- align the updater feed with the current `origin` GitHub repository
- create local files under `.local-release/updater/` for GitHub secrets

Important generated files:

- `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_B64.txt`
- `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt`
- `.local-release/updater/GITHUB-SECRETS.txt`
- `.local-release/updater/multi-cli-studio.key`

Keep the private key and password permanently. If you lose them, future updates for existing installed clients will stop working.

## GitHub configuration

Open:

- `Settings -> Secrets and variables -> Actions`

Create these repository secrets:

1. `TAURI_SIGNING_PRIVATE_KEY_B64`
   Copy the exact contents of `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_B64.txt`

2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   Copy the exact contents of `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt`

Notes:

- Even though the secret name ends with `B64`, you do not need to base64-encode it again. The generated file is already the exact value expected by the workflow.
- Do not commit `.local-release/`.

Then open:

- `Settings -> Actions -> General -> Workflow permissions`

Set:

- `Read and write permissions`

Without that setting, the workflow cannot create releases or upload assets.

## How to publish

Open:

- `Actions -> Release Desktop -> Run workflow`

Inputs:

- `version`
  Example: `0.1.1`
- `release_name`
  Optional, defaults to `v0.1.1`
- `release_notes`
  Optional

The workflow will automatically:

- sync `package.json`, `Cargo.toml`, and `src-tauri/tauri.conf.json` versions
- align the updater feed with the current GitHub repository
- build macOS `aarch64` and `x86_64` bundles
- build the Windows installer
- generate `latest.json`
- create or update the `v<version>` GitHub Release
- upload installers and updater artifacts

## Preflight

You can validate the local setup before releasing:

```bash
npm run release:check
```

## Caveats

- macOS users may need to allow the app manually in `Privacy & Security` on first launch.
- Windows may show SmartScreen warnings because the installer is unsigned.
- If you move the project to another GitHub repository, rerun `npm run release:setup`.
- If you rotate the updater private key, already-installed versions will no longer trust future updates unless they are rebuilt from the new baseline.
