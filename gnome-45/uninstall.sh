#!/usr/bin/env bash
set -e

UUID="peachos-widgets@peachos"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

echo "Uninstalling macOS Desktop Widgets..."
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

rm -rf "$EXT_DIR"
echo "✓ Removed $EXT_DIR."
echo "Please restart GNOME Shell or log out to complete uninstallation."
