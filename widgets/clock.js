// Clock widgets, ported from the KDE liquidglass repo.
//
//  DigitalClock -- packages/clock-digital: a tick ring between two inset
//  squircle frames (TickRing.qml), a subtle moving highlight, and a centred
//  H:MM in Barlow Condensed that auto-shrinks to fit, with a two-dot colon.
//
//  AnalogClock -- packages/clock-analog: translucent disc, 60 pill ticks,
//  SF Pro Rounded hour numbers, pill hands, an orange (#F6A029) second hand.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {squircleRayHit} from '../lib/squircle.js';
import {FONT, fontStyle, fontDesc} from '../lib/fonts.js';

const {cairo: Cairo} = imports;

const SECOND_ORANGE = [0.965, 0.627, 0.161]; // #F6A029

class Ticker {
    constructor(intervalMs, onTick) {
        onTick();
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
    }
}

// ---------------------------------------------------------------------------
// Digital
// ---------------------------------------------------------------------------

export class DigitalClock {
    constructor(parent, size) {
        this._w = size.w;
        this._h = size.h;
        this._radius = size.radius;
        this._roundness = 5;
        this._fg = size.fg || '255,255,255';
        const glass = (size.mode || 'glass') === 'glass';
        // glass keeps the readout translucent; solid modes want it opaque
        this._digitOpacity = glass ? 0.55 : 1.0;
        this._ringBase = glass ? 0.18 : 0.30;

        this._root = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: size.w, height: size.h,
        });
        parent.add_child(this._root);

        this._ring = new St.DrawingArea({x_expand: true, y_expand: true});
        this._ring.connect('repaint', a => this._drawRing(a));
        this._root.add_child(this._ring);

        this._row = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._hour = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._min = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._colon = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dots = [new St.Widget(), new St.Widget()];
        this._dots.forEach(d => this._colon.add_child(d));
        this._row.add_child(this._hour);
        this._row.add_child(this._colon);
        this._row.add_child(this._min);
        this._root.add_child(this._row);

        this._updateTime();
        if (size.preview) {
            this._minuteTick = {destroy() {}};
            this._ringTick = {destroy() {}};
        } else {
            this._minuteTick = new Ticker(1000, () => this._updateTime());
            // fast enough for a visibly moving comet trail on the tick ring
            this._ringTick = new Ticker(90, () => this._ring.queue_repaint());
        }
    }

    _updateTime() {
        const now = GLib.DateTime.new_now_local();
        const h = `${((now.get_hour() + 11) % 12) + 1}`;
        const m = now.format('%M');

        // KDE: target 0.60*minSide, shrink to fit the interior (edge inset
        // + tick + pad = ~15% each side).
        const minSide = Math.min(this._w, this._h);
        const availW = this._w - 2 * minSide * 0.15;
        let px = minSide * 0.6;
        const estW = (h.length + m.length) * 0.46 * px + 0.55 * px;
        if (estW > availW)
            px *= availW / estW;
        px = Math.round(px);

        this._hour.text = h;
        this._min.text = m;
        this._hour.style = fontStyle(FONT.clock, px, this._digitOpacity, this._fg);
        this._min.style = fontStyle(FONT.clock, px, this._digitOpacity, this._fg);

        const dot = Math.max(3, Math.round(px * 0.10));
        this._colon.style = `spacing: ${Math.round(dot * 1.35)}px; `
            + `margin: 0 ${Math.round(px * 0.12)}px;`;
        this._dots.forEach(d => {
            d.set_size(dot, dot);
            d.style = `background-color: rgba(${this._fg},${this._digitOpacity}); `
                + `border-radius: ${dot}px;`;
        });
    }

    // Ported from TickRing.qml: 60 ticks between two inset squircle frames,
    // corner ticks pulled out, plus the comet-trail second indicator -- a
    // bright head at the current second with a 270deg fade behind it.
    _drawRing(area) {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        try {
            const cx = w / 2;
            const cy = h / 2;
            const minSide = Math.min(w, h);
            const n = Math.max(this._roundness, 2.0);
            const scale = w / Math.max(1, this._w);
            const radius = this._radius * scale;
            const base = this._ringBase;
            const [cr0, cg0, cb0] = this._rgb();

            const outerInsetPx = 0.05 * minSide;
            const innerPad = (0.05 + 0.026) * minSide;
            const cornerExtPx = 0.012 * minSide;
            const trailDeg = 270;

            // continuous second position 0..60
            const pos = (Date.now() % 60000) / 1000;
            const curIdx = Math.floor(pos) % 60;
            const prevIdx = (curIdx - 1 + 60) % 60;
            const fadeT = pos - Math.floor(pos);
            const sHead = fadeT * fadeT * (3 - 2 * fadeT);

            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(2.2 * scale);

            for (let i = 0; i < 60; i++) {
                const rad = i * 6 * Math.PI / 180;
                const dx = Math.sin(rad);
                const dy = -Math.cos(rad);
                const cornerBlend = 1 - Math.abs(Math.abs(dx) - Math.abs(dy));
                const tickOuterInset = Math.max(0, outerInsetPx - cornerExtPx * cornerBlend);

                const [ox, oy] = squircleRayHit(dx, dy,
                    Math.max(1, w / 2 - tickOuterInset),
                    Math.max(1, h / 2 - tickOuterInset),
                    Math.max(0, radius - tickOuterInset), n);
                const [ix, iy] = squircleRayHit(dx, dy,
                    Math.max(1, w / 2 - innerPad),
                    Math.max(1, h / 2 - innerPad),
                    Math.max(0, radius - innerPad), n);

                let s = 0;
                if (i === curIdx) {
                    s = sHead;
                } else {
                    const off = ((prevIdx * 6) - (i * 6) + 360) % 360;
                    if (off <= trailDeg)
                        s = Math.pow(1 - off / trailDeg, 0.6);
                }
                const op = base + (1 - base) * s;

                cr.setSourceRGBA(cr0, cg0, cb0, op);
                cr.moveTo(cx + ix, cy + iy);
                cr.lineTo(cx + ox, cy + oy);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }

    _rgb() {
        return this._fg.split(',').map(v => parseInt(v, 10) / 255);
    }

    destroy() {
        this._minuteTick.destroy();
        this._ringTick.destroy();
        this._root.destroy();
    }
}

// ---------------------------------------------------------------------------
// Analog -- 'minimal' = clock-analog-2 (12 pill hour-lines). 'classic' =
// clock-analog (60 ticks + numbers + white face). 'fullface' = clock-analog-3
// (no plate: the whole squircle card is the face, ticks follow the perimeter,
// only 12/3/6/9 numerals).
// ---------------------------------------------------------------------------

export class AnalogClock {
    constructor(parent, size, style) {
        this._fg = size.fg || '255,255,255';
        this._mode = size.mode || 'glass';
        this._style = style || 'minimal';
        this._radius = size.radius || 48;
        this._roundness = 5;
        this._logicalW = size.w;

        this._root = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: size.w, height: size.h,
        });
        parent.add_child(this._root);

        this._face = new St.DrawingArea({x_expand: true, y_expand: true});
        this._face.connect('repaint', a => this._draw(a));
        this._root.add_child(this._face);

        this._tick = size.preview
            ? {destroy() {}}
            : new Ticker(1000, () => this._face.queue_repaint());
    }

    _rgb(a = 1) {
        const [r, g, b] = this._fg.split(',').map(v => parseInt(v, 10) / 255);
        return [r, g, b, a];
    }

    _draw(area) {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        try {
            if (this._style === 'fullface') {
                this._drawFullface(cr, w, h);
                return;
            }
            const cx = w / 2;
            const cy = h / 2;
            const inset = Math.min(w, h) * 0.08;
            const r = Math.min(w, h) / 2 - inset;

            // 'classic' forces a white face + black dial (KDE _realLight look);
            // 'minimal' follows the card mode.
            const classic = this._style === 'classic';
            const whiteFace = classic ? this._mode !== 'glass' : this._mode === 'light';
            // dial (ticks / numbers / hands) colour, as [r,g,b]
            const dial = whiteFace ? [0, 0, 0]
                : (classic && this._mode === 'glass' ? [1, 1, 1] : this._rgb().slice(0, 3));
            const D = (a = 1) => [dial[0], dial[1], dial[2], a];

            // --- clock plate (circle) ---
            if (classic) {
                if (this._mode === 'glass')
                    cr.setSourceRGBA(1, 1, 1, 0.20);
                else
                    cr.setSourceRGBA(1, 1, 1, 1); // white face
            } else if (this._mode === 'glass') {
                cr.setSourceRGBA(...this._rgb(0.20));
            } else if (this._mode === 'light') {
                cr.setSourceRGBA(1, 1, 1, 1);
            } else {
                cr.setSourceRGBA(0.204, 0.204, 0.212, 1); // #343436
            }
            cr.arc(cx, cy, r, 0, 2 * Math.PI);
            cr.fill();

            const tickW = r * 0.020;
            const outerR = r - tickW * 2;              // 0.96 r
            const innerR = outerR - r * 0.09;          // 0.87 r
            const minuteLen = (outerR + innerR) / 2;   // 0.915 r
            const hourLen = minuteLen * 0.65;          // 0.595 r

            if (classic) {
                // 60 pill ticks, alpha 0.75 major / 0.30 minor
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setLineWidth(tickW);
                for (let i = 0; i < 60; i++) {
                    cr.setSourceRGBA(...D(i % 5 === 0 ? 0.75 : 0.30));
                    const a = i * 6 * Math.PI / 180;
                    const s = Math.sin(a);
                    const c = -Math.cos(a);
                    cr.moveTo(cx + s * innerR, cy + c * innerR);
                    cr.lineTo(cx + s * outerR, cy + c * outerR);
                    cr.stroke();
                }
                // 12 hour numbers, SF Pro Rounded
                const dist = r * 0.72;
                const fs = Math.max(8, r * 0.17);
                const layout = PangoCairo.create_layout(cr);
                layout.set_font_description(fontDesc(FONT.rounded, fs));
                for (let n = 1; n <= 12; n++) {
                    const a = (n / 12) * 2 * Math.PI;
                    layout.set_text(`${n}`, -1);
                    const [lw, lh] = layout.get_pixel_size();
                    cr.setSourceRGBA(...D(this._mode === 'glass' ? 0.85 : 1));
                    cr.moveTo(cx + Math.sin(a) * dist - lw / 2, cy - Math.cos(a) * dist - lh / 2);
                    PangoCairo.show_layout(cr, layout);
                }
            } else {
                // 12 pill hour lines
                const lineW = r * 0.0336 * 0.9 * 1.15 * 1.35;
                const lineLen = hourLen * 0.40 * 0.90 * 1.10;
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setLineWidth(lineW);
                cr.setSourceRGBA(...D(0.75));
                for (let i = 0; i < 12; i++) {
                    const a = i * 30 * Math.PI / 180;
                    const s = Math.sin(a);
                    const c = -Math.cos(a);
                    cr.moveTo(cx + s * outerR, cy + c * outerR);
                    cr.lineTo(cx + s * (outerR - lineLen), cy + c * (outerR - lineLen));
                    cr.stroke();
                }
            }

            const now = GLib.DateTime.new_now_local();
            const sec = now.get_second();
            const min = now.get_minute() + sec / 60;
            const hr = (now.get_hour() % 12) + min / 60;

            const isGlass = this._mode === 'glass';
            const hand = D(isGlass ? 0.92 : 1.0);
            // second hand + hinge: orange in solid modes, translucent white
            // ("liquid glass") in glass mode
            const second = isGlass ? D(0.9) : [...SECOND_ORANGE, 1];

            // pill hand: thin stem (rect) + capsule (thick round-capped stroke)
            const drawHand = (turns, totalLen) => {
                cr.save();
                cr.translate(cx, cy);
                cr.rotate(turns * 2 * Math.PI);
                cr.setSourceRGBA(...hand);
                const stemEnd = r * 0.15;
                const stemW = r * 0.0336;
                cr.rectangle(-stemW / 2, -stemEnd, stemW, stemEnd);
                cr.fill();
                cr.setLineCap(Cairo.LineCap.ROUND);
                cr.setLineWidth(r * 0.065);
                cr.moveTo(0, -stemEnd);
                cr.lineTo(0, -totalLen);
                cr.stroke();
                cr.restore();
            };
            drawHand(hr / 12, hourLen);
            drawHand(min / 60, minuteLen);

            // pivot
            cr.setSourceRGBA(...hand);
            cr.arc(cx, cy, r * 0.05, 0, 2 * Math.PI);
            cr.fill();

            // second hand (with counterweight tail)
            cr.save();
            cr.translate(cx, cy);
            cr.rotate((sec / 60) * 2 * Math.PI);
            cr.setSourceRGBA(...second);
            const shw = r * 0.007 * 1.3;
            cr.rectangle(-shw, -outerR, shw * 2, outerR + r * 0.15);
            cr.fill();
            cr.restore();

            // hinge dot (on top)
            cr.setSourceRGBA(...second);
            cr.arc(cx, cy, r * 0.035, 0, 2 * Math.PI);
            cr.fill();
        } finally {
            cr.$dispose();
        }
    }

    // clock-analog-3: the whole squircle card IS the face. No plate. 60 ticks
    // hug the perimeter, hour ticks reach a fixed inner circle. Numerals 12/3/6/9.
    _drawFullface(cr, w, h) {
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) / 2;
        const scale = w / Math.max(1, this._logicalW);
        const n = Math.max(this._roundness, 2);
        const radius = this._radius * scale;
        const glass = this._mode === 'glass';
        const dial = glass ? this._rgb().slice(0, 3)
            : (this._mode === 'light' ? [0.102, 0.106, 0.118] : [1, 1, 1]);
        const D = (a = 1) => [dial[0], dial[1], dial[2], a];

        // --- HourDial: 60 perimeter ticks ---
        const outerInset = 0.05 * (2 * R);
        const innerPad = (0.05 + 0.026) * (2 * R);
        const cornerExt = 0.012 * (2 * R);
        const circleR = 0.699 * R;
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let i = 0; i < 60; i++) {
            const rad = i * 6 * Math.PI / 180;
            const dx = Math.sin(rad);
            const dy = -Math.cos(rad);
            const cornerBlend = 1 - Math.abs(Math.abs(dx) - Math.abs(dy));
            const oInset = Math.max(0, outerInset - cornerExt * cornerBlend);

            const [ox, oy] = squircleRayHit(dx, dy,
                Math.max(1, w / 2 - oInset), Math.max(1, h / 2 - oInset),
                Math.max(0, radius - oInset), n);
            const isHour = i % 5 === 0;
            let ix;
            let iy;
            if (isHour) {
                const circX = dx * circleR;
                const circY = dy * circleR;
                ix = circX + (ox - circX) * 0.10;
                iy = circY + (oy - circY) * 0.10;
            } else {
                [ix, iy] = squircleRayHit(dx, dy,
                    Math.max(1, w / 2 - innerPad), Math.max(1, h / 2 - innerPad),
                    Math.max(0, radius - innerPad), n);
            }
            cr.setLineWidth((isHour ? 2.2 * 1.3225 : 2.2) * scale);
            cr.setSourceRGBA(...D(isHour
                ? (glass ? 0.85 : 1.0)
                : (glass ? 0.24 : 0.30)));
            cr.moveTo(cx + ix, cy + iy);
            cr.lineTo(cx + ox, cy + oy);
            cr.stroke();
        }

        // --- 12 / 3 / 6 / 9 numerals ---
        const faceR = R - Math.min(w, h) * 0.08; // 0.84 R
        const dist = faceR * 0.64;
        const fs = Math.max(10, faceR * 0.238);
        const layout = PangoCairo.create_layout(cr);
        layout.set_font_description(fontDesc(FONT.rounded, fs));
        for (const num of [12, 3, 6, 9]) {
            const pos = num === 12 ? 0 : num;
            const a = (pos / 12) * 2 * Math.PI;
            layout.set_text(`${num}`, -1);
            const [lw, lh] = layout.get_pixel_size();
            cr.setSourceRGBA(...D(glass ? 0.85 : 1));
            cr.moveTo(cx + Math.sin(a) * dist - lw / 2, cy - Math.cos(a) * dist - lh / 2);
            PangoCairo.show_layout(cr, layout);
        }

        // --- hands (r rebased to face radius) ---
        const r = R * 0.84;
        const tickW = r * 0.020;
        const outerR = r - tickW * 2;
        const innerR = outerR - r * 0.09;
        const minuteLen = ((outerR + innerR) / 2) * 1.15;
        const hourLen = minuteLen * 0.65;

        const now = GLib.DateTime.new_now_local();
        const sec = now.get_second();
        const min = now.get_minute() + sec / 60;
        const hr = (now.get_hour() % 12) + min / 60;
        const hand = D(glass ? 0.92 : 1.0);
        const second = glass ? D(0.9) : [...SECOND_ORANGE, 1];

        const drawHand = (turns, totalLen) => {
            cr.save();
            cr.translate(cx, cy);
            cr.rotate(turns * 2 * Math.PI);
            cr.setSourceRGBA(...hand);
            cr.rectangle(-(r * 0.0336) / 2, -(r * 0.15), r * 0.0336, r * 0.15);
            cr.fill();
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineWidth(r * 0.065);
            cr.moveTo(0, -(r * 0.15));
            cr.lineTo(0, -totalLen);
            cr.stroke();
            cr.restore();
        };
        drawHand(hr / 12, hourLen);
        drawHand(min / 60, minuteLen);

        cr.setSourceRGBA(...hand);
        cr.arc(cx, cy, r * 0.05, 0, 2 * Math.PI);
        cr.fill();

        // second hand: tip at R * 0.90
        cr.save();
        cr.translate(cx, cy);
        cr.rotate((sec / 60) * 2 * Math.PI);
        cr.setSourceRGBA(...second);
        const shw = R * 0.007 * 1.3 * 0.84;
        cr.rectangle(-shw, -(R * 0.9), shw * 2, R * 0.9 + R * 0.15 * 0.84);
        cr.fill();
        cr.restore();

        cr.setSourceRGBA(...second);
        cr.arc(cx, cy, R * 0.035, 0, 2 * Math.PI);
        cr.fill();
    }

    destroy() {
        this._tick.destroy();
        this._root.destroy();
    }
}
