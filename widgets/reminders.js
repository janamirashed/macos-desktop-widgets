// Reminders widget -- open tasks from any EDS task list (iCloud / Google Tasks
// / Microsoft To Do / local), matched to the Apple Reminders widget.
//
//  'list' (square) -- "Reminders" header + a column of items
//  'wide' (row)    -- same, more items / roomier rows
//
// Each row: an open circle in the list's colour, the title, and a due chip
// (red when overdue). Font: SF Pro Display.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {formatDue} from '../lib/providers/reminders.js';
import {FONT, fontStyle, Pango} from '../lib/fonts.js';

const ACCENTS = {
    // [glass, dark, light]
    apple: [[1, 1, 1], [1, 0.624, 0.039], [0.90, 0.49, 0]],
};

export class RemindersWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;                 // 'list' | 'wide'
        this._cardMode = size.mode || 'glass';
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';
        const [g, dk, lt] = ACCENTS.apple;
        this._accent = this._cardMode === 'glass' ? g
            : (this._cardMode === 'light' ? lt : dk);
        this._accentRgb = this._accent.map(v => Math.round(v * 255)).join(',');

        this._root = new Clutter.Actor({width: size.w, height: size.h});
        parent.add_child(this._root);

        this._unsub = ctx.reminders.subscribe(() => this._render());
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 900, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
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
        const w = this._w;
        const h = this._h;
        const m = Math.round(h * 0.11);
        const ls = Math.max(11, Math.round(h * 0.072));

        const items = this._ctx.reminders.getReminders();
        const now = new Date();

        // header
        const head = new St.BoxLayout({style: `spacing: ${Math.round(ls * 0.4)}px;`});
        head.add_child(new St.Icon({
            icon_name: 'checkbox-symbolic',
            icon_size: Math.round(ls * 1.15),
            y_align: Clutter.ActorAlign.CENTER,
            style: `color: rgba(${this._accentRgb},1);`,
        }));
        head.add_child(new St.Label({
            text: 'Reminders', y_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, ls, 1, this._fg) + ' font-weight: 700;',
        }));
        if (items.length) {
            head.add_child(new St.Label({
                text: `${items.length}`, x_expand: true,
                x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER,
                style: fontStyle(FONT.display, ls, 0.5, this._fg),
            }));
        }
        this._add(head, m, m);

        const listBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: w - 2 * m,
            style: `spacing: ${Math.round(ls * 0.5)}px;`,
        });
        this._add(listBox, m, m + Math.round(ls * 1.9));

        if (!items.length) {
            listBox.add_child(new St.Label({
                text: 'All done',
                style: fontStyle(FONT.display, Math.round(ls * 0.95), 0.45, this._fg),
            }));
            return;
        }

        const rowH = Math.round(ls * 2.0);
        const maxRows = Math.max(1, Math.floor((h - m * 2 - ls * 1.9) / (rowH + ls * 0.5)));
        for (const t of items.slice(0, maxRows)) {
            const row = new St.BoxLayout({
                width: w - 2 * m, height: rowH,
                style: `spacing: ${Math.round(ls * 0.55)}px;`,
            });
            const dia = Math.round(ls * 1.05);
            const col = t.listColor || `rgb(${this._accentRgb})`;
            row.add_child(new St.Widget({
                width: dia, height: dia,
                y_align: Clutter.ActorAlign.CENTER,
                style: `border: ${Math.max(2, Math.round(dia * 0.14))}px solid ${col}; `
                    + `border-radius: ${dia}px;`,
            }));

            const text = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            });
            const title = new St.Label({
                text: t.summary || '(untitled)',
                style: fontStyle(FONT.display, Math.round(ls * 0.95), 1, this._fg),
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(title);
            if (t.due) {
                const overdue = t.due < now && !sameDay(t.due, now);
                text.add_child(new St.Label({
                    text: formatDue(t.due, t.dueAllDay),
                    style: fontStyle(FONT.display, Math.round(ls * 0.76),
                        overdue ? 1 : 0.5,
                        overdue ? '255,69,58' : this._fg),
                }));
            }
            row.add_child(text);
            listBox.add_child(row);
        }
    }

    _add(actor, x, y) {
        actor.set_position(Math.round(x), Math.round(y));
        this._root.add_child(actor);
        return actor;
    }

    destroy() {
        this._unsub?.();
        if (this._tick)
            GLib.source_remove(this._tick);
        this._tick = 0;
        this._root.destroy();
    }
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
