// Stocks widget -- Yahoo Finance quotes + a Cairo sparkline, matched to the
// Apple Stocks widget.
//
//   'square' -- one ticker: ticker, big price, change, sparkline.
//   'row'    -- up to 3 tickers: ticker + name, sparkline, price + change.
//
// Tickers are chosen per-widget (config: 'stocks', lib/stockPicker.js);
// defaults live in lib/providers/stocks.js. Font: SF Pro Display.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {STOCK_DEFAULTS} from '../lib/providers/stocks.js';
import {FONT, fontDesc, Pango} from '../lib/fonts.js';

const {cairo: Cairo} = imports;

const GREEN = [0.204, 0.780, 0.349];
const RED = [0.906, 0.271, 0.220];

export class StocksWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;              // 'square' | 'row'
        this._w = size.w;
        this._h = size.h;
        this._fg = (size.fg || '255,255,255').split(',').map(v => parseInt(v, 10) / 255);
        const dflt = STOCK_DEFAULTS[variant === 'row' ? 'row' : 'square'];
        this._symbols = (size.symbols && size.symbols.length)
            ? size.symbols.slice(0, variant === 'row' ? 3 : 1)
            : dflt.slice();

        this._root = new St.Widget({
            layout_manager: new Clutter.BinLayout(), width: size.w, height: size.h,
        });
        parent.add_child(this._root);
        this._area = new St.DrawingArea({x_expand: true, y_expand: true});
        this._area.connect('repaint', a => this._draw(a));
        this._root.add_child(this._area);

        this._unsub = ctx.stocks.subscribe(() => this._area.queue_repaint());
        this._unwatch = size.preview ? null : ctx.stocks.watch(this._symbols);
        this._tick = size.preview ? {destroy() {}} : {
            _id: GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 45, () => {
                this._area.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            }),
            destroy() {
                if (this._id)
                    GLib.source_remove(this._id);
                this._id = 0;
            },
        };
    }

    // Re-point the widget at a new ticker set (from the config picker).
    setSymbols(arr) {
        const next = (arr && arr.length ? arr : STOCK_DEFAULTS[this._variant === 'row' ? 'row' : 'square'])
            .slice(0, this._variant === 'row' ? 3 : 1);
        this._symbols = next;
        this._unwatch?.();
        this._unwatch = this._ctx.stocks.watch(next);
        this._area.queue_repaint();
    }

    // --- cairo helpers -------------------------------------------------

    _text(cr, str, x, y, px, rgba, {bold = false, right = false, maxW = 0} = {}) {
        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(fontDesc(FONT.display, px, bold));
        if (maxW) {
            layout.set_width(Math.round(maxW) * Pango.SCALE);
            layout.set_ellipsize(Pango.EllipsizeMode.END);
        }
        layout.set_text(str ?? '', -1);
        const [lw, lh] = layout.get_pixel_size();
        cr.setSourceRGBA(...rgba);
        cr.moveTo(right ? x - lw : x, y);
        PangoCairo.show_layout(cr, layout);
        return {w: lw, h: lh};
    }

    _triangle(cr, x, midY, s, col, up) {
        cr.setSourceRGBA(...col, 1);
        if (up) {
            cr.moveTo(x, midY + s * 0.45);
            cr.lineTo(x + s, midY + s * 0.45);
            cr.lineTo(x + s / 2, midY - s * 0.55);
        } else {
            cr.moveTo(x, midY - s * 0.45);
            cr.lineTo(x + s, midY - s * 0.45);
            cr.lineTo(x + s / 2, midY + s * 0.55);
        }
        cr.closePath();
        cr.fill();
    }

    _spark(cr, x, y, w, h, q) {
        const pts = q.spark;
        if (!pts || pts.length < 2)
            return;
        const lo = Math.min(...pts, q.prev);
        const hi = Math.max(...pts, q.prev);
        const range = (hi - lo) || 1;
        const col = q.up ? GREEN : RED;
        const yOf = v => y + h - ((v - lo) / range) * h;

        cr.save();
        cr.setDash([2, 2], 0);
        cr.setLineWidth(1);
        cr.setSourceRGBA(...col, 0.35);
        cr.moveTo(x, yOf(q.prev));
        cr.lineTo(x + w, yOf(q.prev));
        cr.stroke();
        cr.restore();

        cr.setLineWidth(1.6);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(...col, 1);
        pts.forEach((p, i) => {
            const px = x + (i / (pts.length - 1)) * w;
            if (i === 0)
                cr.moveTo(px, yOf(p));
            else
                cr.lineTo(px, yOf(p));
        });
        cr.stroke();
        cr.lineTo(x + w, y + h);
        cr.lineTo(x, y + h);
        cr.closePath();
        cr.setSourceRGBA(...col, 0.12);
        cr.fill();
    }

    // --- layouts ----------------------------------------------------

    _draw(area) {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        try {
            if (this._variant === 'row')
                this._drawRow(cr, w, h);
            else
                this._drawSquare(cr, w, h);
        } finally {
            cr.$dispose();
        }
    }

    _drawRow(cr, w, h) {
        const fg = this._fg;
        const dim = a => [fg[0], fg[1], fg[2], a];
        const m = Math.round(h * 0.085);
        const rows = this._symbols.length;
        const rowH = (h - 2 * m) / rows;
        const fs = Math.max(9, rowH * 0.27);

        this._symbols.forEach((sym, i) => {
            const q = this._ctx.stocks.get(sym);
            const top = m + i * rowH;
            const midY = top + rowH / 2;

            if (i > 0) {
                cr.setSourceRGBA(...dim(0.09));
                cr.rectangle(m, top, w - 2 * m, 1);
                cr.fill();
            }
            if (!q) {
                this._text(cr, sym, m, midY - fs * 0.6, fs, dim(0.45), {bold: true});
                return;
            }
            const col = q.up ? GREEN : RED;

            this._triangle(cr, m, midY - rowH * 0.16, fs * 0.62, col, q.up);
            const nameX = m + fs * 1.15;
            this._text(cr, q.label, nameX, midY - rowH * 0.34, fs, dim(1), {bold: true});
            this._text(cr, q.sub, nameX, midY + rowH * 0.02, fs * 0.78, dim(0.5),
                {maxW: w * 0.30});

            const sw = w * 0.16;
            const sx = m + w * 0.42;
            this._spark(cr, sx, midY - rowH * 0.28, sw, rowH * 0.56, q);

            const rx = w - m;
            this._text(cr, q.priceText, rx, midY - rowH * 0.34, fs, dim(1),
                {bold: true, right: true});
            this._text(cr, q.changeText, rx, midY + rowH * 0.02, fs * 0.82,
                [...col, 1], {right: true});
        });
    }

    _drawSquare(cr, w, h) {
        const fg = this._fg;
        const dim = a => [fg[0], fg[1], fg[2], a];
        const m = Math.round(h * 0.11);
        const sym = this._symbols[0] || 'SPY';
        const q = this._ctx.stocks.get(sym);
        const fs = Math.max(11, h * 0.085);

        if (!q) {
            this._text(cr, sym.replace(/-USD$/, '').replace(/^\^/, ''),
                m, m, fs, dim(0.5), {bold: true});
            return;
        }
        const col = q.up ? GREEN : RED;

        this._triangle(cr, m, m + fs * 0.55, fs * 0.7, col, q.up);
        this._text(cr, q.label, m + fs * 1.25, m, fs * 1.15, dim(1), {bold: true});
        this._text(cr, q.sub, m, m + fs * 1.5, fs * 0.8, dim(0.5), {maxW: w - 2 * m});

        this._text(cr, q.priceText, m, m + fs * 2.9, fs * 1.9, dim(1), {bold: true});
        this._text(cr, q.changeText, m, m + fs * 5.0, fs * 0.95, [...col, 1]);

        this._spark(cr, m, h - m - h * 0.24, w - 2 * m, h * 0.24, q);
    }

    destroy() {
        this._unsub?.();
        this._unwatch?.();
        this._tick.destroy();
        this._root.destroy();
    }
}
