import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Rsvg from 'gi://Rsvg';
import St from 'gi://St';

import {GITHUB_DEFAULTS, GITHUB_THEMES, getThemeColors} from '../lib/providers/github.js';

let _githubIconHandle = null;
function _getGithubIconHandle() {
    if (!_githubIconHandle) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>';
        _githubIconHandle = Rsvg.Handle.new_from_data(new TextEncoder().encode(svg));
    }
    return _githubIconHandle;
}

const {cairo: Cairo} = imports;

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substring(0,2),16)/255, parseInt(h.substring(2,4),16)/255, parseInt(h.substring(4,6),16)/255];
}

export class GitHubWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;
        this._w = size.w;
        this._h = size.h;
        this._fg = (size.fg || '255,255,255').split(',').map(v => parseInt(v, 10) / 255);
        this._theme = size.githubTheme || 'green';
        this._username = (size.githubUser && size.githubUser !== 'torvalds')
            ? size.githubUser
            : GITHUB_DEFAULTS[variant === 'row' ? 'row' : 'square'];

        this._root = new St.Widget({layout_manager: new Clutter.BinLayout(), width: size.w, height: size.h});
        parent.add_child(this._root);
        this._area = new St.DrawingArea({x_expand: true, y_expand: true});
        this._area.connect('repaint', a => this._draw(a));
        this._root.add_child(this._area);

        this._unsub = ctx.github?.subscribe(() => this._area.queue_repaint());
        this._unwatch = ctx.github?.watch([this._username]);
    }

    setGithubUser(user) {
        if (user === this._username) return;
        this._unwatch?.();
        this._username = user || GITHUB_DEFAULTS[this._variant === 'row' ? 'row' : 'square'];
        this._unwatch = this._ctx.github?.watch([this._username]);
        this._area.queue_repaint();
    }

    setGithubTheme(theme) { this._theme = theme || 'green'; this._area.queue_repaint(); }

    _text(cr, str, x, y, px, rgba, {weight = Pango.Weight.NORMAL, right = false, maxW = 0} = {}) {
        const layout = PangoCairo.create_layout(cr);
        const desc = Pango.FontDescription.from_string('SF Pro');
        desc.set_absolute_size(Math.max(1, Math.round(px)) * Pango.SCALE);
        desc.set_weight(weight);
        layout.set_font_description(desc);

        if (maxW) {
            layout.set_width(Math.round(maxW) * Pango.SCALE);
            layout.set_ellipsize(Pango.EllipsizeMode.END);
        }
        layout.set_text(str ?? '', -1);
        const [lw, lh] = layout.get_pixel_size();
        cr.setSourceRGBA(...rgba);
        cr.moveTo(right ? x - lw : x, y);
        PangoCairo.show_layout(cr, layout);
        return {w: lw, h: lh};
    }

    _roundRect(cr, x, y, w, h, r) {
        cr.newSubPath();
        cr.arc(x+w-r, y+r, r, -Math.PI/2, 0);
        cr.arc(x+w-r, y+h-r, r, 0, Math.PI/2);
        cr.arc(x+r, y+h-r, r, Math.PI/2, Math.PI);
        cr.arc(x+r, y+r, r, Math.PI, 3*Math.PI/2);
        cr.closePath();
    }

    _draw(area) {
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;
        const cr = area.get_context();
        try {
            const data = this._ctx.github?.get(this._username);
            const fg = this._fg;
            const dim = a => [fg[0], fg[1], fg[2], a];
            const m = Math.round(h * 0.09);
            const themeColors = getThemeColors(this._theme);
            const fs = Math.max(9, Math.round(h * 0.075));

            // GitHub mark SVG icon
            const iconSize = Math.max(12, Math.round(fs * 1.18));
            const iconY = m + Math.round((fs - iconSize) / 2);
            cr.save();
            cr.translate(m, iconY);
            cr.scale(iconSize / 24, iconSize / 24);
            _getGithubIconHandle().render_cairo(cr);
            cr.restore();

            // Username (SF Pro Semibold)
            const textX = m + iconSize + Math.round(fs * 0.45);
            const availableTextW = (this._variant === 'row' && data)
                ? Math.max(40, w - textX - m - 140)
                : (w - textX - m);
            this._text(cr, this._username.toUpperCase(), textX, m, fs, dim(0.9), {
                weight: Pango.Weight.SEMIBOLD,
                maxW: availableTextW,
            });

            // Total contributions count (row variant: top right)
            if (this._variant === 'row' && data) {
                const countStr = `${data.total.toLocaleString('en-US')} CONTRIBUTIONS`;
                this._text(cr, countStr, w - m, m, fs * 0.85, dim(0.5), {
                    weight: Pango.Weight.MEDIUM,
                    right: true,
                });
            }

            // Heatmap grid (7 rows, representing days of the week)
            const gridTop = m + Math.round(fs * 1.6);
            const gridBottom = h - m - Math.round(fs * 1.4);
            const rows = 7, gap = 2.5;
            const cellSize = Math.max(3, Math.floor((gridBottom - gridTop - (rows - 1) * gap) / rows));
            const cellStep = cellSize + gap;
            const maxWeeks = Math.floor((w - 2 * m + gap) / cellStep);

            if (data?.weeks?.length) {
                const weeks = data.weeks.slice(-maxWeeks);
                const gridRight = w - m;
                const gridLeft = gridRight - weeks.length * cellStep + gap;
                for (let wk = 0; wk < weeks.length; wk++) {
                    for (const day of weeks[wk]) {
                        const dow = new Date(day.date + 'T00:00:00').getDay();
                        const lvl = Math.min(4, Math.max(0, day.level || 0));
                        if (lvl === 0) {
                            // Translucent soft glass dot (no harsh black box)
                            cr.setSourceRGBA(1, 1, 1, 0.09);
                        } else {
                            const col = themeColors[lvl];
                            cr.setSourceRGBA(col[0], col[1], col[2], 0.95);
                        }
                        this._roundRect(cr, gridLeft + wk * cellStep, gridTop + dow * cellStep, cellSize, cellSize, 2.5);
                        cr.fill();
                    }
                }
            } else {
                // Empty grid placeholder while loading
                for (let wk = 0; wk < maxWeeks; wk++) {
                    for (let d = 0; d < rows; d++) {
                        cr.setSourceRGBA(1, 1, 1, 0.08);
                        this._roundRect(cr, m + wk * cellStep, gridTop + d * cellStep, cellSize, cellSize, 2.5);
                        cr.fill();
                    }
                }
            }

            // Bottom label: "Contributions" in SF Pro Regular
            const bLabel = 'Contributions';
            const bFs = fs * 0.85;
            const lLayout = PangoCairo.create_layout(cr);
            const bDesc = Pango.FontDescription.from_string('SF Pro');
            bDesc.set_absolute_size(Math.max(1, Math.round(bFs)) * Pango.SCALE);
            lLayout.set_font_description(bDesc);
            lLayout.set_text(bLabel, -1);
            const [bW] = lLayout.get_pixel_size();
            cr.setSourceRGBA(...dim(0.45));
            cr.moveTo(Math.round((w - bW) / 2), h - m - Math.round(bFs * 0.95));
            PangoCairo.show_layout(cr, lLayout);
        } finally { cr.$dispose(); }
    }

    destroy() { this._unsub?.(); this._unwatch?.(); this._root.destroy(); }
}
