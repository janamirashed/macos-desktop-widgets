// Accent color provider -- reads the system display accent color from
// org.gnome.desktop.interface accent-color and provides normalized RGB,
// CSS colors, and Cairo colors for widgets to match the system palette.

import Gio from 'gi://Gio';
import St from 'gi://St';

export const ACCENT_PALETTE = {
    blue:   { rgb: '53, 132, 228', cairo: [0.208, 0.518, 0.894], hex: '#3584e4' },
    teal:   { rgb: '33, 144, 164', cairo: [0.129, 0.565, 0.643], hex: '#2190a4' },
    green:  { rgb: '58, 148, 74',  cairo: [0.227, 0.580, 0.290], hex: '#3a944a' },
    yellow: { rgb: '229, 165, 10', cairo: [0.898, 0.647, 0.039], hex: '#e5a50a' },
    orange: { rgb: '237, 91, 0',   cairo: [0.929, 0.357, 0.000], hex: '#ed5b00' },
    red:    { rgb: '224, 27, 36',  cairo: [0.878, 0.106, 0.141], hex: '#e01b24' },
    pink:   { rgb: '213, 97, 153', cairo: [0.835, 0.380, 0.600], hex: '#d56199' },
    purple: { rgb: '145, 65, 172', cairo: [0.569, 0.255, 0.675], hex: '#9141ac' },
    slate:  { rgb: '111, 131, 150',cairo: [0.435, 0.514, 0.588], hex: '#6f8396' },
    brown:  { rgb: '152, 106, 68', cairo: [0.596, 0.416, 0.267], hex: '#986a44' },
};

export class AccentColorProvider {
    constructor() {
        this._listeners = new Set();
        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._name = this._readName();

        this._changedId = this._ifaceSettings.connect('changed', () => {
            this._name = this._readName();
            this._emit();
        });

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeChangedId = this._themeContext.connect('changed', () => this._emit());
        const source = Gio.SettingsSchemaSource.get_default();
        try {
            const schema = source.lookup('org.gnome.shell.extensions.accent-color', true);
            if (!schema) throw new Error('Optional accent extension is absent');
            this._customSettings = new Gio.Settings({settings_schema: schema});
            this._customChangedId = this._customSettings.connect('changed', () => this._emit());
        } catch (_) {
            this._customSettings = null;
        }
    }

    _readName() {
        if (this._ifaceSettings.settings_schema.has_key('accent-color'))
            return this._ifaceSettings.get_string('accent-color') || 'blue';
        // Ubuntu 24.04 / GNOME 46 exposes Yaru accent variants as GTK themes.
        const theme = this._ifaceSettings.get_string('gtk-theme').toLowerCase();
        return Object.keys(ACCENT_PALETTE).find(name => theme.includes(name)) || 'blue';
    }

    _themeColor() {
        if (this._ifaceSettings.settings_schema.has_key('accent-color')) return null;
        const probe = new St.Widget({style_class: 'button', visible: false});
        try {
            global.stage.add_child(probe);
            const node = probe.get_theme_node();
            for (const name of ['-st-accent-color', 'selected_bg_color']) {
                const [found, c] = node.lookup_color(name, false);
                if (found) return {rgb: `${c.red},${c.green},${c.blue}`,
                    hex: '#' + [c.red, c.green, c.blue].map(v => v.toString(16).padStart(2, '0')).join(''),
                    cairo: [c.red / 255, c.green / 255, c.blue / 255]};
            }
        } catch (_) {
            // Some older themes expose neither named color; use the theme variant.
        } finally { probe.destroy(); }
        return null;
    }

    _getCustomColor() {
        if (!this._customSettings || !(this._customSettings.settings_schema.has_key('enabled') && this._customSettings.get_boolean('enabled'))) {
            return null;
        }
        try {
            const hexColor = this._customSettings.get_string('color') || '#3584e4';
            const intensity = this._customSettings.get_double('intensity');

            let r = 53, g = 132, b = 228;
            if (hexColor && hexColor.startsWith('#') && hexColor.length >= 7) {
                r = parseInt(hexColor.substring(1, 3), 16);
                g = parseInt(hexColor.substring(3, 5), 16);
                b = parseInt(hexColor.substring(5, 7), 16);
            }

            let fr, fg, fb;
            if (intensity <= 1.0) {
                fr = Math.round(r * intensity);
                fg = Math.round(g * intensity);
                fb = Math.round(b * intensity);
            } else {
                const factor = intensity - 1.0;
                fr = Math.round(r + (255 - r) * factor);
                fg = Math.round(g + (255 - g) * factor);
                fb = Math.round(b + (255 - b) * factor);
            }
            fr = Math.min(255, Math.max(0, fr));
            fg = Math.min(255, Math.max(0, fg));
            fb = Math.min(255, Math.max(0, fb));

            const hex = '#' + [fr, fg, fb].map(x => x.toString(16).padStart(2, '0')).join('');
            return {
                rgb: `${fr}, ${fg}, ${fb}`,
                hex,
                cairo: [fr / 255, fg / 255, fb / 255],
            };
        } catch (_) {
            return null;
        }
    }

    get dark() {
        return this._ifaceSettings.get_string('color-scheme') === 'prefer-dark' ||
            (this._ifaceSettings.get_string('color-scheme') === 'default' &&
             /dark/i.test(this._ifaceSettings.get_string('gtk-theme')));
    }

    get name() {
        return this._name;
    }

    get rgb() {
        const custom = this._getCustomColor() || this._themeColor();
        if (custom) return custom.rgb;
        return (ACCENT_PALETTE[this._name] || ACCENT_PALETTE.blue).rgb;
    }

    get hex() {
        const custom = this._getCustomColor() || this._themeColor();
        if (custom) return custom.hex;
        return (ACCENT_PALETTE[this._name] || ACCENT_PALETTE.blue).hex;
    }

    getCairoColor(alpha = 1.0) {
        const custom = this._getCustomColor() || this._themeColor();
        if (custom) return [custom.cairo[0], custom.cairo[1], custom.cairo[2], alpha];
        const c = (ACCENT_PALETTE[this._name] || ACCENT_PALETTE.blue).cairo;
        return [c[0], c[1], c[2], alpha];
    }

    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners) {
            try { fn(this); } catch (e) { logError(e, '[peachos-widgets] accent listener failed'); }
        }
    }

    destroy() {
        if (this._themeChangedId) this._themeContext.disconnect(this._themeChangedId);
        if (this._changedId) {
            this._ifaceSettings.disconnect(this._changedId);
            this._changedId = 0;
        }
        if (this._customChangedId && this._customSettings) {
            this._customSettings.disconnect(this._customChangedId);
            this._customChangedId = 0;
            this._customSettings = null;
        }
        this._listeners.clear();
        this._ifaceSettings = null;
    }
}
