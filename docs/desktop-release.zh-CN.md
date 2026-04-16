# 桌面版 GitHub 发布

这套流程面向当前仓库的低成本桌面分发：

- macOS：GitHub Releases + ad-hoc signing
- Windows：GitHub Releases + NSIS 安装包
- 应用内更新：Tauri updater + `latest.json`

不依赖 Apple Developer Program，也不依赖 Windows 代码签名证书。

## 一次性初始化

先在本地仓库执行：

```bash
npm install
npm run release:setup
```

这一步会完成下面几件事：

- 生成一套 Tauri updater 私钥 / 公钥
- 把公钥写入 `src-tauri/tauri.conf.json`
- 根据 `origin` 远端自动写入 GitHub Releases 更新源地址
- 在 `.local-release/updater/` 生成需要你复制到 GitHub 的 secret 文件

生成后的关键文件：

- `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_B64.txt`
- `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt`
- `.local-release/updater/GITHUB-SECRETS.txt`
- `.local-release/updater/multi-cli-studio.key`

其中 `multi-cli-studio.key` 和密码必须长期保存。丢了以后，后续版本将无法继续给老版本做在线更新。

## GitHub 需要配置什么

打开仓库：

- `Settings -> Secrets and variables -> Actions -> New repository secret`

创建两个 secret：

1. `TAURI_SIGNING_PRIVATE_KEY_B64`
   值直接复制 `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_B64.txt` 全部内容。

2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   值直接复制 `.local-release/updater/TAURI_SIGNING_PRIVATE_KEY_PASSWORD.txt` 全部内容。

注意：

- `TAURI_SIGNING_PRIVATE_KEY_B64` 这个名字虽然带 `B64`，但你不需要自己再做一次 base64。脚本已经给你准备好了能直接粘贴的值。
- 不要把 `.local-release/` 提交到仓库。

然后打开：

- `Settings -> Actions -> General -> Workflow permissions`

把 `GITHUB_TOKEN` 权限改成：

- `Read and write permissions`

否则 workflow 无法创建 release 和上传资产。

## 如何发版

打开：

- `Actions -> Release Desktop -> Run workflow`

填写：

- `version`
  例如 `0.1.1`
- `release_name`
  可留空，默认用 `v0.1.1`
- `release_notes`
  可留空

运行后，workflow 会自动：

- 同步 `package.json` / `Cargo.toml` / `src-tauri/tauri.conf.json` 版本号
- 按当前 GitHub 仓库地址写入 updater feed
- 构建 macOS `aarch64` / `x86_64` 的 DMG 和 updater 包
- 构建 Windows NSIS 安装包
- 生成 `latest.json`
- 创建或更新 `v<version>` 的 GitHub Release
- 上传安装包和更新文件

## 发版前自检

本地可先跑：

```bash
npm run release:check
```

它会检查：

- updater 公钥是否已经写入
- 本地 updater secret 文件是否存在
- updater feed 是否指向当前 GitHub 仓库

## 使用注意

- macOS 首次打开下载的 app 时，用户可能需要去“系统设置 -> 隐私与安全性”里手动点“仍要打开”。
- Windows 可能出现 SmartScreen 提示，这是因为没有购买代码签名证书。
- 如果你把仓库迁移到新的 GitHub 仓库地址，重新执行一次 `npm run release:setup` 即可。
- 如果你重置了 updater 私钥，老版本将无法再接收新版本的在线更新。除非明确接受这个后果，否则不要随便重新生成密钥。
