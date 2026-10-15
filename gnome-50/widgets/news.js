// News widget -- curated RSS headlines per topic, matched to the Apple News
// widget.
//
//   'square' -- one story, the image fills the squircle (painted by the glass
//               card) with the headline over a base gradient.
//   'row'    -- topic header + two stories with thumbnails.
//   'grid'   -- topic header + four stories (2x2 footprint).
//
// Topic is per-widget, changed by the pencil in edit mode. Feeds + image
// cache: lib/providers/news.js. Publication marks: icons/news/<slug>.png.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {topicName} from '../lib/providers/news.js';
import {FONT, fontStyle, Pango} from '../lib/fonts.js';

const {cairo: Cairo} = imports;

const ACCENT = {glass: '10,132,255', dark: '10,132,255', light: '0,96,223'};

export class NewsWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;                    // 'square' | 'row' | 'grid'
        this._topic = size.topic || 'top';
        this._cardMode = size.mode || 'glass';
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';
        this._accent = ACCENT[this._cardMode] || ACCENT.glass;
        this._setImage = size.setImage;
        this._iconDir = GLib.build_filenamev([ctx.path, 'icons', 'news']);

        this._root = new Clutter.Actor({
            width: size.w, height: size.h, clip_to_allocation: true,
        });
        parent.add_child(this._root);

        this._sub();
        this._midnight = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1800, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    setTopic(id) {
        if (id === this._topic)
            return;
        this._topic = id;
        this._unsub?.();
        this._sub();
    }

    _sub() {
        this._articles = this._ctx.news.get(this._topic);
        this._unsub = this._ctx.news.subscribe(this._topic, articles => {
            this._articles = articles;
            this._render();
        });
    }

    _render() {
        if (this._rendering)
            return;
        this._rendering = true;
        try {
            this._root.destroy_all_children();
            const arts = this._articles || [];
            if (this._variant === 'square')
                this._renderSquare(arts[0]);
            else
                this._renderList(arts, this._variant === 'grid' ? 4 : 2);
        } finally {
            this._rendering = false;
        }
    }

    _add(actor, x, y) {
        actor.set_position(Math.round(x), Math.round(y));
        this._root.add_child(actor);
        return actor;
    }

    _iconPath(slug) {
        for (const ext of ['png', 'svg']) {
            const p = GLib.build_filenamev([this._iconDir, `${slug}.${ext}`]);
            if (GLib.file_test(p, GLib.FileTest.EXISTS))
                return p;
        }
        return null;
    }

    // A publication mark, rendered monochrome (Apple-News style) so it's
    // legible on any card: the logo PNG's alpha is used as a mask filled with
    // the card's foreground -- white on glass/dark, near-black on light.
    _sourceMark(article, px, onLight) {
        const path = this._iconPath(article.sourceSlug);
        if (!path || path.endsWith('.svg')) {
            const l = new St.Label({
                text: (article.source || '').toUpperCase(),
                x_align: Clutter.ActorAlign.START,
                style: fontStyle(FONT.display, Math.round(px * 0.82),
                    onLight ? 0.5 : 0.6, onLight ? this._fg : '255,255,255')
                    + ' font-weight: 700;',
            });
            return l;
        }
        const tint = onLight ? [0.13, 0.13, 0.15] : [1, 1, 1];
        const area = new St.DrawingArea({
            width: Math.round(px * 8), height: Math.round(px),
            x_align: Clutter.ActorAlign.START,
        });
        area.connect('repaint', a => {
            const [, h] = a.get_surface_size();
            const cr = a.get_context();
            try {
                const png = Cairo.ImageSurface.createFromPNG(path);
                const pw = png.getWidth();
                const ph = png.getHeight();
                if (pw > 0 && ph > 0) {
                    const s = h / ph;
                    cr.scale(s, s);
                    cr.setSourceRGBA(tint[0], tint[1], tint[2], 1);
                    cr.maskSurface(png, 0, 0);
                }
            } catch (e) {
                // logo unreadable -- leave blank
            } finally {
                cr.$dispose();
            }
        });
        return area;
    }

    _newsLogo(px) {
        const path = this._iconPath('n');
        if (path) {
            return new St.Widget({
                width: px, height: px,
                style: `background-image: url("file://${path}"); background-size: contain;`,
            });
        }
        return new St.Label({
            text: 'N',
            style: `font-family: "${FONT.display}"; font-size: ${Math.round(px)}px; `
                + `font-weight: 800; color: rgba(${this._accent},1);`,
        });
    }

    _thumb(path, d) {
        const w = new St.Widget({width: d, height: d});
        const r = Math.round(d * 0.16);
        w.style = path
            ? `background-image: url("file://${path}"); background-size: cover; border-radius: ${r}px;`
            : `background-color: rgba(${this._fg},0.10); border-radius: ${r}px;`;
        return w;
    }

    // ---- square (image painted by the glass card) --------------------

    _renderSquare(a) {
        this._setImage?.(a?.imagePath || null);

        const w = this._w;
        const h = this._h;
        const m = Math.round(h * 0.09);
        const fs = Math.max(11, Math.round(h * 0.085));

        if (!a) {
            this._add(new St.Label({
                text: `${topicName(this._topic)}…`,
                style: fontStyle(FONT.display, fs, 0.9, '255,255,255'),
            }), m, h - m - fs);
            return;
        }

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: w - 2 * m,
            style: `spacing: ${Math.round(fs * 0.35)}px;`,
        });
        box.add_child(this._sourceMark(a, Math.round(fs * 0.95), false));

        const title = new St.Label({
            text: a.title,
            height: Math.round(fs * 1.24 * 3),
            style: fontStyle(FONT.display, fs, 1, '255,255,255') + ' font-weight: 700;',
        });
        title.clutter_text.line_wrap = true;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(title);

        const bh = Math.round(fs * 0.95 + fs * 0.35 + fs * 1.24 * 3);
        this._add(box, m, h - m - bh);
    }

    // ---- row / grid --------------------------------------------------

    _renderList(arts, n) {
        this._setImage?.(null);

        const w = this._w;
        const h = this._h;
        const grid = this._variant === 'grid';
        const m = Math.round(h * (grid ? 0.055 : 0.1));
        const fg = this._fg;
        const onLight = fg.startsWith('26,') || fg.startsWith('28,');

        // header
        const headFs = Math.max(12, Math.round(h * (grid ? 0.052 : 0.09)));
        const head = new St.BoxLayout({width: w - 2 * m});
        head.add_child(new St.Label({
            text: topicName(this._topic), x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, headFs, 1, this._accent) + ' font-weight: 800;',
        }));
        const logo = this._newsLogo(Math.round(headFs * 1.0));
        logo.y_align = Clutter.ActorAlign.CENTER;
        head.add_child(logo);
        this._add(head, m, m);

        const top = m + Math.round(headFs * 1.9);
        const rowH = (h - top - m) / n;

        // size text so a 2-line headline + source mark fits inside one row
        const fs = Math.max(10,
            Math.min(grid ? 17 : 14, Math.floor((rowH - 10) / 3.3)));
        const markPx = Math.round(fs * 0.9);
        const titleH = Math.round(fs * 1.26 * 2);
        const contentH = markPx + Math.round(fs * 0.3) + titleH;
        const padY = Math.max(0, (rowH - contentH) / 2);
        const d = Math.round(Math.min(rowH * 0.78, w * 0.14));

        for (let i = 0; i < n; i++) {
            const a = arts[i];
            const y0 = top + i * rowH;

            if (i > 0) {
                this._add(new St.Widget({
                    width: w - 2 * m, height: 1,
                    style: `background-color: rgba(${fg},0.10);`,
                }), m, y0);
            }
            if (!a) {
                this._add(new St.Label({
                    text: 'Loading…',
                    style: fontStyle(FONT.display, fs, 0.4, fg),
                }), m, y0 + rowH * 0.4);
                continue;
            }

            const thumbX = w - m - d;
            this._add(this._thumb(a.imagePath, d), thumbX, y0 + (rowH - d) / 2);

            const box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                width: thumbX - m - Math.round(fs * 0.7),
                style: `spacing: ${Math.round(fs * 0.3)}px;`,
            });
            box.add_child(this._sourceMark(a, markPx, onLight));
            const t = new St.Label({
                text: a.title,
                height: titleH,
                style: fontStyle(FONT.display, fs, 1, fg) + ' font-weight: 600;',
            });
            t.clutter_text.line_wrap = true;
            t.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(t);
            this._add(box, m, y0 + padY);
        }
    }

    destroy() {
        this._unsub?.();
        this._setImage?.(null);
        if (this._midnight)
            GLib.source_remove(this._midnight);
        this._midnight = 0;
        this._root.destroy();
    }
}
