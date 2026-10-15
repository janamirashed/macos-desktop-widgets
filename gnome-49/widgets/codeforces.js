import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {FONT, fontStyle, Pango} from '../lib/fonts.js';

function countdown(seconds) {
    if (seconds < 0) return 'Starting now';
    if (seconds < 3600) return `In ${Math.ceil(seconds / 60)}m`;
    if (seconds < 86400) return `In ${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    return `In ${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}h`;
}

export class CodeforcesWidget {
    constructor(parent, ctx, size, variant) {
        this._provider = ctx.codeforces;
        this._variant = variant;
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';
        this._root = new St.Widget({width: size.w, height: size.h, clip_to_allocation: true, layout_manager: new Clutter.FixedLayout()});
        this._root.set_style(`color: rgb(${size.fg || '255,255,255'});`);
        parent.add_child(this._root);
        this._unsub = this._provider.subscribe(() => this._render());
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 30, () => {
            this._render(); return GLib.SOURCE_CONTINUE;
        });
    }
    setEditing(editing) { this._editing = editing; this._render(); }
    _label(text, x, y, px = 12, opacity = 1, width = this._w - x - 16) {
        const label = new St.Label({text, x, y, width, style: fontStyle(FONT.display, px, opacity, this._fg)});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._root.add_child(label);
        return label;
    }
    _open(url, x, y, w, h, name) {
        const button = new St.Button({x, y, width: w, height: h, can_focus: true,
            reactive: !this._editing, accessible_name: name, style_class: 'peachos-coding-action'});
        button.connect('clicked', () => Gio.AppInfo.launch_default_for_uri(url, null));
        this._root.add_child(button);
    }
    _addRefresh() {
        const refresh = new St.Button({x: this._w - 36, y: 10, width: 24, height: 24,
            can_focus: true, reactive: !this._editing, accessible_name: 'Refresh Codeforces',
            style_class: 'peachos-coding-action', child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 13})});
        refresh.connect('clicked', () => this._provider.refreshNow());
        this._root.add_child(refresh);
    }
    _render() {
        this._root.destroy_all_children();
        const {data, errors, handle} = this._provider;
        this._label(this._variant === 'contests' ? 'CODEFORCES · CONTESTS' : (handle || 'Codeforces'), 16, 14, 11, 0.9, this._w - 65);
        this._addRefresh();
        if (this._variant === 'contests') {
            if (!data.contests) { this._label(errors.contests || 'Loading contests…', 16, 64); return; }
            const upcoming = data.contests.filter(c => c.startTimeSeconds > Date.now() / 1000);
            if (!upcoming.length) this._label('No upcoming contests', 16, 64);
            upcoming.slice(0, 2).forEach((contest, i) => {
                const y = 42 + i * 49;
                this._label(contest.name, 16, y, 12);
                const date = new Date(contest.startTimeSeconds * 1000);
                this._label(`${date.toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'})} · ${Math.round(contest.durationSeconds / 60)}m`, 16, y + 18, 10, 0.8, this._w - 124);
                this._label(countdown(contest.startTimeSeconds - Date.now() / 1000), this._w - 110, y + 18, 10, 1, 94);
                this._open(`https://codeforces.com/contest/${contest.id}`, 14, y, this._w - 28, 43, contest.name);
            });
            if (errors.contests) this._label('Cached · refresh failed', 16, this._h - 25, 10, 0.8);
        } else {
            if (!handle.trim()) { this._label('Set your handle', 16, 64); return; }
            const user = data.user;
            if (!user) { this._label(errors.user || 'Loading rating…', 16, 64); return; }
            this._label(user.rating == null ? 'Unrated' : String(user.rating), 16, 43, 34);
            this._label(user.rank || 'No rated contests yet', 16, 87, 12);
            this._label(`Best ${user.maxRating ?? '—'}`, 16, 112, 11, 0.8);
            const history = data.history;
            const last = history?.at(-1);
            const delta = last ? last.newRating - last.oldRating : null;
            this._label(errors.user || errors.history ? 'Cached · refresh failed' : delta === null ? 'No rating changes' : `Last contest: ${delta >= 0 ? '+' : ''}${delta}`, 16, 137, 10, 0.8);
            this._open(`https://codeforces.com/profile/${encodeURIComponent(handle)}`, 14, 40, this._w - 28, this._h - 50, `Open ${handle} on Codeforces`);
        }
    }
    destroy() { this._unsub?.(); GLib.source_remove(this._timer); this._root.destroy(); }
}
