// Branded calendar sources on the shell's DBusEventSource (Evolution Data
// Server), each scoped to one account family:
//
//   ICloudCalendarSource -- iCloud + on-device calendars (not Google).
//   GoogleCalendarSource -- Google calendars only.
//
// Scoping is decided from each ESource's own keyfile (auth host / backend),
// NOT from GOA -- GOA's Account GIR has a property/method name clash in GJS
// that makes `acc.provider_type` unreliable. Events are then filtered by the
// event-id prefix, which is the ESource UID.
//
// requestRange discipline (see lib/providers/calendar.js): reload only from
// _refreshRange(), never from getEvents().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

const SOURCES_NAME = 'org.gnome.evolution.dataserver.Sources5';
const SOURCES_PATH = '/org/gnome/evolution/dataserver/SourceManager';
const SOURCE_IFACE = 'org.gnome.evolution.dataserver.Source';
const CAL_NAME = 'org.gnome.evolution.dataserver.Calendar8';
const FACTORY_PATH = '/org/gnome/evolution/dataserver/CalendarFactory';

const GOOGLE_RE = /googleusercontent\.com|(^|\.)google\.com$/i;
const ICLOUD_RE = /icloud\.com|(^|\.)me\.com$|(^|\.)mac\.com$/i;
const LOCAL_BACKENDS = new Set(['local', 'contacts', 'weather', 'webcal']);

class FilteredCalendarSource {
    // cfg: { keep(row, host, resource) -> bool, alwaysConnected: bool }
    constructor(cfg) {
        this._cfg = cfg;
        this._listeners = new Set();
        this._emitId = 0;
        this._emitting = false;
        this._rangeKey = '';
        this._uids = null;         // Set<uid> to keep, or null == not resolved yet
        this._connected = !!cfg.alwaysConnected;

        try {
            this._source = new Calendar.DBusEventSource();
            this._source.connectObject('changed', () => this._scheduleEmit(), this);
        } catch (e) {
            logError(e, '[peachos-widgets] calendar source unavailable');
            this._source = null;
        }

        this._detect();
        this._refreshRange();
        this._rangeTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 6 * 3600, () => {
            this._refreshRange();
            return GLib.SOURCE_CONTINUE;
        });
        this._detectTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 90, () => {
            this._detect();
            return GLib.SOURCE_CONTINUE;
        });
        this._syncTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3 * 60, () => {
            this._refreshCalDav();
            return GLib.SOURCE_CONTINUE;
        });
    }

    get connected() {
        return this._connected;
    }

    refreshNow() {
        this._detect();
        this._refreshCalDav();
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn();
        return () => this._listeners.delete(fn);
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

    _refreshRange() {
        if (!this._source)
            return;
        const now = new Date();
        const begin = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(begin);
        end.setDate(end.getDate() + 62);
        const key = `${begin.getTime()}-${end.getTime()}`;
        if (key === this._rangeKey)
            return;
        this._rangeKey = key;
        this._source.requestRange(begin, end);
    }

    // Ask EDS to fetch each kept calendar from the server now (callback form --
    // the promisified Gio call misbehaves with our arg list).
    _refreshCalDav() {
        for (const uid of this._uids ?? []) {
            Gio.DBus.session.call(
                CAL_NAME, FACTORY_PATH,
                'org.gnome.evolution.dataserver.CalendarFactory', 'OpenCalendar',
                new GLib.Variant('(s)', [uid]), new GLib.VariantType('(ss)'),
                Gio.DBusCallFlags.NONE, 15000, null,
                (bus, res) => {
                    let path, name;
                    try {
                        [path, name] = bus.call_finish(res).recursiveUnpack();
                    } catch (e) {
                        return;
                    }
                    Gio.DBus.session.call(
                        name, path, 'org.gnome.evolution.dataserver.Calendar',
                        'Refresh', null, null, Gio.DBusCallFlags.NONE, 15000, null,
                        (b, r) => {
                            try {
                                b.call_finish(r);
                            } catch (e) {
                                // backend busy / offline
                            }
                        });
                });
        }
    }

    // --- which calendars to keep ---------------------------------------

    async _detect() {
        let uids = null;
        try {
            uids = await this._sourceUids();
        } catch (e) {
            logError(e, '[peachos-widgets] EDS source enumeration failed');
        }
        const before = this._uids ? [...this._uids].sort().join() : '';
        this._uids = uids;
        const after = this._uids ? [...this._uids].sort().join() : '';
        this._connected = this._cfg.alwaysConnected ||
            (!!this._uids && this._uids.size > 0);
        if (this._uids && after !== before)
            this._refreshCalDav();
        this._scheduleEmit();
    }

    _sourceUids() {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(
                SOURCES_NAME, SOURCES_PATH,
                'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects',
                null, null, Gio.DBusCallFlags.NONE, 5000, null,
                (bus, res) => {
                    try {
                        const [objects] = bus.call_finish(res).recursiveUnpack();
                        resolve(this._parseSources(objects));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
    }

    _parseSources(objects) {
        const rows = [];
        for (const ifaces of Object.values(objects)) {
            const src = ifaces[SOURCE_IFACE];
            if (!src || typeof src.UID !== 'string' || typeof src.Data !== 'string')
                continue;
            const kf = new GLib.KeyFile();
            try {
                const bytes = new TextEncoder().encode(src.Data).length;
                if (!kf.load_from_data(src.Data, bytes, GLib.KeyFileFlags.NONE))
                    continue;
            } catch (e) {
                continue;
            }
            if (!kf.has_group('Calendar'))
                continue;
            const get = (grp, k) => {
                try {
                    return kf.get_string(grp, k) || '';
                } catch (e) {
                    return '';   // missing group/key
                }
            };
            rows.push({
                uid: src.UID,
                parent: get('Data Source', 'Parent') || null,
                name: get('Data Source', 'DisplayName'),
                host: get('Authentication', 'Host').toLowerCase(),
                backend: get('Calendar', 'BackendName').toLowerCase(),
                resource: get('Resource', 'Identity').toLowerCase(),
                webdav: get('WebDAV Backend', 'ResourcePath').toLowerCase(),
            });
        }

        const byUid = new Map(rows.map(r => [r.uid, r]));
        // resolve the effective host/resource, walking to the parent collection
        // if the leaf source doesn't carry one
        const origin = r => {
            let cur = r;
            let host = '';
            let resource = '';
            for (let i = 0; cur && i < 6; i++) {
                host ||= cur.host;
                resource ||= cur.resource || cur.webdav;
                cur = cur.parent ? byUid.get(cur.parent) : null;
            }
            return {host, resource};
        };

        const uids = new Set();
        for (const r of rows) {
            const {host, resource} = origin(r);
            if (this._cfg.keep(r, host, resource))
                uids.add(r.uid);
        }
        console.log(`[peachos-widgets] ${this.constructor.name}: `
            + `${rows.length} calendars, kept ${uids.size} `
            + `[${rows.map(r => `${(origin(r).host || r.backend || '?')}`).join(', ')}]`);
        return uids;
    }

    // --- events --------------------------------------------------------

    getEvents(begin, end) {
        if (!this._source || this._uids === null)
            return [];   // sources not resolved yet -- don't flash unfiltered data
        const events = (this._source.getEvents(begin, end) ?? [])
            .filter(ev => this._uids.has(String(ev.id).split('\n')[0]));

        // The same event can arrive from more than one calendar (US Holidays
        // via both an iCloud and a Google account, a shared calendar synced to
        // both, ...) -- collapse identical (title + start + end).
        const seen = new Set();
        const out = [];
        for (const ev of events) {
            const key = `${ev.summary}|${ev.date.getTime()}|${ev.end.getTime()}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const span = ev.end.getTime() - ev.date.getTime();
            const allDay = ev.date.getHours() === 0 && ev.date.getMinutes() === 0 &&
                span % (24 * 3600 * 1000) === 0 && span >= 24 * 3600 * 1000;
            out.push({summary: ev.summary, date: ev.date, end: ev.end, allDay});
        }
        return out;
    }

    destroy() {
        this._listeners.clear();
        for (const t of ['_emitId', '_rangeTimer', '_detectTimer', '_syncTimer']) {
            if (this[t]) {
                GLib.source_remove(this[t]);
                this[t] = 0;
            }
        }
        if (this._source) {
            this._source.disconnectObject(this);
            this._source.destroy?.();
            this._source = null;
        }
    }
}

function isGoogle(host, resource) {
    return GOOGLE_RE.test(host) || resource.includes('googleusercontent');
}

// A subscribed holiday calendar (Google's "Holidays in ...", Apple's "US
// Holidays", etc.). These belong on the regular Calendar widget no matter
// which account provides them.
function isHoliday(r, resource) {
    return /\bholidays?\b/i.test(r.name || '') ||
        resource.includes('holiday') ||
        resource.includes('%40virtual') ||
        resource.includes('v.calendar.google.com') ||
        (r.webdav || '').includes('holiday');
}

export class ICloudCalendarSource extends FilteredCalendarSource {
    constructor() {
        super({
            alwaysConnected: true,   // there is always an on-device calendar
            keep: (r, host, resource) => {
                if (isHoliday(r, resource))
                    return true;                       // holidays: any source
                if (isGoogle(host, resource))
                    return false;
                if (ICLOUD_RE.test(host) || resource.includes('icloud'))
                    return true;
                // on-device: no remote host, a local backend
                return !host && LOCAL_BACKENDS.has(r.backend);
            },
        });
    }
}

export class GoogleCalendarSource extends FilteredCalendarSource {
    constructor() {
        super({
            alwaysConnected: false,
            // Google calendars only, minus the holiday calendar (it shows on
            // the regular widget so it can't appear in both).
            keep: (r, host, resource) =>
                isGoogle(host, resource) && !isHoliday(r, resource),
        });
    }
}

/** Open peachOS Settings -> Internet Accounts to connect an account. */
export function openAccountSettings() {
    for (const argv of [
        ['peachos-settings', 'internetaccounts'],
        ['gnome-control-center', 'online-accounts'],
    ]) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return;
        } catch (e) {
            // try the next
        }
    }
}
