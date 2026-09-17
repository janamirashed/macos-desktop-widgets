// The widget card, drawn in Cairo as a proper quintic squircle (n = 5, the
// Apple app-icon superellipse) -- not a border-radius rounded rect.
//
//   glass -- a blurred wallpaper crop (lib/wallpaperCrop.js, baked to a PNG)
//            + a translucent white tint/gradient + a hairline rim.
//   dark  -- opaque #1c1c1e, white content.
//   light -- opaque #ffffff, dark content.
//
// Always full strength; not tied to the Settings "Liquid Glass" slider.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {squirclePath} from './squircle.js';
import {buildBlurredCropFile} from './wallpaperCrop.js';

const {cairo: Cairo} = imports;

export const MARGIN = 0;
export const MODE_FG = {glass: '255,255,255', dark: '255,255,255', light: '26,27,30'};

const SQUIRCLE_N = 5;
let _cropSeq = 0;

function traceSquircle(cr, w, h, r) {
    // centred, inset 1px so a 1px stroke sits inside the bounds
    squirclePath(cr, w / 2, h / 2, w / 2 - 1, h / 2 - 1, Math.max(1, r - 1), SQUIRCLE_N, 28);
}

function paintCard(cr, w, h, radiusPx, mode, cropPath, tint, imagePath) {
    cr.save();
    traceSquircle(cr, w, h, radiusPx);
    cr.clip();

    if (imagePath) {
        // photo card (news "Story"): cover the squircle + darken toward the base
        try {
            const png = Cairo.ImageSurface.createFromPNG(imagePath);
            const pw = png.getWidth();
            const ph = png.getHeight();
            if (pw > 0 && ph > 0) {
                const s = Math.max(w / pw, h / ph);
                cr.save();
                cr.translate((w - pw * s) / 2, (h - ph * s) / 2);
                cr.scale(s, s);
                cr.setSourceSurface(png, 0, 0);
                cr.paint();
                cr.restore();
            }
        } catch (e) {
            cr.setSourceRGBA(0.15, 0.15, 0.17, 1);
            cr.paint();
        }
        const g = new Cairo.LinearGradient(0, h * 0.3, 0, h);
        g.addColorStopRGBA(0, 0, 0, 0, 0);
        g.addColorStopRGBA(1, 0, 0, 0, 0.9);
        cr.setSource(g);
        cr.paint();
        cr.restore();

        traceSquircle(cr, w, h, radiusPx);
        cr.setLineWidth(1.0);
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.stroke();
        return;
    }

    if (mode === 'glass') {
        if (cropPath) {
            try {
                const png = Cairo.ImageSurface.createFromPNG(cropPath);
                const pw = png.getWidth();
                const ph = png.getHeight();
                if (pw > 0 && ph > 0) {
                    cr.save();
                    cr.scale(w / pw, h / ph);
                    cr.setSourceSurface(png, 0, 0);
                    cr.getSource().setExtend(Cairo.Extend.PAD);
                    cr.paint();
                    cr.restore();
                }
            } catch (e) {
                // no crop yet
            }
        }
        const g = new Cairo.LinearGradient(0, 0, 0, h);
        g.addColorStopRGBA(0, 1, 1, 1, 0.26);
        g.addColorStopRGBA(1, 1, 1, 1, 0.05);
        cr.setSource(g);
        cr.paint();
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.paint();
    } else if (mode === 'light') {
        if (tint) {
            const g = new Cairo.LinearGradient(0, 0, 0, h);
            g.addColorStopRGBA(0, tint.top[0], tint.top[1], tint.top[2], 1);
            g.addColorStopRGBA(1, tint.bottom[0], tint.bottom[1], tint.bottom[2], 1);
            cr.setSource(g);
        } else {
            cr.setSourceRGBA(1, 1, 1, 1);
        }
        cr.paint();
    } else {
        cr.setSourceRGBA(0.109, 0.109, 0.118, 1); // #1c1c1e
        cr.paint();
    }
    cr.restore();

    // rim
    traceSquircle(cr, w, h, radiusPx);
    cr.setLineWidth(mode === 'glass' ? 1.3 : 1.0);
    if (mode === 'light' && tint)
        cr.setSourceRGBA(1, 1, 1, tint.dark ? 0.12 : 0.35);
    else if (mode === 'light')
        cr.setSourceRGBA(0, 0, 0, 0.1);
    else if (mode === 'dark')
        cr.setSourceRGBA(1, 1, 1, 0.12);
    else
        cr.setSourceRGBA(1, 1, 1, 0.5);
    cr.stroke();
}

export function makeLiquidGlass(opts) {
    const {innerW, innerH, x, y} = opts;
    const radius = opts.radius ?? 32;
    const mode = opts.mode ?? 'glass';
    const cropId = _cropSeq++;

    const widget = new St.Widget({
        width: innerW, height: innerH, x, y,
        reactive: false,
        layout_manager: new Clutter.BinLayout(),
    });

    let cropPath = null;
    let prevPath = null;
    let cropN = 0;
    let tint = null;       // light mode only: {top:[r,g,b], bottom:[r,g,b], dark}
    let imagePath = null;  // photo card (news Story): fills the squircle

    const card = new St.DrawingArea({x_expand: true, y_expand: true});
    card.connect('repaint', area => {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        try {
            const scale = w / Math.max(1, innerW);
            paintCard(cr, w, h, radius * scale, mode, cropPath, tint, imagePath);
        } finally {
            cr.$dispose();
        }
    });
    widget.add_child(card);

    const applyCrop = () => {
        if (mode === 'glass' && !opts.noCrop) {
            const p = buildBlurredCropFile(
                {x: widget.x, y: widget.y, w: innerW, h: innerH}, `${cropId}-${cropN++}`);
            if (p) {
                cropPath = p;
                if (prevPath && prevPath !== p) {
                    try {
                        Gio.File.new_for_path(prevPath).delete(null);
                    } catch (e) {
                        // gone
                    }
                }
                prevPath = p;
            }
        }
        card.queue_repaint();
    };
    applyCrop();

    const content = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true, y_expand: true,
    });
    widget.add_child(content);

    return {
        widget,
        content,
        mode,
        fg: MODE_FG[mode],
        setInnerPos(nx, ny) {
            widget.set_position(Math.round(nx), Math.round(ny));
        },
        refresh() {
            applyCrop();
        },
        // light mode: paint the card as a sky gradient instead of flat white.
        // Pass null to go back to white.
        setTint(t) {
            tint = t;
            card.queue_repaint();
        },
        // photo card: fill the squircle with an image (PNG path) + base
        // gradient. Pass null to go back to the normal card.
        setImage(path) {
            imagePath = path || null;
            card.queue_repaint();
        },
    };
}
