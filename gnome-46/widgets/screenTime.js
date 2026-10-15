// Screen Time widget — macOS-style with user avatar, hourly bar chart, top apps.
// Uses GNOME's session-active-history.json and application_state for data,
// and SF Pro font throughout.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

const {cairo: Cairo} = imports;

const BAR_COLOR = [0.16, 0.54, 0.98]; // macOS Screen Time blue #298AF2

function fmtDur(s) {
    if (s < 60) return '< 1m';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtShort(s) {
    if (s < 60) return '< 1m';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    return h > 0 ? `${h}h` : `${m}m`;
}

export class ScreenTimeWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;
        this._w = size.w;
        this._h = size.h;
        this._fg = (size.fg || '255,255,255').split(',').map(v => parseInt(v, 10) / 255);
        this._dayOffset = 0; // 0 = today, -1 = yesterday, etc.

        // Main horizontal container
        this._root = new St.BoxLayout({
            width: size.w,
            height: size.h,
        });
        parent.add_child(this._root);

        // Left column (full width for square, 62% for row)
        const chartW = variant === 'row' ? Math.round(size.w * 0.62) : size.w;
        this._leftBox = new St.BoxLayout({
            vertical: true,
            width: chartW,
            height: size.h,
            style: 'padding: 8px 10px 6px 12px;',
        });
        this._root.add_child(this._leftBox);

        // Header with Avatar, Total Duration, Date subtitle, and Navigation Arrows
        this._headerBox = new St.BoxLayout({
            style: 'spacing: 8px; margin-bottom: 2px;',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._leftBox.add_child(this._headerBox);

        // Avatar icon
        this._avatarActor = new St.Widget({
            width: 26,
            height: 26,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerBox.add_child(this._avatarActor);
        this._loadAvatar();

        // Title box (duration + date label)
        const titleBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 0px;',
        });
        this._durLabel = new St.Label({
            text: '0m',
            style: 'font-family: "SF Pro"; font-size: 16px; font-weight: 700; color: #ffffff;',
        });
        this._dateLabel = new St.Label({
            text: 'Today',
            style: 'font-family: "SF Pro"; font-size: 10.5px; font-weight: 500; color: rgba(255,255,255,0.55);',
        });
        titleBox.add_child(this._durLabel);
        titleBox.add_child(this._dateLabel);
        this._headerBox.add_child(titleBox);

        // Navigation arrows (< and >)
        const navBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 2px;',
        });

        this._prevBtn = new St.Button({
            reactive: true,
            can_focus: true,
            track_hover: true,
            style: 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none;',
        });
        this._prevBtn.set_child(new St.Label({
            text: '‹',
            style: 'font-family: "SF Pro"; font-size: 16px; font-weight: 700; color: #ffffff;',
        }));
        this._prevBtn.connect('clicked', () => {
            if (this._dayOffset > -7) {
                this._dayOffset--;
                this._updateView();
            }
        });
        navBox.add_child(this._prevBtn);

        this._nextBtn = new St.Button({
            reactive: false,
            can_focus: true,
            track_hover: true,
            style: 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none; opacity: 0.25;',
        });
        this._nextBtn.set_child(new St.Label({
            text: '›',
            style: 'font-family: "SF Pro"; font-size: 16px; font-weight: 700; color: #ffffff;',
        }));
        this._nextBtn.connect('clicked', () => {
            if (this._dayOffset < 0) {
                this._dayOffset++;
                this._updateView();
            }
        });
        navBox.add_child(this._nextBtn);
        this._headerBox.add_child(navBox);

        // Chart DrawingArea
        this._area = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });
        this._area.connect('repaint', a => this._draw(a));
        this._leftBox.add_child(this._area);

        // Right apps column (row variant only)
        this._appRows = [];
        if (variant === 'row') {
            const sideW = size.w - chartW;
            const m = Math.round(size.h * 0.08);

            this._sideBox = new St.BoxLayout({
                vertical: true,
                width: sideW,
                height: size.h,
                x_expand: true,
                y_expand: true,
                style: `padding-top: ${m}px; padding-bottom: ${m}px; padding-left: 12px; padding-right: ${m}px; border-left: 1px solid rgba(255,255,255,0.08);`,
            });
            this._root.add_child(this._sideBox);
        }

        this._unsub = ctx.screenTime?.subscribe(() => {
            this._updateView();
        });

        this._unsubAccent = ctx.accentColor?.subscribe(() => {
            this._area.queue_repaint();
        });

        this._updateView();
    }

    _loadAvatar() {
        const path = this._ctx.screenTime?.getUserAvatar();
        if (!path) {
            this._avatarActor.style = 'border-radius: 13px; background-color: rgba(255,255,255,0.2);';
            return;
        }
        try {
            const GdkPixbuf = imports.gi.GdkPixbuf;
            const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 52, 52, true);
            if (!pb) return;
            const tmpDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'peachos-widgets']);
            GLib.mkdir_with_parents(tmpDir, 0o755);
            const tmpPng = GLib.build_filenamev([tmpDir, '_avatar_round.png']);
            pb.savev(tmpPng, 'png', [], []);
            this._avatarActor.style = `background-image: url("${tmpPng}"); background-size: cover; border-radius: 13px;`;
        } catch (e) {
            logError(e, '[peachos-widgets] avatar load');
            this._avatarActor.style = 'border-radius: 13px; background-color: rgba(255,255,255,0.2);';
        }
    }

    _updateView() {
        const total = this._ctx.screenTime?.getTotalSeconds(this._dayOffset) ?? 0;
        this._durLabel.text = fmtDur(total);
        this._dateLabel.text = this._ctx.screenTime?.getDateLabel(this._dayOffset) || 'Today';

        const canGoNext = (this._dayOffset < 0);
        this._nextBtn.reactive = canGoNext;
        this._nextBtn.style = canGoNext
            ? 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none; opacity: 0.9;'
            : 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none; opacity: 0.25;';

        const canGoPrev = (this._dayOffset > -7);
        this._prevBtn.reactive = canGoPrev;
        this._prevBtn.style = canGoPrev
            ? 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none; opacity: 0.9;'
            : 'padding: 0 4px; background-color: transparent; border: none; box-shadow: none; opacity: 0.25;';

        this._area.queue_repaint();
        if (this._variant === 'row') this._rebuildAppRows();
    }

    _rebuildAppRows() {
        if (!this._sideBox) return;
        for (const w of this._appRows) w.destroy();
        this._appRows = [];

        const apps = this._ctx.screenTime?.getTopApps(4, this._dayOffset) || [];
        const m = Math.round(this._h * 0.08);
        const availH = this._h - 2 * m;
        const rowH = Math.floor(availH / 4);
        const iconSize = Math.max(18, Math.min(26, Math.round(rowH * 0.72)));
        const iconR = Math.round(iconSize * 0.24);

        for (const app of apps) {
            const row = new St.BoxLayout({
                style: `height: ${rowH}px; spacing: 10px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });

            // App Icon
            let iconActor;
            if (app.gicon) {
                iconActor = new St.Icon({
                    gicon: app.gicon,
                    icon_size: iconSize,
                    style: `border-radius: ${iconR}px;`,
                });
            } else if (app.iconName) {
                iconActor = new St.Icon({
                    icon_name: app.iconName,
                    icon_size: iconSize,
                    style: `border-radius: ${iconR}px;`,
                });
            } else {
                iconActor = new St.Icon({
                    icon_name: 'application-x-executable-symbolic',
                    icon_size: iconSize,
                    style: `border-radius: ${iconR}px;`,
                });
            }
            row.add_child(iconActor);

            // Duration text (SF Pro Medium)
            const durLabel = new St.Label({
                text: fmtShort(app.seconds),
                style: 'font-family: "SF Pro"; font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.85);',
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(durLabel);

            this._sideBox.add_child(row);
            this._appRows.push(row);
        }
    }

    _text(cr, str, x, y, px, rgba, {weight = Pango.Weight.NORMAL, right = false, center = false, maxW = 0} = {}) {
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
        let tx = x;
        if (right) tx = x - lw;
        else if (center) tx = x - Math.round(lw / 2);
        cr.moveTo(tx, y);
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
            const fg = this._fg;
            const dim = a => [fg[0], fg[1], fg[2], a];

            const chartBottom = h - 14; // reserve 14px for X-axis labels
            const chartH = chartBottom - 4;
            this._drawChart(cr, 0, 4, w, chartH, dim);
        } finally { cr.$dispose(); }
    }

    _drawChart(cr, x, y, w, h, dim) {
        const hourlySeconds = this._ctx.screenTime?.getHourlySeconds(this._dayOffset) || new Array(24).fill(0);
        const isToday = (this._dayOffset === 0);
        const curHour = isToday ? new Date().getHours() : 23;

        // Determine max seconds for Y-axis scale
        let maxSec = 1800; // 30m min
        for (let i = 0; i < hourlySeconds.length; i++) {
            if (hourlySeconds[i] > maxSec) maxSec = hourlySeconds[i];
        }
        if (maxSec <= 1800) maxSec = 1800;
        else if (maxSec <= 3600) maxSec = 3600;
        else maxSec = Math.ceil(maxSec / 1800) * 1800;

        const labelW = 24;
        const chartW = w - labelW - 2;
        const fs = 9;

        // Horizontal dashed reference lines (0m, 30m, 60m / 1h)
        const refs = maxSec <= 1800
            ? [{s: 0, l: '0m'}, {s: 900, l: '15m'}, {s: 1800, l: '30m'}]
            : [{s: 0, l: '0m'}, {s: Math.round(maxSec / 2), l: fmtShort(Math.round(maxSec / 2))}, {s: maxSec, l: fmtShort(maxSec)}];

        for (const ref of refs) {
            const ry = y + h - (ref.s / maxSec) * h;
            cr.save();
            cr.setDash([3, 3], 0);
            cr.setLineWidth(0.6);
            cr.setSourceRGBA(...dim(0.12));
            cr.moveTo(x, ry);
            cr.lineTo(x + chartW, ry);
            cr.stroke();
            cr.restore();

            // Right-aligned reference label in SF Pro
            this._text(cr, ref.l, x + chartW + 4, ry - Math.round(fs * 0.5), fs, dim(0.35), {weight: Pango.Weight.REGULAR});
        }

        // 4-Quadrant Vertical guide lines & labels across the full 24-hour day (12 AM, 6 AM, 12 PM, 6 PM)
        const vertHours = [
            {hour: 0, label: this._variant === 'row' ? '12 AM' : '12A'},
            {hour: 6, label: this._variant === 'row' ? '6 AM' : '6A'},
            {hour: 12, label: this._variant === 'row' ? '12 PM' : '12P'},
            {hour: 18, label: this._variant === 'row' ? '6 PM' : '6P'},
        ];

        const barCount = 24;
        const barSlotW = chartW / barCount;
        const barW = Math.max(3, Math.floor(barSlotW * 0.68));

        for (const v of vertHours) {
            const vx = x + Math.round(v.hour * barSlotW + barSlotW / 2);
            cr.save();
            cr.setDash([2, 3], 0);
            cr.setLineWidth(0.5);
            cr.setSourceRGBA(...dim(0.08));
            cr.moveTo(vx, y);
            cr.lineTo(vx, y + h);
            cr.stroke();
            cr.restore();

            // Bottom axis label
            if (v.hour === 0) {
                this._text(cr, v.label, x, y + h + 3, fs, dim(0.42), {weight: Pango.Weight.REGULAR});
            } else {
                this._text(cr, v.label, vx, y + h + 3, fs, dim(0.42), {weight: Pango.Weight.REGULAR, center: true});
            }
        }

        const barColor = this._ctx.accentColor?.getCairoColor(0.92) || [BAR_COLOR[0], BAR_COLOR[1], BAR_COLOR[2], 0.9];
        const hourlyApps = this._ctx.screenTime?.getHourlyApps(this._dayOffset) || [];
        const topOverall = this._ctx.screenTime?.getTopApps(4, this._dayOffset) || [];

        // Generate distinct shades from the accent color
        const [ar, ag, ab] = barColor;
        const shades = [
            [ar, ag, ab, 0.96],
            [Math.min(1, ar * 1.35), Math.min(1, ag * 1.35), Math.min(1, ab * 1.35), 0.78],
            [Math.max(0.1, ar * 0.75), Math.max(0.1, ag * 0.75), Math.max(0.1, ab * 0.75), 0.58],
            [Math.min(1, ar * 1.6), Math.min(1, ag * 1.6), Math.min(1, ab * 1.6), 0.38],
            [Math.max(0.05, ar * 0.5), Math.max(0.05, ag * 0.5), Math.max(0.05, ab * 0.5), 0.22],
        ];

        // Hourly bars with stacked percentage shades per application
        for (let i = 0; i < 24; i++) {
            if (isToday && i > curHour) break;
            const sec = hourlySeconds[i] || 0;
            if (sec <= 0) continue;

            const barH = Math.max(2, Math.round((sec / maxSec) * h));
            const bx = x + Math.round(i * barSlotW + (barSlotW - barW) / 2);
            const by = y + h - barH;
            const pillR = Math.min(Math.round(barW / 2), 2.5);

            // Get app distribution for this hour
            const hourMap = hourlyApps[i] || {};
            let segments = Object.entries(hourMap)
                .filter(([_, s]) => s > 0)
                .sort((a, b) => b[1] - a[1]);

            if (segments.length === 0 && topOverall.length > 0) {
                segments = topOverall.map(a => [a.id, a.seconds]);
            }

            cr.save();
            this._roundRect(cr, bx, by, barW, barH, pillR);
            cr.clip();

            if (segments.length <= 1) {
                cr.setSourceRGBA(...shades[0]);
                cr.rectangle(bx, by, barW, barH);
                cr.fill();
            } else {
                const totalAppSec = segments.reduce((sum, item) => sum + item[1], 0) || 1;
                let stackY = y + h;

                for (let s = 0; s < segments.length; s++) {
                    const isLast = (s === segments.length - 1);
                    const segSec = segments[s][1];
                    const segH = isLast
                        ? Math.max(1, stackY - by)
                        : Math.max(1, Math.round(barH * (segSec / totalAppSec)));
                    const segY = stackY - segH;

                    cr.setSourceRGBA(...shades[s % shades.length]);
                    cr.rectangle(bx, segY, barW, segH);
                    cr.fill();

                    stackY = segY;
                    if (stackY <= by) break;
                }
            }
            cr.restore();
        }
    }

    destroy() {
        this._unsub?.();
        this._unsubAccent?.();
        for (const w of this._appRows) w.destroy();
        this._appRows = [];
        this._root.destroy();
    }
}
