// Writes a blurred PNG of the wallpaper region behind a widget rect and
// returns its path, for use as a CSS `background-image` (St clips those to
// border-radius; a Clutter content is not clipped). Shell.BlurEffect
// (BACKGROUND) captures nothing useful for an actor down in _backgroundGroup,
// so the frost is baked here: crop, downscale-hard/upscale-back (cheap box
// blur), save. Recomputed on move / resize / wallpaper change.

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BG_SCHEMA = 'org.gnome.desktop.background';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';

const CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'peachos-widgets']);

let _srcPath = null;
let _srcPixbuf = null;

function currentWallpaper() {
    const bg = new Gio.Settings({schema_id: BG_SCHEMA});
    const iface = new Gio.Settings({schema_id: INTERFACE_SCHEMA});
    const dark = iface.get_string('color-scheme') === 'prefer-dark';
    const darkUri = bg.get_string('picture-uri-dark');
    const uri = (dark && darkUri) ? darkUri : bg.get_string('picture-uri');
    let path = uri;
    try {
        path = GLib.filename_from_uri(uri)[0];
    } catch (e) {
        // already a plain path
    }
    return {path: path || null, options: bg.get_string('picture-options') || 'zoom'};
}

function loadSource(path) {
    if (path === _srcPath && _srcPixbuf)
        return _srcPixbuf;
    try {
        _srcPixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
        _srcPath = path;
    } catch (e) {
        logError(e, '[peachos-widgets] wallpaper load failed');
        _srcPixbuf = null;
        _srcPath = null;
    }
    return _srcPixbuf;
}

export function invalidateWallpaper() {
    _srcPath = null;
    _srcPixbuf = null;
}

function monitorToImage(mx, my, mw, mh, iw, ih, options) {
    if (options === 'stretched')
        return [mx / mw * iw, my / mh * ih];
    const scale = options === 'scaled'
        ? Math.min(mw / iw, mh / ih)
        : Math.max(mw / iw, mh / ih);
    const offX = (iw * scale - mw) / 2;
    const offY = (ih * scale - mh) / 2;
    return [(mx + offX) / scale, (my + offY) / scale];
}

/**
 * @param {{x,y,w,h}} rect  glass rect in stage (logical) coords
 * @param {string} id       widget id (for the cache filename)
 * @returns {string|null}   path to the blurred PNG, or null
 */
export function buildBlurredCropFile(rect, id) {
    const {path, options} = currentWallpaper();
    if (!path)
        return null;
    const src = loadSource(path);
    if (!src)
        return null;

    const iw = src.get_width();
    const ih = src.get_height();

    const monitors = Main.layoutManager.monitors;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const mon = monitors.find(m =>
        cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height)
        || Main.layoutManager.primaryMonitor;

    const [ix0, iy0] = monitorToImage(rect.x - mon.x, rect.y - mon.y, mon.width, mon.height, iw, ih, options);
    const [ix1, iy1] = monitorToImage(
        rect.x - mon.x + rect.w, rect.y - mon.y + rect.h, mon.width, mon.height, iw, ih, options);

    const sx = Math.max(0, Math.min(iw - 2, Math.round(ix0)));
    const sy = Math.max(0, Math.min(ih - 2, Math.round(iy0)));
    const sw = Math.max(2, Math.min(iw - sx, Math.round(ix1 - ix0)));
    const sh = Math.max(2, Math.min(ih - sy, Math.round(iy1 - iy0)));

    const DOWN = 10;
    let pb;
    try {
        const crop = src.new_subpixbuf(sx, sy, sw, sh);
        const lowW = Math.max(2, Math.round(sw / DOWN));
        const lowH = Math.max(2, Math.round(sh / DOWN));
        // hard down, half-down again, then back up = a soft two-pass blur
        pb = crop
            .scale_simple(lowW, lowH, GdkPixbuf.InterpType.BILINEAR)
            .scale_simple(Math.max(2, lowW >> 1), Math.max(2, lowH >> 1), GdkPixbuf.InterpType.BILINEAR)
            .scale_simple(360, Math.max(2, Math.round(360 * sh / sw)), GdkPixbuf.InterpType.BILINEAR);
    } catch (e) {
        logError(e, '[peachos-widgets] wallpaper crop/blur failed');
        return null;
    }
    if (!pb)
        return null;

    try {
        if (!GLib.file_test(CACHE_DIR, GLib.FileTest.IS_DIR))
            Gio.File.new_for_path(CACHE_DIR).make_directory_with_parents(null);
        const out = GLib.build_filenamev([CACHE_DIR, `w-${id}.png`]);
        pb.savev(out, 'png', [], []);
        return out;
    } catch (e) {
        logError(e, '[peachos-widgets] could not write blur cache');
        return null;
    }
}

export function clearCropCache() {
    try {
        const dir = Gio.File.new_for_path(CACHE_DIR);
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null)
            dir.get_child(info.get_name()).delete(null);
    } catch (e) {
        // nothing to clear
    }
}
