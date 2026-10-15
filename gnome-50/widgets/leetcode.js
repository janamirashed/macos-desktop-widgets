import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {getThemeColors} from '../lib/providers/github.js';
import {WidgetDrawing} from '../lib/widgetDrawing.js';
import {dailyStatus, utcDay} from '../lib/activity.js';

export class LeetCodeWidget extends WidgetDrawing {
    constructor(parent, ctx, size) {
        super();
        this._provider = ctx.leetcode;
        this._w = size.w;
        this._h = size.h;
        this._fg = (size.fg || '255,255,255').split(',').map(v => Number(v) / 255);
        this._theme = size.leetcodeTheme || 'green';
        this._root = new St.Widget({width: size.w, height: size.h, clip_to_allocation: true, layout_manager: new Clutter.FixedLayout()});
        this._root.set_style(`color: rgb(${size.fg || '255,255,255'});`);
        parent.add_child(this._root);
        this._area = new St.DrawingArea({width: size.w, height: size.h});
        this._area.connect('repaint', area => this._draw(area));
        this._root.add_child(this._area);
        this._buttons = [];
        this._button('Connect or reconnect LeetCode', 12, 8, size.w - 45, 24,
            () => this._provider.connectAccount());
        this._button('Refresh LeetCode', size.w - 34, 8, 24, 24,
            () => this._provider.refreshNow(), 'view-refresh-symbolic');
        this._button('Open today’s LeetCode challenge', 12, size.h - 52, size.w - 24, 42, () => {
            const link = this._provider.data?.daily?.link;
            if (link?.startsWith('/problems/'))
                Gio.AppInfo.launch_default_for_uri(`https://leetcode.com${link}`, null);
            else this._provider.connectAccount();
        });
        this._unsub = this._provider.subscribe(() => this._area.queue_repaint());
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30, () => {
            this._area.queue_repaint(); return GLib.SOURCE_CONTINUE;
        });
    }
    _button(name, x, y, width, height, action, icon = null) {
        const button = new St.Button({x, y, width, height, can_focus: true,
            accessible_name: name, style_class: 'peachos-coding-action'});
        if (icon) button.set_child(new St.Icon({icon_name: icon, icon_size: 13}));
        button.connect('clicked', action);
        this._root.add_child(button);
        this._buttons.push(button);
    }
    setEditing(editing) { for (const b of this._buttons) b.reactive = !editing; }
    setTheme(theme) { this._theme = theme; this._area.queue_repaint(); }
    _draw(area) {
        const cr = area.get_context();
        try {
            const w = this._w, h = this._h, m = 15;
            const data = this._provider.data;
            const ink = alpha => [...this._fg, alpha];
            const fs = 11;
            const streak = data?.connected && Number.isInteger(data.streak) ? `${data.streak}d streak` : '— streak';
            const wide = w > 200;
            this._text(cr, (this._provider.username || 'LeetCode'), m, 14, fs, ink(1), {maxW: wide ? w - 170 : 60});
            this._text(cr, streak, w - 39, 14, wide ? fs : 9, ink(0.85), {right: true});
            const colors = getThemeColors(this._theme);
            const step = 11, gap = 3, rows = 7;
            const columns = Math.floor((w - 2 * m + gap) / step);
            const today = new Date(`${utcDay()}T00:00:00Z`);
            const start = new Date(today);
            start.setUTCDate(start.getUTCDate() - start.getUTCDay() - (columns - 1) * 7);
            for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) {
                const day = new Date(start); day.setUTCDate(day.getUTCDate() + c * 7 + r);
                if (day > today) continue;
                const count = Number(data?.calendar?.[String(day.getTime() / 1000)] || 0);
                const level = count > 0 ? Math.min(4, Math.ceil(Math.log2(count + 1))) : 0;
                if (level) cr.setSourceRGBA(...colors[level], 1);
                else cr.setSourceRGBA(...this._fg, 0.12);
                this._roundRect(cr, m + c * step, 41 + r * step, step - gap, step - gap, 2);
                cr.fill();
            }
            const state = dailyStatus(data?.daily, data?.connected && !this._provider.error, data?.fetchedDay);
            let label = state === 'solved' ? '✓ Daily solved' : state === 'pending' ? '○ Daily not solved' : 'Daily status unknown';
            if (!data) label = this._provider.error?.startsWith('Connect') ? 'Connect LeetCode' : this._provider.error || 'Configure LeetCode';
            else if (this._provider.error) label = /Reconnect/.test(this._provider.error) ? 'Reconnect LeetCode' : 'Offline · status unknown';
            this._text(cr, label, m, h - 48, 11, ink(1), {maxW: w - 2 * m});
            const daily = data?.daily;
            const detail = daily ? `${daily.question.difficulty} · ${daily.question.title}` : 'Select your username to connect';
            this._text(cr, detail, m, h - 28, 10, ink(0.8), {maxW: w - 2 * m});
        } finally { cr.$dispose(); }
    }
    destroy() {
        this._unsub?.();
        GLib.source_remove(this._timer);
        this._root.destroy();
    }
}
