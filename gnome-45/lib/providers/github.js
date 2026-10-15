import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const REFRESH_SECONDS = 600;
const API_URL = u =>
    `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(u)}?y=last`;

function detectLocalUsername() {
    try {
        const gitconfig = GLib.build_filenamev([GLib.get_home_dir(), '.gitconfig']);
        if (GLib.file_test(gitconfig, GLib.FileTest.EXISTS)) {
            const [, bytes] = GLib.file_get_contents(gitconfig);
            const content = new TextDecoder().decode(bytes);
            const m = content.match(/name\s*=\s*([^\r\n]+)/);
            if (m && m[1].trim()) return m[1].trim();
        }
    } catch (_) {}
    return GLib.get_user_name() || 'janamirashed';
}

const DEFAULT_USER = detectLocalUsername();
export const GITHUB_DEFAULTS = {square: DEFAULT_USER, row: DEFAULT_USER};

export const GITHUB_THEMES = {
    green:  ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    red:    ['#161b22', '#67000d', '#a50f15', '#de2d26', '#fb6a4a'],
    blue:   ['#161b22', '#08306b', '#2171b5', '#4292c6', '#6baed6'],
    orange: ['#161b22', '#7f2704', '#d94801', '#f16913', '#fdae6b'],
    purple: ['#161b22', '#3c1361', '#6a1b9a', '#9c27b0', '#ce93d8'],
    pink:   ['#161b22', '#701a35', '#b82655', '#e6396f', '#ff6b98'],
    teal:   ['#161b22', '#004d40', '#00796b', '#009688', '#4db6ac'],
    yellow: ['#161b22', '#594400', '#997300', '#d4a000', '#ffd23f'],
};

export function hexToRgb(hex) {
    if (!hex) return [0.15, 0.65, 0.25];
    const h = hex.replace('#', '').trim();
    if (h.length === 3) {
        return [
            parseInt(h[0] + h[0], 16) / 255,
            parseInt(h[1] + h[1], 16) / 255,
            parseInt(h[2] + h[2], 16) / 255,
        ];
    }
    if (h.length >= 6) {
        return [
            parseInt(h.substring(0, 2), 16) / 255,
            parseInt(h.substring(2, 4), 16) / 255,
            parseInt(h.substring(4, 6), 16) / 255,
        ];
    }
    return [0.15, 0.65, 0.25];
}

export function getThemeColors(themeNameOrHex) {
    if (themeNameOrHex && GITHUB_THEMES[themeNameOrHex]) {
        return GITHUB_THEMES[themeNameOrHex].map(hexToRgb);
    }
    if (typeof themeNameOrHex === 'string' && themeNameOrHex.startsWith('#')) {
        const [r, g, b] = hexToRgb(themeNameOrHex);
        return [
            [1, 1, 1],
            [r * 0.40, g * 0.40, b * 0.40],
            [r * 0.65, g * 0.65, b * 0.65],
            [r * 0.85, g * 0.85, b * 0.85],
            [r, g, b],
        ];
    }
    return GITHUB_THEMES.green.map(hexToRgb);
}

function cacheDir() {
    const d = GLib.build_filenamev([GLib.get_user_cache_dir(), 'peachos-widgets', 'github']);
    if (!GLib.file_test(d, GLib.FileTest.IS_DIR))
        try { Gio.File.new_for_path(d).make_directory_with_parents(null); } catch (_) {}
    return d;
}

function cachePath(u) { return GLib.build_filenamev([cacheDir(), `${u}.json`]); }

function loadCache(u) {
    const p = cachePath(u);
    if (!GLib.file_test(p, GLib.FileTest.EXISTS)) return null;
    try {
        const [, b] = GLib.file_get_contents(p);
        return JSON.parse(new TextDecoder().decode(b));
    } catch (_) { return null; }
}

function saveCache(u, data) {
    try { GLib.file_set_contents(cachePath(u), JSON.stringify(data)); } catch (_) {}
}

function buildWeeks(contributions) {
    if (!contributions?.length) return [];
    const weeks = [];
    let cur = null;
    for (const c of contributions) {
        const dow = new Date(c.date + 'T00:00:00').getDay();
        if (!cur || dow === 0) { cur = []; weeks.push(cur); }
        cur.push(c);
    }
    return weeks;
}

export class GitHubProvider {
    constructor() {
        this._session = new Soup.Session({timeout: 20});
        this._listeners = new Set();
        this._data = new Map();
        this._wanted = new Map();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    subscribe(fn) { this._listeners.add(fn); fn(); return () => this._listeners.delete(fn); }
    _emit() { for (const fn of this._listeners) try { fn(); } catch (_) {} }
    get(username) { return this._data.get(username) ?? null; }

    watch(usernames) {
        const list = [...new Set(usernames.filter(Boolean))];
        for (const u of list) {
            this._wanted.set(u, (this._wanted.get(u) ?? 0) + 1);
            if (!this._data.has(u)) {
                const cached = loadCache(u);
                if (cached) { this._data.set(u, cached); this._emit(); }
                this._fetch(u);
            }
        }
        return () => {
            for (const u of list) {
                const n = (this._wanted.get(u) ?? 1) - 1;
                if (n <= 0) { this._wanted.delete(u); this._data.delete(u); }
                else this._wanted.set(u, n);
            }
        };
    }

    refresh() { for (const u of this._wanted.keys()) this._fetch(u); }

    _fetch(username) {
        const msg = Soup.Message.new('GET', API_URL(username));
        msg.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)');
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (src, res) => {
            try {
                const bytes = src.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK) return;
                const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                const contributions = j.contributions ?? [];
                const total = j.total?.lastYear ?? contributions.reduce((s, c) => s + c.count, 0);
                const weeks = buildWeeks(contributions);
                const data = {username, total, contributions, weeks};
                this._data.set(username, data);
                saveCache(username, data);
                this._emit();
            } catch (e) { logError(e, '[peachos-widgets] github fetch'); }
        });
    }

    destroy() {
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        this._session.abort();
        this._listeners.clear();
        this._data.clear();
        this._wanted.clear();
    }
}
