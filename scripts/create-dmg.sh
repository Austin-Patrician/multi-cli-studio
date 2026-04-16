#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?Usage: $0 <app_path> <output_dmg_path> [volume_name]}"
OUTPUT_DMG="${2:?Usage: $0 <app_path> <output_dmg_path> [volume_name]}"
VOLUME_NAME="${3:-Multi CLI Studio Installer}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BG_IMAGE="${ROOT_DIR}/src-tauri/icons/dmg-background.png"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: app bundle not found at $APP_PATH"
  exit 1
fi

OUTPUT_DIR="$(dirname "$OUTPUT_DMG")"
mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DMG"

TEMP_DMG=""
STAGE_DIR=""
MOUNT_DIR=""
DEVICE_NODE=""

cleanup() {
  if [[ -n "$MOUNT_DIR" ]]; then
    hdiutil detach "${DEVICE_NODE:-$MOUNT_DIR}" -quiet 2>/dev/null || \
      hdiutil detach "${DEVICE_NODE:-$MOUNT_DIR}" -force -quiet 2>/dev/null || true
  fi
  [[ -n "$TEMP_DMG" && -f "$TEMP_DMG" ]] && rm -f "$TEMP_DMG" || true
  [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" ]] && rm -rf "$STAGE_DIR" || true
}
trap cleanup EXIT

copy_app_bundle() {
  local src="$1"
  local dst="$2"

  rm -rf "$dst"
  if command -v ditto >/dev/null 2>&1; then
    ditto --noextattr --noqtn --noacl --nopreserveHFSCompression "$src" "$dst"
    return 0
  fi
  cp -R "$src" "$dst"
}

create_applications_alias() {
  local target_dir="$1"
  local target_path="$target_dir/Applications"

  rm -rf "$target_path"
  osascript <<APPLESCRIPT >/dev/null 2>&1 || ln -s /Applications "$target_path"
tell application "Finder"
  make alias file to POSIX file "/Applications" at POSIX file "$target_dir"
end tell
APPLESCRIPT
}

APP_SIZE_KB=$(du -sk "$APP_PATH" | cut -f1)
DMG_SIZE_KB=$((APP_SIZE_KB + 20480))

STAGE_DIR="$(mktemp -d /tmp/multi-cli-studio-dmg-stage-XXXXXX)"
copy_app_bundle "$APP_PATH" "$STAGE_DIR/Multi CLI Studio.app"
create_applications_alias "$STAGE_DIR"

if [[ -f "$BG_IMAGE" ]]; then
  mkdir -p "$STAGE_DIR/.background"
  cp "$BG_IMAGE" "$STAGE_DIR/.background/background.png"
fi

TEMP_DMG="$(mktemp /tmp/multi-cli-studio-dmg-XXXXXX).dmg"
rm -f "$TEMP_DMG"

hdiutil create \
  -volname "$VOLUME_NAME" \
  -ov \
  -size "${DMG_SIZE_KB}k" \
  -fs HFS+ \
  -format UDRW \
  -srcfolder "$STAGE_DIR" \
  "$TEMP_DMG"

MOUNT_OUTPUT=$(hdiutil attach -readwrite -noverify -nobrowse "$TEMP_DMG")
MOUNT_DIR=$(printf '%s\n' "$MOUNT_OUTPUT" | awk -F'\t' '/\/Volumes\// { print $NF; exit }')
DEVICE_NODE=$(printf '%s\n' "$MOUNT_OUTPUT" | awk '/^\/dev\/disk/ { print $1; exit }')

if [[ -z "$MOUNT_DIR" ]]; then
  echo "Error: failed to mount writable dmg"
  exit 1
fi

mdutil -i off "$MOUNT_DIR" >/dev/null 2>&1 || true
mdutil -d "$MOUNT_DIR" >/dev/null 2>&1 || true

DISK_NAME="$(basename "$MOUNT_DIR")"
if [[ -f "$BG_IMAGE" ]]; then
  osascript <<APPLESCRIPT >/dev/null 2>&1 || true
tell application "Finder"
  tell disk "$DISK_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, 760, 500}

    set theViewOptions to the icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 80
    set text size of theViewOptions to 12
    set background picture of theViewOptions to file ".background:background.png"

    set position of item "Multi CLI Studio.app" of container window to {180, 170}
    set position of item "Applications" of container window to {480, 170}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
APPLESCRIPT
fi

osascript -e 'tell application "Finder" to close every window' >/dev/null 2>&1 || true
chmod -Rf go-w "$MOUNT_DIR" >/dev/null 2>&1 || true
sync

hdiutil detach "${DEVICE_NODE:-$MOUNT_DIR}" >/dev/null 2>&1 || \
  hdiutil detach "${DEVICE_NODE:-$MOUNT_DIR}" -force >/dev/null 2>&1 || true
MOUNT_DIR=""

hdiutil convert "$TEMP_DMG" -format UDZO -o "$OUTPUT_DMG" >/dev/null
rm -f "$TEMP_DMG"
TEMP_DMG=""

echo "DMG created: $OUTPUT_DMG"
