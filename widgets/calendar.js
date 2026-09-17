// Calendar widget, matched to the KDE liquidglass repo (packages/calendar).
//
//  'month'  -- accent uppercase month header, S M T W T F S with weekend
//   dimming, a 6x7 grid filling the widget, today = a filled white circle with
//   the day number punched out (Cairo DEST_OUT) so the glass shows through.
//  'agenda' -- wide: the grid on the right, an events list on the left with
//   Events today / This week / Upcoming sections and colour-pilled cards.
//
// Events from lib/providers/calendar.js. Font: SF Pro Display.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {formatEventTime} from '../lib/providers/calendar.js';
import {openAccountSettings} from '../lib/providers/edsCalendar.js';
import {FONT, fontStyle, fontDesc, Pango} from '../lib/fonts.js';

// accent per brand: [glass, dark, light] rgb triplets (0-1)
const ACCENTS = {
    apple: [[1, 1, 1], [1, 0.231, 0.188], [0.843, 0, 0.082]],
    google: [[1, 1, 1], [0.259, 0.522, 0.957], [0.102, 0.451, 0.910]],
};

const {cairo: Cairo} = imports;

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
    'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Tomorrow" / "Wed" / "Sep 22" relative to today
function relDay(date) {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((t0 - d0) / 86400000);
    if (days === 1)
        return 'Tomorrow';
    if (days > 1 && days < 7)
        return date.toLocaleDateString(undefined, {weekday: 'long'});
    return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

// Today marker: a filled circle in the accent colour. Glass mode punches the
// day number out (Cairo DEST_OUT) so the backdrop shows through; solid modes
// draw a white number over the accent fill.
class TodayBadge {
    constructor(diameter, dayNumber, fontPx, cardMode, accent) {
        this.actor = new St.DrawingArea({width: diameter, height: diameter});
        this._day = dayNumber;
        this._fs = fontPx;
        this._punch = cardMode === 'glass';
        this._accent = accent; // [r,g,b]
        this.actor.connect('repaint', a => this._draw(a));
    }

    _draw(area) {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        try {
            cr.setSourceRGBA(this._accent[0], this._accent[1], this._accent[2], 1);
            cr.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, 2 * Math.PI);
            cr.fill();

            const layout = PangoCairo.create_layout(cr);
            layout.set_font_description(fontDesc(FONT.display, this._fs, true));
            layout.set_text(`${this._day}`, -1);
            const [lw, lh] = layout.get_pixel_size();
            if (this._punch) {
                cr.setOperator(Cairo.Operator.DEST_OUT);
            } else {
                cr.setOperator(Cairo.Operator.OVER);
                cr.setSourceRGBA(1, 1, 1, 1);
            }
            cr.moveTo((w - lw) / 2, (h - lh) / 2);
            PangoCairo.show_layout(cr, layout);
            cr.setOperator(Cairo.Operator.OVER);
        } finally {
            cr.$dispose();
        }
    }
}

export class CalendarWidget {
    constructor(parent, ctx, size, variant, opts = {}) {
        this._ctx = ctx;
        this._variant = variant;                 // 'month' | 'agenda'
        this._brand = opts.brand || 'apple';     // 'apple' | 'google'
        this._source = this._brand === 'google' ? ctx.gcal : ctx.calendar;
        this._cardMode = size.mode || 'glass';   // 'glass' | 'dark' | 'light'
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';
        // header + today badge use the accent -- white in glass, the brand
        // colour in solid modes (Apple red / Google blue).
        const [g, dk, lt] = ACCENTS[this._brand] || ACCENTS.apple;
        this._accent = this._cardMode === 'glass' ? g
            : (this._cardMode === 'light' ? lt : dk);
        this._accentRgb = this._accent.map(v => Math.round(v * 255)).join(',');

        this._root = new Clutter.Actor({
            width: size.w, height: size.h, clip_to_allocation: true,
        });
        parent.add_child(this._root);

        this._unsub = this._source.subscribe(() => this._render());
        this._midnight = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1800, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _add(actor, x, y) {
        actor.set_position(Math.round(x), Math.round(y));
        this._root.add_child(actor);
        return actor;
    }

    _render() {
        if (this._rendering)
            return;
        this._rendering = true;
        try {
            this._renderInner();
        } finally {
            this._rendering = false;
        }
    }

    _renderInner() {
        this._root.destroy_all_children();

        if (this._brand === 'google' && this._source && !this._source.connected) {
            this._renderConnect();
            return;
        }

        const today = new Date();
        const ls = Math.max(11, Math.round(this._h * 0.058));

        const gridW = this._variant === 'agenda' ? Math.round(this._w * 0.46) : this._w;
        const gridX = this._variant === 'agenda' ? this._w - gridW : 0;
        this._renderGrid(gridX, gridW, ls, today);

        if (this._variant === 'agenda')
            this._renderAgenda(0, this._w - gridW, ls, today);
    }

    // Shown until a Google account with a calendar is connected. The whole
    // card is the button (it stays clickable outside edit mode).
    _renderConnect() {
        const fs = Math.max(11, Math.round(this._h * 0.06));
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${Math.round(fs * 0.42)}px;`,
        });
        box.add_child(new St.Icon({
            icon_name: 'goa-account-google-symbolic',
            icon_size: Math.round(fs * 2),
            x_align: Clutter.ActorAlign.CENTER,
            style: `color: rgba(${this._accentRgb},1);`,
        }));
        box.add_child(new St.Label({
            text: 'Connect Google Calendar',
            x_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, fs, 1, this._fg),
        }));
        const sub = new St.Label({
            text: 'Tap to add your Google account',
            x_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, Math.round(fs * 0.82), 0.55, this._fg),
        });
        sub.clutter_text.line_wrap = true;
        box.add_child(sub);

        const card = new St.Button({
            width: this._w, height: this._h,
            reactive: true, can_focus: true,
            style_class: 'peachos-gcal-connect',
        });
        card.set_child(box);
        card.connect('clicked', () => openAccountSettings());
        this._root.add_child(card);
    }

    _renderGrid(originX, areaW, ls, today) {
        const padX = Math.round(this._w * 0.05);
        const padTop = Math.round(this._h * 0.11);
        const padBottom = Math.round(this._h * 0.07);
        const x0 = originX + (this._variant === 'agenda' ? Math.round(areaW * 0.04) : padX);
        const innerW = areaW - 2 * (this._variant === 'agenda' ? Math.round(areaW * 0.04) : padX);
        const colW = innerW / 7;
        let y = padTop;

        // Month header, left-edge roughly over the first weekday column.
        const header = new St.Label({
            text: MONTHS[today.getMonth()],
            style: fontStyle(FONT.display, ls, 1, this._accentRgb),
        });
        // left edge aligned with the "S" of the Sunday column
        this._add(header, x0 + colW / 2 - ls * 0.32, y);
        y += Math.round(ls * 1.6);

        // Weekday row
        for (let c = 0; c < 7; c++) {
            const weekend = c === 0 || c === 6;
            const wl = new St.Label({
                text: WEEKDAYS[c],
                style: fontStyle(FONT.display, ls, weekend ? 0.45 : 0.75, this._fg),
            });
            this._add(wl, x0 + c * colW + colW / 2 - ls * 0.32, y);
        }
        y += Math.round(ls * 1.55);

        // Day grid -- rows sized to the month's actual week count so it fills
        // the widget (months span 4-6 weeks).
        const gridH = this._h - padBottom - y;
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        const offset = first.getDay();
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const numRows = Math.ceil((offset + daysInMonth) / 7);
        const rowH = gridH / numRows;

        for (let day = 1; day <= daysInMonth; day++) {
            const slot = offset + day - 1;
            const col = slot % 7;
            const rowN = Math.floor(slot / 7);
            const cx = x0 + col * colW + colW / 2;
            const cy = y + rowN * rowH + rowH / 2;
            const weekend = col === 0 || col === 6;
            const isToday = sameDay(new Date(today.getFullYear(), today.getMonth(), day), today);

            if (isToday) {
                const dia = Math.round(Math.min(colW, rowH) * 0.95);
                const badge = new TodayBadge(dia, day, ls, this._cardMode, this._accent);
                this._add(badge.actor, cx - dia / 2, cy - dia / 2);
            } else {
                const dl = new St.Label({
                    text: `${day}`,
                    style: fontStyle(FONT.display, ls, weekend ? 0.45 : 1, this._fg),
                });
                this._add(dl, cx - ls * 0.32, cy - ls * 0.62);
            }
        }
    }

    _renderAgenda(originX, areaW, ls, today) {
        const m = Math.round(this._h * 0.09);
        // A clipped, scrollable column -- contained in the card, no scrollbar.
        const scroll = new St.ScrollView({
            width: areaW - 2 * m,
            height: this._h - 2 * m,
            style_class: 'peachos-cal-scroll',
            reactive: true,
            x_expand: false, y_expand: false,
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        try {
            scroll.overlay_scrollbars = true;
        } catch (e) {
            // older St
        }
        const list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style: `spacing: ${Math.round(this._h * 0.022)}px;`,
        });
        scroll.set_child(list);
        this._add(scroll, originX + m, m);

        const now = new Date();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endToday = new Date(startToday);
        endToday.setDate(endToday.getDate() + 1);
        const end = new Date(startToday);
        end.setDate(end.getDate() + 30);

        const all = this._source.getEvents(startToday, end);

        const todays = all
            .filter(ev => ev.date < endToday && ev.end > startToday)
            .sort((a, b) => a.date - b.date);

        // Upcoming: the next occurrence of each distinct event -- a daily
        // recurring event collapses to one row, not thirty.
        const seen = new Set();
        const upcoming = [];
        for (const ev of all.filter(ev => ev.date >= endToday).sort((a, b) => a.date - b.date)) {
            const key = `${ev.summary || ''}|${ev.date.getHours()}:${ev.date.getMinutes()}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            upcoming.push(ev);
        }

        const heading = text => {
            list.add_child(new St.Label({
                text,
                style: fontStyle(FONT.display, ls, 0.55, this._fg) + ' padding-top: 4px;',
            }));
        };
        const emptyLine = text => {
            list.add_child(new St.Label({
                text,
                style: fontStyle(FONT.display, Math.round(ls * 0.9), 0.4, this._fg),
            }));
        };

        heading('Events today');
        if (todays.length) {
            for (const ev of todays)
                list.add_child(this._eventCard(ev, formatEventTime(ev), ls));
        } else {
            emptyLine('No events today');
        }

        if (upcoming.length) {
            heading('Upcoming');
            for (const ev of upcoming.slice(0, 6))
                list.add_child(this._eventCard(ev, relDay(ev.date), ls));
        }
    }

    _eventCard(ev, timeText, ls) {
        const rowH = Math.round(ls * 2.3);
        const card = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true, height: rowH,
            style: `background-color: rgba(255,255,255,0.10); border-radius: ${Math.round(ls * 0.55)}px;`,
        });
        const inner = new St.BoxLayout({
            x_expand: true,
            style: `padding: 0 ${Math.round(ls * 0.55)}px; spacing: ${Math.round(ls * 0.45)}px;`,
        });
        inner.add_child(new St.Widget({
            width: 3, height: Math.round(rowH * 0.55),
            y_align: Clutter.ActorAlign.CENTER,
            style: `background-color: ${ev.allDay ? '#FF9500' : '#4B9EFF'}; border-radius: 2px;`,
        }));
        const title = new St.Label({
            text: ev.summary || '(untitled)', x_expand: true,
            style: fontStyle(FONT.display, Math.round(ls * 0.92), 1, this._fg),
        });
        title.y_align = Clutter.ActorAlign.CENTER;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        inner.add_child(title);
        const time = new St.Label({
            text: timeText,
            style: fontStyle(FONT.display, Math.round(ls * 0.78), 0.6, this._fg),
        });
        time.y_align = Clutter.ActorAlign.CENTER;
        inner.add_child(time);
        card.add_child(inner);
        return card;
    }

    destroy() {
        this._unsub?.();
        if (this._midnight)
            GLib.source_remove(this._midnight);
        this._midnight = 0;
        this._root.destroy();
    }
}
