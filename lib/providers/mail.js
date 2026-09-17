// Mail provider -- feeds the Gmail / iCloud Mail / Outlook widgets.
//
// The Python helper `peachos-mail` (installed as /usr/bin/peachos-mail, run by a
// systemd user timer every 2 min) authenticates via GNOME Online Accounts /
// libsecret and writes the 3 newest inbox messages per provider to
//   ~/.cache/peachos-widgets/mail/{gmail,icloud,outlook}.json
// and raises a desktop notification for each new one. This class just reads that
// cache; it also kicks a `sync` if the cache looks stale.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'peachos-widgets', 'mail']);
const HELPER = 'peachos-mail';
const RELOAD_SECONDS = 5 * 60;
const STALE_SECONDS = 4 * 60;   // the timer's own cadence + slack

// widget brand -> manifest file basename
const FILE = {google: 'gmail', apple: 'icloud', microsoft: 'outlook'};

function readJSON(path) {
    try {
        const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
        if (!ok)
            return null;
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        return null;
    }
}

export class MailProvider {
    constructor() {
        this._listeners = new Set();
        this._data = {};   // brand -> manifest

        this._loadAll();
        this._maybeSync();

        this._reloadId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RELOAD_SECONDS, () => {
            this._loadAll();
            this._maybeSync();
            return GLib.SOURCE_CONTINUE;
        });

        try {
            this._monitor = Gio.File.new_for_path(CACHE_DIR)
                .monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (_m, _f, _o, ev) => {
                if (ev === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    ev === Gio.FileMonitorEvent.CREATED)
                    this._loadAll();
            });
        } catch (e) {
            // dir doesn't exist yet -- the reload timer + _maybeSync cover it
        }
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn();
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners)
            fn();
    }

    /** [{from, addr, subject, preview, date, unread}] for a widget brand. */
    getInbox(brand) {
        const m = this._data[brand];
        return (m && Array.isArray(m.messages)) ? m.messages : [];
    }

    /** {connected, reauthNeeded} for a widget brand -> drives the placeholder. */
    status(brand) {
        const m = this._data[brand] || {};
        return {connected: !!m.connected, reauthNeeded: !!m.reauth};
    }

    refreshNow() {
        this._spawnSync();
    }

    _loadAll() {
        let changed = false;
        for (const [brand, base] of Object.entries(FILE)) {
            const m = readJSON(GLib.build_filenamev([CACHE_DIR, `${base}.json`])) || {};
            if (JSON.stringify(m) !== JSON.stringify(this._data[brand] || {})) {
                this._data[brand] = m;
                changed = true;
            }
        }
        if (changed)
            this._emit();
    }

    _maybeSync() {
        let stale = false;
        for (const base of Object.values(FILE)) {
            const m = readJSON(GLib.build_filenamev([CACHE_DIR, `${base}.json`]));
            const age = m?.updated ? (Date.now() / 1000 - m.updated) : Infinity;
            if (age > STALE_SECONDS)
                stale = true;
        }
        if (stale)
            this._spawnSync();
    }

    _spawnSync() {
        if (!GLib.find_program_in_path(HELPER))
            return;
        try {
            Gio.Subprocess.new([HELPER, 'sync'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, '[peachos-widgets] mail sync spawn failed');
        }
    }

    destroy() {
        if (this._reloadId) {
            GLib.source_remove(this._reloadId);
            this._reloadId = 0;
        }
        if (this._monitor && this._monitorId) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
        }
        this._monitor = null;
        this._listeners.clear();
        this._data = {};
    }
}
