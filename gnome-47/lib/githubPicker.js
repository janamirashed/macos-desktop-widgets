import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {makeLiquidGlass} from './liquidGlass.js';

import Shell from 'gi://Shell';

const THEMES = [
    ['green',  '#26a641', 'Green'],
    ['red',    '#de2d26', 'Red'],
    ['blue',   '#4292c6', 'Blue'],
    ['orange', '#f16913', 'Orange'],
    ['purple', '#9c27b0', 'Purple'],
    ['pink',   '#e6396f', 'Pink'],
    ['teal',   '#009688', 'Teal'],
    ['yellow', '#d4a000', 'Yellow'],
];
const CENTER = Clutter.ActorAlign.CENTER;

function startInteractiveEyedropper(onPicked, onCancel) {
    const mon = Main.layoutManager.primaryMonitor;
    const screenshot = new Shell.Screenshot();

    // Create a full-screen interactive overlay
    const overlay = new St.Widget({
        reactive: true,
        can_focus: true,
        x: 0,
        y: 0,
        width: global.screen_width || mon.width * 2,
        height: global.screen_height || mon.height * 2,
        style: 'background-color: transparent;',
    });

    // Floating loupe / color indicator badge that follows the mouse
    const loupe = new St.BoxLayout({
        style: 'background-color: rgba(20, 20, 24, 0.94); border: 1px solid rgba(255, 255, 255, 0.28); border-radius: 20px; padding: 6px 12px; spacing: 8px;',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const swatchCircle = new St.Widget({
        width: 18, height: 18,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'border-radius: 9px; background-color: #ffffff; border: 1.5px solid rgba(255,255,255,0.8);',
    });
    loupe.add_child(swatchCircle);

    const hexLabel = new St.Label({
        text: '#......',
        y_align: Clutter.ActorAlign.CENTER,
        style: 'font-family: "SF Pro", monospace; font-size: 13px; font-weight: 700; color: #ffffff;',
    });
    loupe.add_child(hexLabel);

    const hintLabel = new St.Label({
        text: '• Click to pick',
        y_align: Clutter.ActorAlign.CENTER,
        style: 'font-family: "SF Pro"; font-size: 11px; color: rgba(255,255,255,0.6);',
    });
    loupe.add_child(hintLabel);

    overlay.add_child(loupe);
    Main.layoutManager.uiGroup.add_child(overlay);

    let sampling = false;
    let lastHex = '#ffffff';

    const updateColorAt = (x, y) => {
        // Keep loupe near cursor
        const lx = Math.min(mon.width - 220, Math.max(10, x + 20));
        const ly = Math.min(mon.height - 60, Math.max(10, y + 20));
        loupe.set_position(Math.round(lx), Math.round(ly));

        if (sampling) return;
        sampling = true;
        screenshot.pick_color(Math.round(x), Math.round(y), (s, res) => {
            sampling = false;
            try {
                const [ok, color] = s.pick_color_finish(res);
                if (ok && color) {
                    const r = Math.min(255, Math.max(0, color.red)).toString(16).padStart(2, '0');
                    const g = Math.min(255, Math.max(0, color.green)).toString(16).padStart(2, '0');
                    const b = Math.min(255, Math.max(0, color.blue)).toString(16).padStart(2, '0');
                    lastHex = `#${r}${g}${b}`;
                    hexLabel.text = lastHex.toUpperCase();
                    swatchCircle.set_style(`border-radius: 9px; background-color: ${lastHex}; border: 1.5px solid rgba(255,255,255,0.8);`);
                }
            } catch (_err) {
                // ignore transient sample error
            }
        });
    };

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        overlay.destroy();
    };

    overlay.connect('motion-event', (_a, event) => {
        const [x, y] = event.get_coords();
        updateColorAt(x, y);
        return Clutter.EVENT_STOP;
    });

    overlay.connect('button-press-event', (_a, event) => {
        const [x, y] = event.get_coords();
        screenshot.pick_color(Math.round(x), Math.round(y), (s, res) => {
            try {
                const [ok, color] = s.pick_color_finish(res);
                if (ok && color) {
                    const r = Math.min(255, Math.max(0, color.red)).toString(16).padStart(2, '0');
                    const g = Math.min(255, Math.max(0, color.green)).toString(16).padStart(2, '0');
                    const b = Math.min(255, Math.max(0, color.blue)).toString(16).padStart(2, '0');
                    const finalHex = `#${r}${g}${b}`;
                    cleanup();
                    onPicked(finalHex);
                    return;
                }
            } catch (err) {
                logError(err, '[peachos-widgets] pick color finish error');
            }
            cleanup();
            onPicked(lastHex);
        });
        return Clutter.EVENT_STOP;
    });

    overlay.connect('key-press-event', (_a, event) => {
        const sym = event.get_key_symbol();
        if (sym === Clutter.KEY_Escape) {
            cleanup();
            onCancel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        overlay.grab_key_focus();
        return GLib.SOURCE_REMOVE;
    });
}

export const GithubPicker = GObject.registerClass(
class GithubPicker extends Clutter.Actor {
    _init(currentUser, currentTheme, callbacks, options = {}) {
        this._service = options.service || 'GitHub';
        this._lockedUser = !!options.lockedUser;
        super._init({name: 'peachos-github-picker', reactive: true});
        this._callbacks = callbacks;
        this._user = (currentUser && currentUser !== 'torvalds') ? currentUser : '';
        this._theme = currentTheme || 'green';
        this._done = false;

        const mon = Main.layoutManager.primaryMonitor;

        // Scrim backdrop
        this._scrim = new St.Widget({
            reactive: true,
            x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            style: 'background-color: rgba(0,0,0,0.4);',
        });
        this._scrim.connect('button-press-event', () => {
            this._finish();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._scrim);

        const W = 360, H = 340;
        const px = mon.x + Math.round((mon.width - W) / 2);
        const py = mon.y + Math.round((mon.height - H) / 2);

        this._glass = makeLiquidGlass({innerW: W, innerH: H, x: px, y: py, radius: 28, mode: 'dark'});
        this._glass.widget.reactive = true;
        this.add_child(this._glass.widget);

        const wrap = new St.BoxLayout({
            vertical: true,
            style_class: 'peachos-githubpick',
            x_expand: true, y_expand: true,
        });
        this._glass.content.add_child(wrap);

        // Header
        const header = new St.BoxLayout({style_class: 'peachos-githubpick-header'});
        header.add_child(new St.Label({
            text: `${this._service} Activity`,
            style_class: 'peachos-githubpick-title',
            x_expand: true, y_align: CENTER,
        }));
        const done = new St.Button({
            style_class: 'peachos-githubpick-done',
            child: new St.Label({text: 'Done'}),
        });
        done.connect('clicked', () => this._finish());
        header.add_child(done);
        wrap.add_child(header);

        // Subtitle instructions
        const sub = new St.Label({
            text: this._lockedUser ? 'Select your username on the widget to connect your account.' : 'Enter your GitHub username to show your profile heatmap.',
            style: 'font-family: "SF Pro"; font-size: 11px; color: rgba(255,255,255,0.55); margin-bottom: 6px;',
        });
        wrap.add_child(sub);

        // Username Entry
        this._entry = new St.Entry({
            hint_text: 'GitHub username (e.g. janamirashed)…',
            style_class: 'peachos-githubpick-entry',
            text: this._user,
            x_expand: true,
            can_focus: true,
        });
        this._entry.visible = !this._lockedUser;
        this._entry.clutter_text.connect('text-changed', () => {
            this._user = this._entry.get_text().trim();
            this._updateCurrentLabel();
        });
        this._entry.clutter_text.connect('activate', () => this._finish());
        wrap.add_child(this._entry);

        this._currentLabel = new St.Label({
            text: this._user ? `Account: ${this._user}` : 'Tip: you can enter any developer\'s username',
            style_class: 'peachos-githubpick-current',
        });
        wrap.add_child(this._currentLabel);

        // Theme selection section
        wrap.add_child(new St.Label({
            text: 'HEATMAP THEME',
            style_class: 'peachos-githubpick-section',
        }));

        // Preset color swatches
        const themesBox = new St.BoxLayout({
            style_class: 'peachos-githubpick-themes',
            style: 'spacing: 6px; margin-bottom: 8px;',
        });
        this._themeBtns = new Map();
        for (const [key, color] of THEMES) {
            const btn = new St.Button({
                style_class: 'peachos-githubpick-theme',
                style: `background-color: ${color};`,
                can_focus: true, width: 32, height: 32,
            });
            if (key === this._theme) btn.add_style_class_name('selected');
            btn.connect('clicked', () => {
                this._selectTheme(key);
            });
            this._themeBtns.set(key, btn);
            themesBox.add_child(btn);
        }
        wrap.add_child(themesBox);

        // Eyedropper & Custom Color picker row
        const customRow = new St.BoxLayout({
            style: 'spacing: 8px; margin-top: 2px;',
            y_align: CENTER,
        });

        // Eyedropper button
        const eyedropperBtn = new St.Button({
            style: 'padding: 6px 12px; border-radius: 10px; background-color: rgba(255,255,255,0.12); spacing: 6px;',
            can_focus: true,
            y_align: CENTER,
        });
        const eyeBox = new St.BoxLayout({style: 'spacing: 6px;', y_align: CENTER});
        eyeBox.add_child(new St.Icon({
            icon_name: 'color-select-symbolic',
            icon_size: 14,
            style: 'color: #ffffff;',
        }));
        eyeBox.add_child(new St.Label({
            text: 'Eyedropper',
            style: 'font-family: "SF Pro"; font-size: 12px; font-weight: 600; color: #ffffff;',
            y_align: CENTER,
        }));
        eyedropperBtn.set_child(eyeBox);
        eyedropperBtn.connect('clicked', () => {
            this.hide();
            startInteractiveEyedropper(
                hex => {
                    this.show();
                    this._selectCustomColor(hex);
                },
                () => {
                    this.show();
                }
            );
        });
        customRow.add_child(eyedropperBtn);

        // Custom swatch preview
        const initialCustomHex = this._theme.startsWith('#') ? this._theme : '#26a641';
        this._customSwatch = new St.Widget({
            style: `width: 28px; height: 28px; border-radius: 8px; background-color: ${initialCustomHex}; border: 1px solid rgba(255,255,255,0.3);`,
            y_align: CENTER,
        });
        customRow.add_child(this._customSwatch);

        // Hex code text entry
        this._hexEntry = new St.Entry({
            hint_text: '#HEX color',
            style: 'padding: 4px 8px; border-radius: 8px; background-color: rgba(255,255,255,0.1); font-family: "SF Pro"; font-size: 12px; width: 85px;',
            text: this._theme.startsWith('#') ? this._theme : '',
            can_focus: true,
            y_align: CENTER,
        });
        this._hexEntry.clutter_text.connect('text-changed', () => {
            const val = this._hexEntry.get_text().trim();
            if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
                this._selectCustomColor(val, false);
            }
        });
        customRow.add_child(this._hexEntry);

        wrap.add_child(customRow);

        // Auto focus entry
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _selectTheme(key) {
        for (const [k, b] of this._themeBtns)
            b[k === key ? 'add_style_class_name' : 'remove_style_class_name']('selected');
        this._theme = key;
        this._fireChange();
    }

    _selectCustomColor(hex, updateEntry = true) {
        for (const [, b] of this._themeBtns)
            b.remove_style_class_name('selected');
        this._theme = hex;
        this._customSwatch.set_style(`width: 28px; height: 28px; border-radius: 8px; background-color: ${hex}; border: 2px solid rgba(255,255,255,0.9);`);
        if (updateEntry && this._hexEntry.get_text() !== hex) {
            this._hexEntry.set_text(hex);
        }
        this._fireChange();
    }

    _updateCurrentLabel() {
        this._currentLabel.text = this._user ? `Account: ${this._user}` : 'Tip: you can enter any developer\'s username';
    }

    _fireChange() {
        this._callbacks.onChange({user: this._user, theme: this._theme});
    }

    _finish() {
        if (this._done) return;
        this._done = true;
        this._user = this._entry.get_text().trim();
        this._fireChange();
        this._callbacks.onDone();
    }

    destroy() {
        this._glass?.widget?.destroy();
        this._scrim?.destroy();
        super.destroy();
    }
});
