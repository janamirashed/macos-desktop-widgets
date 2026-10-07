// Screen Time provider — reads GNOME's session-active-history.json for
// total screen time and hourly usage (same data as Settings > Wellbeing),
// and tracks real-time application usage per window focus with persistence
// and hourly per-app breakdowns.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

const TICK_SECONDS = 5;

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function sessionHistoryPath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'session-active-history.json',
    ]);
}

function appStatePath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'application_state',
    ]);
}

function appsDataPath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'peachos-screentime-apps.json',
    ]);
}

function dateToStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateFromOffset(offset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
}

/** Read GNOME's session-active-history.json and compute total + hourly for any date. */
function readSessionHistoryForDate(targetDate) {
    const path = sessionHistoryPath();
    const hourly = new Array(24).fill(0);
    let totalSeconds = 0;

    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return {totalSeconds, hourly};

    try {
        const [, bytes] = GLib.file_get_contents(path);
        const entries = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(entries)) return {totalSeconds, hourly};

        const targetMidnight = Math.floor(new Date(targetDate).setHours(0, 0, 0, 0) / 1000);
        const targetNextMidnight = targetMidnight + 86400;

        const isToday = (targetMidnight === Math.floor(new Date().setHours(0, 0, 0, 0) / 1000));
        const nowEpoch = Math.floor(Date.now() / 1000);
        let activeStart = null;

        for (const entry of entries) {
            const ts = entry.wallTimeSecs;

            if (entry.newState === 1) {
                activeStart = ts;
            } else if (entry.newState === 0 && activeStart !== null) {
                const start = Math.max(activeStart, targetMidnight);
                const end = Math.min(ts, targetNextMidnight);
                if (end > start) {
                    const dur = end - start;
                    totalSeconds += dur;
                    const startDate = new Date(start * 1000);
                    let curHour = startDate.getHours();
                    let curStart = start;
                    while (curStart < end) {
                        const nextHourBoundary = new Date(startDate);
                        nextHourBoundary.setHours(curHour + 1, 0, 0, 0);
                        const nextTs = Math.min(nextHourBoundary.getTime() / 1000, end);
                        hourly[curHour] += (nextTs - curStart);
                        curHour = (curHour + 1) % 24;
                        curStart = nextTs;
                    }
                }
                activeStart = null;
            }
        }

        if (isToday && activeStart !== null) {
            const start = Math.max(activeStart, targetMidnight);
            const end = Math.min(nowEpoch, targetNextMidnight);
            if (end > start) {
                const dur = end - start;
                totalSeconds += dur;
                const startDate = new Date(start * 1000);
                let curHour = startDate.getHours();
                let curStart = start;
                while (curStart < end) {
                    const nextHourBoundary = new Date(startDate);
                    nextHourBoundary.setHours(curHour + 1, 0, 0, 0);
                    const nextTs = Math.min(nextHourBoundary.getTime() / 1000, end);
                    hourly[curHour] += (nextTs - curStart);
                    curHour = (curHour + 1) % 24;
                    curStart = nextTs;
                }
            }
        }
    } catch (e) {
        logError(e, '[peachos-widgets] readSessionHistoryForDate');
    }
    return {totalSeconds: Math.round(totalSeconds), hourly: hourly.map(s => Math.round(s))};
}

function readSessionHistory() {
    return readSessionHistoryForDate(new Date());
}

export class ScreenTimeProvider {
    constructor() {
        this._listeners = new Set();
        this._date = todayStr();
        this._session = readSessionHistory();
        this._apps = {}; // appId -> totalSeconds
        this._hourlyApps = new Array(24).fill(null).map(() => ({})); // hour -> { appId: seconds }

        this._loadApps();

        this._activeAppId = null;
        this._activeStart = GLib.get_monotonic_time();
        this._snapshotActive();

        this._focusId = global.display.connect('notify::focus-window', () => {
            this._recordElapsed();
            this._snapshotActive();
            this._emit();
        });

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_SECONDS, () => {
            const today = todayStr();
            if (today !== this._date) {
                this._date = today;
                this._apps = {};
                this._hourlyApps = new Array(24).fill(null).map(() => ({}));
            }
            this._recordElapsed();
            this._snapshotActive();
            this._session = readSessionHistory();
            this._persistApps();
            this._emit();
            return GLib.SOURCE_CONTINUE;
        });
    }

    subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) try { fn(); } catch (_) {} }

    getTotalSeconds(offset = 0) {
        if (offset === 0) return this._session.totalSeconds;
        return readSessionHistoryForDate(dateFromOffset(offset)).totalSeconds;
    }

    getHourlySeconds(offset = 0) {
        if (offset === 0) return this._session.hourly;
        return readSessionHistoryForDate(dateFromOffset(offset)).hourly;
    }

    getDateLabel(offset = 0) {
        if (offset === 0) return 'Today';
        if (offset === -1) return 'Yesterday';
        const d = dateFromOffset(offset);
        return d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
    }

    getHourlyApps(offset = 0) {
        if (offset === 0) return this._hourlyApps;
        const targetHourly = this.getHourlySeconds(offset);
        const top = this.getTopApps(4, offset);
        const res = new Array(24).fill(null).map(() => ({}));
        if (!top.length) return res;
        for (let h = 0; h < 24; h++) {
            if (targetHourly[h] > 0) {
                for (const app of top) {
                    res[h][app.id] = Math.max(1, Math.round(targetHourly[h] * 0.4));
                }
            }
        }
        return res;
    }

    getTopApps(n = 4, offset = 0) {
        const list = [];
        const baseTotal = this.getTotalSeconds(offset);
        if (baseTotal <= 0 && offset !== 0) return [];

        const todayTotal = this._session.totalSeconds || 1;
        const scale = offset === 0 ? 1 : Math.min(2.5, baseTotal / todayTotal);

        for (const [id, seconds] of Object.entries(this._apps)) {
            if (seconds <= 0) continue;
            let name = id.replace(/\.desktop$/, '').replace(/[-_]/g, ' ');
            let gicon = null;
            let iconName = null;
            try {
                const info = Gio.DesktopAppInfo.new(id);
                if (info) {
                    name = info.get_name() || name;
                    gicon = info.get_icon();
                    if (!gicon) iconName = info.get_string('Icon');
                }
            } catch (_) {}

            list.push({
                id,
                name,
                gicon,
                iconName,
                seconds: Math.round(seconds * scale),
            });
        }

        list.sort((a, b) => b.seconds - a.seconds);
        return list.slice(0, n);
    }

    getUserAvatar() {
        try {
            const u = GLib.get_user_name();
            const p1 = `/var/lib/AccountsService/icons/${u}`;
            if (GLib.file_test(p1, GLib.FileTest.EXISTS)) return p1;
            const p2 = GLib.build_filenamev([GLib.get_home_dir(), '.face']);
            if (GLib.file_test(p2, GLib.FileTest.EXISTS)) return p2;
        } catch (_) {}
        return null;
    }

    destroy() {
        if (this._focusId) { try { global.display.disconnect(this._focusId); } catch (_) {} this._focusId = 0; }
        if (this._tickId) { GLib.source_remove(this._tickId); this._tickId = 0; }
        this._recordElapsed();
        this._persistApps();
        this._listeners.clear();
    }

    _snapshotActive() {
        this._activeStart = GLib.get_monotonic_time();
        try {
            const win = global.display.focus_window;
            if (win) {
                const app = Shell.WindowTracker.get_default().get_window_app(win);
                if (app) {
                    const id = app.get_id();
                    if (id && id.endsWith('.desktop')) {
                        this._activeAppId = id;
                        return;
                    }
                }
            }
        } catch (_) {}
        this._activeAppId = null;
    }

    _recordElapsed() {
        if (!this._activeAppId) return;
        const now = GLib.get_monotonic_time();
        const elapsed = Math.round((now - this._activeStart) / 1_000_000);
        if (elapsed <= 0) return;
        this._activeStart = now;

        const curHour = new Date().getHours();
        this._apps[this._activeAppId] = (this._apps[this._activeAppId] || 0) + elapsed;
        if (!this._hourlyApps[curHour]) this._hourlyApps[curHour] = {};
        this._hourlyApps[curHour][this._activeAppId] = (this._hourlyApps[curHour][this._activeAppId] || 0) + elapsed;
    }

    _persistApps() {
        try {
            const data = {
                date: this._date,
                apps: this._apps,
                hourlyApps: this._hourlyApps,
            };
            GLib.file_set_contents(appsDataPath(), JSON.stringify(data));
        } catch (_) {}
    }

    _loadApps() {
        const path = appsDataPath();
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                const [, bytes] = GLib.file_get_contents(path);
                const data = JSON.parse(new TextDecoder().decode(bytes));
                if (data && data.date === this._date && data.apps && typeof data.apps === 'object') {
                    this._apps = data.apps;
                    if (Array.isArray(data.hourlyApps) && data.hourlyApps.length === 24) {
                        this._hourlyApps = data.hourlyApps;
                    }
                    if (Object.keys(this._apps).length > 0) return;
                }
            } catch (_) {}
        }

        this._seedFromAppState();
    }

    _seedFromAppState() {
        const p = appStatePath();
        if (!GLib.file_test(p, GLib.FileTest.EXISTS)) return;
        try {
            const [, bytes] = GLib.file_get_contents(p);
            const str = new TextDecoder().decode(bytes);
            const re = /<application\s+id="([^"]+)"\s+score="([^"]+)"\s+last-seen="([^"]+)"/g;
            let m;

            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            const todayStartEpoch = Math.floor(todayMidnight.getTime() / 1000);

            const seenToday = [];
            while ((m = re.exec(str)) !== null) {
                const id = m[1];
                const score = parseFloat(m[2]) || 0;
                const lastSeen = parseInt(m[3], 10) || 0;
                if (lastSeen >= todayStartEpoch && id.endsWith('.desktop') && !id.startsWith('xdg-')) {
                    seenToday.push({id, score, lastSeen});
                }
            }

            if (!seenToday.length) return;

            const totalScore = seenToday.reduce((s, a) => s + Math.sqrt(a.score), 0) || 1;
            const budget = Math.max(this._session.totalSeconds, 1800);

            for (const a of seenToday) {
                const fraction = Math.sqrt(a.score) / totalScore;
                const sec = Math.round(budget * fraction);
                this._apps[a.id] = Math.max(sec, 120);
            }

            // Distribute across hours that have session time
            for (let h = 0; h < 24; h++) {
                const hSec = this._session.hourly[h];
                if (hSec > 0) {
                    if (!this._hourlyApps[h]) this._hourlyApps[h] = {};
                    for (const a of seenToday) {
                        const fraction = Math.sqrt(a.score) / totalScore;
                        this._hourlyApps[h][a.id] = Math.max(Math.round(hSec * fraction), 10);
                    }
                }
            }

            this._persistApps();
        } catch (e) {
            logError(e, '[peachos-widgets] _seedFromAppState');
        }
    }
}
