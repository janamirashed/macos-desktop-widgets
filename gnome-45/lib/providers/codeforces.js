import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export class CodeforcesProvider {
    constructor(handle = '') {
        this.handle = handle;
        this._listeners = new Set();
        this._session = new Soup.Session({timeout: 20});
        this.data = {};
        this.errors = {};
        this._pending = new Set();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 900, () => {
            this.refreshNow(); return GLib.SOURCE_CONTINUE;
        });
        this.refreshNow();
    }
    subscribe(fn) { this._listeners.add(fn); fn(); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) fn(); }
    refreshNow() {
        // Queue requests at three-second intervals to respect the public API limit.
        if (this._dead || this._pending.size || this._queueTimer) return;
        const h = encodeURIComponent(this.handle);
        const queue = [['contests', 'contest.list?gym=false'], ['user', `user.info?handles=${h}`],
            ['history', `user.rating?handle=${h}`]];
        if (!this.handle.trim()) queue.splice(1);
        const next = () => {
            const item = queue.shift();
            if (item) this._fetch(...item);
            return queue.length ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        };
        next();
        this._queueTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3, () => {
            const result = next();
            if (result === GLib.SOURCE_REMOVE) this._queueTimer = 0;
            return result;
        });
    }
    _fetch(key, endpoint) {
        this._pending.add(key);
        const msg = Soup.Message.new('GET', `https://codeforces.com/api/${endpoint}`);
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            this._pending.delete(key);
            if (this._dead) return;
            try {
                const bytes = source.send_and_read_finish(result);
                if (msg.status_code !== 200) throw new Error(`HTTP ${msg.status_code}`);
                const payload = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (payload.status !== 'OK') throw new Error('Codeforces data unavailable');
                let value = payload.result;
                if (key === 'contests') value = value.filter(c => c.phase === 'BEFORE').sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
                if (key === 'user') value = value[0];
                this.data[key] = value;
                this.data[`${key}Updated`] = Date.now();
                delete this.errors[key];
            } catch (e) { this.errors[key] = e.message; }
            this._emit();
        });
    }
    destroy() {
        this._dead = true;
        GLib.source_remove(this._timer);
        if (this._queueTimer) GLib.source_remove(this._queueTimer);
        this._session.abort();
        this._listeners.clear();
    }
}
