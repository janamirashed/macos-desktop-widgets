// GNOME 46-compatible local tracking. No dependency on GNOME 48 Wellbeing files.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {localDay, recordInterval} from '../activity.js';

const IDLE_MS = 5 * 60 * 1000;

export class ScreenTimeProvider {
    constructor() {
        this._listeners = new Set();
        this._days = {};
        this._path = GLib.build_filenamev([GLib.get_user_data_dir(), 'peachos-widgets', 'usage-v2.json']);
        this._idle = global.backend.get_core_idle_monitor();
        this._lastWall = Date.now();
        this._lastMono = GLib.get_monotonic_time();
        this._lastSave = this._lastWall;
        try {
            const [, bytes] = GLib.file_get_contents(this._path);
            const saved = JSON.parse(new TextDecoder().decode(bytes));
            if (saved.version === 2 && saved.days && typeof saved.days === 'object')
                this._days = saved.days;
        } catch (_) { /* No measured history yet. Never synthesize usage. */ }
        this._appId = this._focusedApp();
        this._wasActive = this._isActive();
        this._focusId = global.display.connect('notify::focus-window', () => {
            this._tick();
            this._appId = this._focusedApp();
        });
        this._modeId = Main.sessionMode.connect('updated', () => {
            this._tick();
            this._wasActive = this._isActive();
            this._persist();
        });
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _isActive() {
        return !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter &&
            this._idle.get_idletime() < IDLE_MS;
    }

    _focusedApp() {
        const win = global.display.focus_window;
        return win ? Shell.WindowTracker.get_default().get_window_app(win)?.get_id() ?? null : null;
    }

    _tick() {
        const wall = Date.now();
        const mono = GLib.get_monotonic_time();
        const seconds = (mono - this._lastMono) / 1e6;
        const active = this._isActive();
        // A long scheduler gap, suspend, clock jump or a locked session is not usage.
        if (this._wasActive && active && seconds > 0 && seconds < 15 &&
            Math.abs((wall - this._lastWall) / 1000 - seconds) < 2)
            recordInterval(this._days, wall - seconds * 1000, wall, this._appId);
        this._lastWall = wall;
        this._lastMono = mono;
        this._wasActive = active;
        this._appId = this._focusedApp();
        if (wall - this._lastSave > 60000) this._persist();
        for (const fn of this._listeners) fn();
    }

    _day(offset = 0) {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        return this._days[localDay(date)];
    }
    subscribe(fn) { this._listeners.add(fn); fn(); return () => this._listeners.delete(fn); }
    getTotalSeconds(offset = 0) { return Math.round(this._day(offset)?.total || 0); }
    getHourlySeconds(offset = 0) { return this._day(offset)?.hourly || Array(24).fill(0); }
    getHourlyApps(offset = 0) { return this._day(offset)?.hourlyApps || Array.from({length: 24}, () => ({})); }
    getDateLabel(offset = 0) {
        if (offset === 0) return 'Today';
        if (offset === -1) return 'Yesterday';
        const d = new Date(); d.setDate(d.getDate() + offset);
        return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    }
    getTopApps(n = 4, offset = 0) {
        return Object.entries(this._day(offset)?.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
            .map(([id, seconds]) => {
                const info = Gio.DesktopAppInfo.new(id);
                return {id, seconds: Math.round(seconds), name: info?.get_name() || id,
                    gicon: info?.get_icon() || null};
            });
    }
    getUserAvatar() {
        const path = `/var/lib/AccountsService/icons/${GLib.get_user_name()}`;
        return GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
    }
    _persist() {
        // Keep three months of actual measurements; no migration of estimated data.
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
        for (const key of Object.keys(this._days)) if (key < localDay(cutoff)) delete this._days[key];
        try {
            const file = Gio.File.new_for_path(this._path);
            GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
            file.replace_contents(new TextEncoder().encode(JSON.stringify({version: 2, days: this._days})), null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            this._lastSave = Date.now();
        } catch (e) { logError(e, '[peachos-widgets] saving measured usage failed'); }
    }
    destroy() {
        if (this._timer) GLib.source_remove(this._timer);
        global.display.disconnect(this._focusId);
        Main.sessionMode.disconnect(this._modeId);
        this._tick();
        this._persist();
        this._listeners.clear();
    }
}
