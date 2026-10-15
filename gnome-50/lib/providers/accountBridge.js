import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// One subprocess per provider, cancelled on disable. Never logs helper payloads.
export class AccountBridge {
    constructor(path, command, username = null) {
        this.path = path;
        this.command = command;
        this.username = username;
        this.data = null;
        this.error = null;
        this._listeners = new Set();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 300, () => {
            this.refreshNow(); return GLib.SOURCE_CONTINUE;
        });
        this.refreshNow();
    }
    subscribe(fn) { this._listeners.add(fn); fn(); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) fn(); }
    refreshNow() {
        if (this._dead || this._process || this._connecting) return;
        if (this.command === 'leetcode-fetch' && !this.username?.trim()) {
            this.error = 'Configure LeetCode username';
            this._emit();
            return;
        }
        const argv = ['/usr/bin/python3', GLib.build_filenamev([this.path, 'helpers', 'accounts.py']), this.command];
        if (this.username) argv.push('--username', this.username);
        this._cancel = new Gio.Cancellable();
        try {
            const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this._process = proc;
            this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 90, () => {
                this._timeout = 0; proc.force_exit(); return GLib.SOURCE_REMOVE;
            });
            proc.communicate_utf8_async(null, this._cancel, (_source, result) => {
                if (this._timeout) GLib.source_remove(this._timeout);
                this._timeout = 0;
                this._process = null;
                if (this._dead) return;
                try {
                    const [, stdout] = proc.communicate_utf8_finish(result);
                    const data = JSON.parse(stdout);
                    if (data.error) throw new Error(data.error);
                    this.data = data;
                    this.error = null;
                } catch (e) {
                    this.error = e.message || 'Account unavailable';
                    // An old completion indicator must not look freshly verified.
                    if (this.data) this.data = {...this.data, connected: false};
                }
                this._emit();
            });
        } catch (_) { this.error = 'Python account helper unavailable'; this._emit(); }
    }
    connectAccount() {
        if (this._connecting || this._dead) return;
        try {
            const proc = Gio.Subprocess.new(['/usr/bin/python3',
                GLib.build_filenamev([this.path, 'helpers', 'accounts.py']),
                'leetcode-connect', '--username', this.username],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            this._connecting = proc;
            proc.wait_async(null, (_source, result) => {
                this._connecting = null;
                try { proc.wait_finish(result); } catch (_) { /* Setup may be cancelled. */ }
                if (this._dead) return;
                this.data = null;
                this.error = null;
                this.refreshNow();
            });
        } catch (_) { this.error = 'Account setup unavailable'; this._emit(); }
    }
    destroy() {
        this._dead = true;
        if (this._timer) GLib.source_remove(this._timer);
        if (this._timeout) GLib.source_remove(this._timeout);
        this._timeout = 0;
        this._cancel?.cancel();
        this._process?.force_exit();
        this._connecting?.force_exit();
        this._listeners.clear();
    }
}

export class GoogleBridge extends AccountBridge {
    constructor(path) { super(path, 'google-sync'); }
    get connected() { return !!(this.data?.connected && this.data?.calendarConnected); }
    getEvents(begin, end) {
        return (this.data?.events || []).map(event => ({...event, date: new Date(event.date), end: new Date(event.end)}))
            .filter(event => event.date < end && event.end > begin);
    }
}
