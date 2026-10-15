#!/usr/bin/env bash
set -e

# This distribution intentionally targets GNOME 51 only.
if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "GNOME Shell was not found; no files installed." >&2
    exit 1
fi
WIDGET_GNOME_VERSION="$(gnome-shell --version)"
WIDGET_GNOME_MAJOR="$(printf '%s' "$WIDGET_GNOME_VERSION" | sed -n 's/.* \([0-9][0-9]*\)\..*/\1/p')"
if [ "$WIDGET_GNOME_MAJOR" != "51" ]; then
    echo "This package requires GNOME 51; found $WIDGET_GNOME_VERSION. No files installed." >&2
    exit 1
fi

UUID="peachos-widgets@peachos"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
FONT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Installing macOS Desktop Widgets for GNOME Shell"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Create target directory and copy extension files
echo "==> [1/4] Copying extension files to $EXT_DIR..."
mkdir -p "$EXT_DIR"
cp -r "$SCRIPT_DIR/metadata.json" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/extension.js" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/stylesheet.css" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/lib" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/widgets" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/helpers" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/schemas" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/icons" "$EXT_DIR/"
cp -r "$SCRIPT_DIR/fonts" "$EXT_DIR/"
if [ -d "$SCRIPT_DIR/previews" ]; then
    cp -r "$SCRIPT_DIR/previews" "$EXT_DIR/"
fi

# 2. Compile GSettings schema
echo "==> [2/4] Compiling GSettings schema..."
if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas "$EXT_DIR/schemas/"
else
    echo "Warning: glib-compile-schemas not found in PATH. Using precompiled schema."
fi

# 3. Install bundled typography (SF Pro / Barlow)
echo "==> [3/4] Installing bundled typography fonts..."
mkdir -p "$FONT_DIR"
if [ -d "$SCRIPT_DIR/fonts" ]; then
    cp -f "$SCRIPT_DIR/fonts"/* "$FONT_DIR/" 2>/dev/null || true
    if command -v fc-cache >/dev/null 2>&1; then
        fc-cache -f "$FONT_DIR" >/dev/null 2>&1 || true
    fi
fi

# 4. Enable extension
echo "==> [4/4] Enabling extension ($UUID)..."
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$UUID" 2>/dev/null || true
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo " • On Wayland: Log out and log back in, or toggle via the Extensions app."
echo " • On X11: Press Alt+F2, type 'r', and press Enter to reload GNOME Shell."
echo " • To manage widgets, toggle 'Manage Widgets' in Quick Settings / Control Center."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
