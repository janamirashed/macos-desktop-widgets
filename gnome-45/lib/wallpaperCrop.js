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

    // Padding in wallpaper image pixels for seamless optical edge diffusion
    const scaleX = iw / mon.width;
    const scaleY = ih / mon.height;
    const padX = Math.round(rect.w * 0.18 * scaleX);
    const padY = Math.round(rect.h * 0.18 * scaleY);

    const sx = Math.max(0, Math.min(iw - 2, Math.round(ix0 - padX)));
    const sy = Math.max(0, Math.min(ih - 2, Math.round(iy0 - padY)));
    const sw = Math.max(4, Math.min(iw - sx, Math.round(ix1 - ix0 + 2 * padX)));
    const sh = Math.max(4, Math.min(ih - sy, Math.round(iy1 - iy0 + 2 * padY)));

    let pb;
    try {
        const crop = src.new_subpixbuf(sx, sy, sw, sh);
        const targetW = Math.max(200, Math.round(rect.w * 2));
        const targetH = Math.max(200, Math.round(rect.h * 2));

        const BILINEAR = GdkPixbuf.InterpType.BILINEAR;
        const HYPER = GdkPixbuf.InterpType.HYPER;

        // Progressive multi-pass downscale & upscale for smooth Gaussian frosted blur
        const w1 = Math.max(16, Math.round(sw * 0.28));
        const h1 = Math.max(16, Math.round(sh * 0.28));
        const w2 = Math.max(10, Math.round(sw * 0.12));
        const h2 = Math.max(10, Math.round(sh * 0.12));
        const w3 = Math.max(6, Math.round(sw * 0.05));
        const h3 = Math.max(6, Math.round(sh * 0.05));

        const p1 = crop.scale_simple(w1, h1, BILINEAR);
        const p2 = p1.scale_simple(w2, h2, BILINEAR);
        const p3 = p2.scale_simple(w3, h3, BILINEAR);
        const p4 = p3.scale_simple(w2, h2, BILINEAR);
        const p5 = p4.scale_simple(w1, h1, BILINEAR);

        const padRatioX = padX / Math.max(1, sw);
        const padRatioY = padY / Math.max(1, sh);

        const fullW = Math.round(targetW / (1 - 2 * padRatioX));
        const fullH = Math.round(targetH / (1 - 2 * padRatioY));
        const blurredPadded = p5.scale_simple(fullW, fullH, HYPER || BILINEAR);

        // Crop off the padding so only the centered widget area is saved
        const cropX = Math.max(0, Math.round(padRatioX * fullW));
        const cropY = Math.max(0, Math.round(padRatioY * fullH));
        const finalW = Math.min(targetW, blurredPadded.get_width() - cropX * 2);
        const finalH = Math.min(targetH, blurredPadded.get_height() - cropY * 2);

        pb = blurredPadded.new_subpixbuf(cropX, cropY, Math.max(2, finalW), Math.max(2, finalH));
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
