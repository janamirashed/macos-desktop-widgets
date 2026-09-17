// Reminders / tasks from Evolution Data Server task lists -- whatever the user
// has connected (iCloud, Google Tasks, Microsoft To Do, local). There is no
// shell-side task server the way there is for calendars, so this talks to the
// EDS calendar factory directly: enumerate [Task List] sources, OpenTaskList +
// Open + Refresh each, poll GetObjectList('#t'), parse the VTODO iCalendar.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SOURCES_NAME = 'org.gnome.evolution.dataserver.Sources5';
const SOURCES_PATH = '/org/gnome/evolution/dataserver/SourceManager';
const SOURCE_IFACE = 'org.gnome.evolution.dataserver.Source';
const CAL_NAME = 'org.gnome.evolution.dataserver.Calendar8';
const FACTORY_PATH = '/org/gnome/evolution/dataserver/CalendarFactory';
const FACTORY_IFACE = 'org.gnome.evolution.dataserver.CalendarFactory';
const CLIENT_IFACE = 'org.gnome.evolution.dataserver.Calendar';

const POLL_SECONDS = 90;

// unfold RFC 5545 line continuations, then pull a property value
function icalProp(text, name) {
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    const re = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, 'im');
    const m = unfolded.match(re);
    return m ? m[2].trim() : null;
}

function parseIcalDate(raw) {
    if (!raw)
        return null;
    // 20260907  or  20260907T133000Z  or  20260907T133000
    const m = raw.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m)
        return null;
    const [, y, mo, d, hh, mm, ss, z] = m;
    if (hh === undefined)
        return {date: new Date(+y, +mo - 1, +d), allDay: true};
    const date = z
        ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
        : new Date(+y, +mo - 1, +d, +hh, +mm, +ss);
    return {date, allDay: false};
}

function parseVtodo(ical, list) {
    const status = (icalProp(ical, 'STATUS') || '').toUpperCase();
    const pct = parseInt(icalProp(ical, 'PERCENT-COMPLETE') || '0', 10);
    const completed = status === 'COMPLETED' || pct >= 100 ||
        !!icalProp(ical, 'COMPLETED');
    const due = parseIcalDate(icalProp(ical, 'DUE'));
    return {
        uid: icalProp(ical, 'UID') || Math.random().toString(36),
        summary: (icalProp(ical, 'SUMMARY') || '').replace(/\\([,;\\n])/g, '$1'),
        due: due?.date ?? null,
        dueAllDay: due?.allDay ?? false,
        priority: parseInt(icalProp(ical, 'PRIORITY') || '0', 10),
        completed,
        listName: list.name,
        listColor: list.color,
    };
}

export class RemindersSource {
    constructor() {
        this._listeners = new Set();
        this._emitId = 0;
        this._emitting = false;
        this._lists = new Map();   // uid -> {name, color, path, busName, opened}
        this._tasks = [];

        this._bus = Gio.DBus.session;
        this._discover();
        this._pollTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, POLL_SECONDS, () => {
            this._refreshAll();
            return GLib.SOURCE_CONTINUE;
        });
        // catch task lists added/removed later
        this._rediscoverTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 120, () => {
            this._discover();
            return GLib.SOURCE_CONTINUE;
        });
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn();
        return () => this._listeners.delete(fn);
    }

    refreshNow() {
        this._discover();
    }

    /** Open incomplete reminders, soonest-due first (undated last). */
    getReminders() {
        return this._tasks
            .filter(t => !t.completed)
            .sort((a, b) => {
                if (!!a.due !== !!b.due)
                    return a.due ? -1 : 1;
                if (a.due && b.due && +a.due !== +b.due)
                    return a.due - b.due;
                return (a.priority || 9) - (b.priority || 9);
            });
    }

    _scheduleEmit() {
        if (this._emitId)
            return;
        this._emitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._emitId = 0;
            if (this._emitting)
                return GLib.SOURCE_REMOVE;
            this._emitting = true;
            try {
                for (const fn of this._listeners)
                    fn();
            } finally {
                this._emitting = false;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- EDS plumbing --------------------------------------------------

    _discover() {
        this._bus.call(
            SOURCES_NAME, SOURCES_PATH, 'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects', null, null, Gio.DBusCallFlags.NONE, 8000, null,
            (bus, res) => {
                let objects;
                try {
                    [objects] = bus.call_finish(res).recursiveUnpack();
                } catch (e) {
                    return;
                }
                const found = new Map();
                for (const ifaces of Object.values(objects)) {
                    const src = ifaces[SOURCE_IFACE];
                    if (!src || typeof src.Data !== 'string')
                        continue;
                    const kf = new GLib.KeyFile();
                    try {
                        const bytes = new TextEncoder().encode(src.Data).length;
                        if (!kf.load_from_data(src.Data, bytes, GLib.KeyFileFlags.NONE))
                            continue;
                    } catch (e) {
                        continue;
                    }
                    if (!kf.has_group('Task List'))
                        continue;
                    const g = (grp, k, dflt) => {
                        try {
                            return kf.get_string(grp, k) || dflt;
                        } catch (e) {
                            return dflt;
                        }
                    };
                    if (g('Task List', 'Selected', 'true') === 'false')
                        continue;
                    found.set(src.UID, {
                        name: g('Data Source', 'DisplayName', 'Reminders'),
                        color: g('Task List', 'Color', '#FF9F0A'),
                    });
                }

                // drop gone lists, add new ones
                for (const uid of [...this._lists.keys()]) {
                    if (!found.has(uid))
                        this._lists.delete(uid);
                }
                for (const [uid, meta] of found) {
                    if (!this._lists.has(uid))
                        this._lists.set(uid, {...meta, path: null, busName: null});
                    else
                        Object.assign(this._lists.get(uid), meta);
                }
                this._refreshAll();
            });
    }

    _refreshAll() {
        for (const [uid, list] of this._lists)
            this._openAndPull(uid, list);
    }

    _openAndPull(uid, list) {
        const pull = () => {
            this._bus.call(
                CAL_NAME, list.path, CLIENT_IFACE, 'Refresh', null, null,
                Gio.DBusCallFlags.NONE, 15000, null, () => {});
            this._bus.call(
                CAL_NAME, list.path, CLIENT_IFACE, 'GetObjectList',
                new GLib.Variant('(s)', ['#t']), new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE, 20000, null, (bus, res) => {
                    let icals;
                    try {
                        [icals] = bus.call_finish(res).recursiveUnpack();
                    } catch (e) {
                        return;
                    }
                    const others = this._tasks.filter(t => t.listName !== list.name);
                    const mine = icals.map(s => parseVtodo(s, list));
                    this._tasks = [...others, ...mine];
                    this._scheduleEmit();
                });
        };

        if (list.path) {
            pull();
            return;
        }
        this._bus.call(
            CAL_NAME, FACTORY_PATH, FACTORY_IFACE, 'OpenTaskList',
            new GLib.Variant('(s)', [uid]), new GLib.VariantType('(ss)'),
            Gio.DBusCallFlags.NONE, 20000, null, (bus, res) => {
                try {
                    [list.path, list.busName] = bus.call_finish(res).recursiveUnpack();
                } catch (e) {
                    return;
                }
                this._bus.call(
                    CAL_NAME, list.path, CLIENT_IFACE, 'Open', null, null,
                    Gio.DBusCallFlags.NONE, 20000, null, () => pull());
            });
    }

    destroy() {
        this._listeners.clear();
        for (const t of ['_emitId', '_pollTimer', '_rediscoverTimer']) {
            if (this[t]) {
                GLib.source_remove(this[t]);
                this[t] = 0;
            }
        }
        for (const list of this._lists.values()) {
            if (list.path)
                this._bus.call(CAL_NAME, list.path, CLIENT_IFACE, 'Close',
                    null, null, Gio.DBusCallFlags.NONE, 5000, null, () => {});
        }
        this._lists.clear();
        this._tasks = [];
    }
}

export function formatDue(date, allDay) {
    if (!date)
        return '';
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((t0 - d0) / 86400000);
    const time = allDay ? '' : ` ${date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;
    if (days === 0)
        return `Today${time}`;
    if (days === 1)
        return `Tomorrow${time}`;
    if (days === -1)
        return `Yesterday${time}`;
    if (days < 0)
        return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    if (days < 7)
        return date.toLocaleDateString(undefined, {weekday: 'short'}) + time;
    return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
