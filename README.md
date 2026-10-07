# macOS Desktop Widgets

macOS-style desktop widgets for GNOME Shell (versions 45 through 51).

Includes Clock, Weather, Calendar, Reminders, Screen Time, GitHub Heatmap, Photos, and News widgets.

---

## Requirements

- GNOME Shell 45+ (Ubuntu 23.10, 24.04 LTS, 24.10, 25.04+)
- Standard packages: `glib2.0` (`glib-compile-schemas`), `fontconfig` (`fc-cache`)

---

## Installation

Clone the repository and run the installation script:

```bash
git clone https://github.com/janamirashed/macos-desktop-widgets.git
cd macos-desktop-widgets
./install.sh
```

### Next Steps:
- **Wayland**: Log out and log back in (or enable via the Extensions app).
- **X11**: Press `Alt + F2`, type `r`, and press `Enter` to reload GNOME Shell.

---

## Usage

1. Open the **Quick Settings** menu (top right of the top bar).
2. Click **Manage Widgets** to enter edit mode.
3. Drag widgets from the picker onto the desktop.
4. Hover over placed widgets to move or remove them.
5. Press `Esc` or click the desktop background to exit edit mode.

---

## Uninstallation

To remove the extension:

```bash
./uninstall.sh
```

---

## License

GPL-3.0 License.
