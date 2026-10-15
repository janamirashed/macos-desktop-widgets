// iCloud Photos provider.
//
// The heavy lifting is a Python helper (apps/icloud-photos/peachos-icloud-photos,
// installed as /usr/bin/peachos-icloud-photos) that signs in with pyicloud and
// drops ~30 random photos from the library, as downscaled JPEGs, into
//   ~/.cache/peachos-widgets/icloud-photos/{manifest.json, <hash>.jpg}
// A systemd user timer re-runs `sync` every few hours; this class also kicks one
// if the cache looks stale. Here we just read that cache and rotate through it so
// the widget shows "random pictures throughout the day".

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const CACHE_DIR = GLib.build_filenamev(
    [GLib.get_user_cache_dir(), 'peachos-widgets', 'icloud-photos']);
const MANIFEST = GLib.build_filenamev([CACHE_DIR, 'manifest.json']);
const CONFIG = GLib.build_filenamev(
    [GLib.get_home_dir(), '.local', 'share', 'peachos', 'icloud-photos', 'config.json']);

const ROTATE_SECONDS = 45 * 60;        // pick a different photo this often
const STALE_SECONDS = 4 * 60 * 60;     // re-sync the cache if older than this
const HELPER = 'peachos-icloud-photos';

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

export class IcloudPhotosProvider {
    constructor() {
        this._listeners = new Set();
        this._photos = [];
        this._current = null;
        this._config = readJSON(CONFIG) || {};

        this._load();
        this._maybeSync();

        // rotate
        this._rotateId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, ROTATE_SECONDS, () => {
            this._pick();
            return GLib.SOURCE_CONTINUE;
        });

        // react the moment a fresh sync rewrites the manifest
        try {
            this._monitor = Gio.File.new_for_path(MANIFEST)
                .monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitorId = this._monitor.connect('changed', (_m, _f, _o, ev) => {
                if (ev === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    ev === Gio.FileMonitorEvent.CREATED) {
                    this._config = readJSON(CONFIG) || {};
                    this._load();
                }
            });
        } catch (e) {
            // no manifest yet -- the timer + _maybeSync still cover it
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

    /** {path, date, name} of the photo to show now, or null. */
    get() {
        return this._current;
    }

    /** {connected, reauthNeeded, cached} -- lets the widget show a placeholder. */
    get status() {
        return {
            connected: !!this._config.apple_id,
            reauthNeeded: !!this._config.reauth_needed,
            cached: this._photos.length,
        };
    }

    refreshNow() {
        this._spawnSync();
    }

    _load() {
        const m = readJSON(MANIFEST);
        this._photos = (m && Array.isArray(m.photos)) ? m.photos : [];
        this._pick();
    }

    _pick() {
        if (!this._photos.length) {
            if (this._current !== null) {
                this._current = null;
                this._emit();
            }
            return;
        }
        let next;
        for (let i = 0; i < 6; i++) {
            next = this._photos[Math.floor(Math.random() * this._photos.length)];
            if (!this._current || next.file !== this._current.file || this._photos.length === 1)
                break;
        }
        this._current = {
            path: GLib.build_filenamev([CACHE_DIR, next.file]),
            date: next.date || null,
            name: next.name || null,
        };
        this._emit();
    }

    _maybeSync() {
        if (!this._config.apple_id || this._config.reauth_needed)
            return;
        const m = readJSON(MANIFEST);
        const age = m?.updated ? (Date.now() / 1000 - m.updated) : Infinity;
        if (age > STALE_SECONDS)
            this._spawnSync();
    }

    _spawnSync() {
        if (!GLib.find_program_in_path(HELPER))
            return;
        try {
            Gio.Subprocess.new([HELPER, 'sync'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, '[peachos-widgets] icloud-photos sync spawn failed');
        }
    }

    destroy() {
        if (this._rotateId) {
            GLib.source_remove(this._rotateId);
            this._rotateId = 0;
        }
        if (this._monitor && this._monitorId) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
        }
        this._monitor = null;
        this._listeners.clear();
        this._photos = [];
        this._current = null;
    }
}
