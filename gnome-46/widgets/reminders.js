// Reminders widget -- open tasks from any EDS task list (iCloud / Google Tasks
// / Microsoft To Do / local), matched to the Apple Reminders widget.
// Supports live inline addition of tasks and ticking off/completing tasks in real-time.
// Styled to match the system display accent color.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {formatDue} from '../lib/providers/reminders.js';
import {FONT, fontStyle, Pango} from '../lib/fonts.js';

export class RemindersWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;                 // 'list' | 'wide'
        this._cardMode = size.mode || 'glass';
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';
        this._showInput = false;

        this._root = new Clutter.Actor({width: size.w, height: size.h});
        parent.add_child(this._root);

        this._unsub = ctx.reminders.subscribe(() => this._render());
        if (ctx.accentColor)
            this._unsubAccent = ctx.accentColor.subscribe(() => this._render());

        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 900, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getAccentRgb() {
        if (this._ctx.accentColor)
            return this._ctx.accentColor.rgb;
        return '213, 97, 153'; // fallback pink
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
        const accentRgb = this._getAccentRgb();

        const items = this._ctx.reminders.getReminders();
        const now = new Date();

        // Header
        const head = new St.BoxLayout({
            width: w - 2 * m,
            style: `spacing: ${Math.round(ls * 0.4)}px;`,
        });

        const headTitle = new St.Label({
            text: 'Reminders',
            y_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, ls, 1, this._fg) + ' font-weight: 700;',
        });
        headTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        head.add_child(headTitle);

        const rightBox = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: ${Math.round(ls * 0.5)}px;`,
        });

        if (items.length) {
            rightBox.add_child(new St.Label({
                text: `${items.length}`,
                y_align: Clutter.ActorAlign.CENTER,
                style: fontStyle(FONT.display, ls, 0.5, this._fg),
            }));
        }

        // Live Add button (+)
        const addBtn = new St.Button({
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: `padding: 1px 6px; border-radius: 999px; background-color: rgba(255,255,255,0.12);`,
        });
        addBtn.set_child(new St.Label({
            text: this._showInput ? '✕' : '+',
            style: fontStyle(FONT.display, Math.round(ls * 0.95), 0.9, this._fg) + ' font-weight: 700;',
        }));
        addBtn.connect('clicked', () => {
            this._showInput = !this._showInput;
            this._render();
        });
        rightBox.add_child(addBtn);
        head.add_child(rightBox);

        this._add(head, m, m);

        const listBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: `spacing: ${Math.round(ls * 0.45)}px;`,
        });

        // Wrap listBox in a ScrollView for overflow scrolling
        const scrollView = new St.ScrollView({
            width: w - 2 * m,
            height: h - m * 2 - Math.round(ls * 1.9),
            style_class: 'peachos-reminders-scroll',
            reactive: true,
            x_expand: false, y_expand: false,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        try {
            scrollView.overlay_scrollbars = true;
        } catch (_e) {
            // older St
        }
        scrollView.set_child(listBox);
        this._add(scrollView, m, m + Math.round(ls * 1.9));

        // Inline entry if adding a reminder
        if (this._showInput) {
            const inputRow = new St.BoxLayout({
                width: w - 2 * m,
                style: `spacing: ${Math.round(ls * 0.55)}px; margin-bottom: 4px;`,
            });
            const dia = Math.round(ls * 1.05);
            inputRow.add_child(new St.Widget({
                width: dia, height: dia,
                y_align: Clutter.ActorAlign.CENTER,
                style: `border: 2px dashed rgb(${accentRgb}); border-radius: ${dia}px;`,
            }));

            const entry = new St.Entry({
                hint_text: 'New Reminder…',
                can_focus: true,
                x_expand: true,
                style: `background-color: rgba(255,255,255,0.12); border: 1px solid rgb(${accentRgb}); `
                    + `border-radius: 8px; padding: 2px 8px; color: #ffffff; font-size: ${Math.round(ls * 0.9)}px;`,
            });

            entry.clutter_text.connect('key-press-event', (_o, ev) => {
                const sym = ev.get_key_symbol();
                if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) {
                    const txt = entry.get_text().trim();
                    if (txt) {
                        this._ctx.reminders.createReminder(txt);
                        this._showInput = false;
                        this._render();
                    }
                    return Clutter.EVENT_STOP;
                } else if (sym === Clutter.KEY_Escape) {
                    this._showInput = false;
                    this._render();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            inputRow.add_child(entry);
            listBox.add_child(inputRow);

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                entry.clutter_text.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
        }

        if (!items.length && !this._showInput) {
            listBox.add_child(new St.Label({
                text: 'All done',
                style: fontStyle(FONT.display, Math.round(ls * 0.95), 0.45, this._fg),
            }));
            return;
        }

        const rowH = Math.round(ls * 1.9);

        // Show ALL items (no maxRows slicing) -- ScrollView handles overflow
        for (const t of items) {
            const row = new St.BoxLayout({
                width: w - 2 * m, height: rowH,
                style: `spacing: ${Math.round(ls * 0.55)}px;`,
            });

            const dia = Math.round(ls * 1.05);
            const col = `rgb(${accentRgb})`;
            const isCompleted = !!t.completed;

            // Check circle: filled with accent + checkmark if completed, hollow if not
            const checkBtn = new St.Button({
                width: dia, height: dia,
                reactive: true, can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: isCompleted
                    ? `background-color: ${col}; border: ${Math.max(2, Math.round(dia * 0.14))}px solid ${col}; border-radius: ${dia}px; padding: 0;`
                    : `border: ${Math.max(2, Math.round(dia * 0.14))}px solid ${col}; border-radius: ${dia}px; padding: 0;`,
            });

            const checkLabel = new St.Label({
                text: isCompleted ? '✓' : '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: #ffffff; font-size: ${Math.round(dia * 0.65)}px; font-weight: 700;`,
            });
            checkBtn.set_child(checkLabel);

            const text = new St.BoxLayout({
                vertical: true,
                x_expand: true, y_align: Clutter.ActorAlign.CENTER,
            });

            const title = new St.Label({
                text: t.summary || '(untitled)',
                style: isCompleted
                    ? fontStyle(FONT.display, Math.round(ls * 0.95), 0.4, this._fg) + ' text-decoration: line-through;'
                    : fontStyle(FONT.display, Math.round(ls * 0.95), 1, this._fg),
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(title);

            if (t.due) {
                const overdue = !isCompleted && t.due < now && !sameDay(t.due, now);
                text.add_child(new St.Label({
                    text: formatDue(t.due, t.dueAllDay),
                    style: fontStyle(FONT.display, Math.round(ls * 0.76),
                        overdue ? 1 : (isCompleted ? 0.3 : 0.5),
                        overdue ? '255,69,58' : this._fg)
                        + (isCompleted ? ' text-decoration: line-through;' : ''),
                }));
            }

            // Click handler: tick/untick reminder with instant visual feedback
            let toggling = false;
            const onToggle = () => {
                if (toggling) return;
                toggling = true;
                if (isCompleted) {
                    this._ctx.reminders.uncompleteReminder(t);
                } else {
                    checkBtn.style = `background-color: ${col}; border: ${Math.max(2, Math.round(dia * 0.14))}px solid ${col}; border-radius: ${dia}px; padding: 0;`;
                    checkLabel.text = '✓';
                    title.style = fontStyle(FONT.display, Math.round(ls * 0.95), 0.4, this._fg) + ' text-decoration: line-through;';
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                        this._ctx.reminders.completeReminder(t);
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            checkBtn.connect('clicked', onToggle);

            // Delete button (trash) -- the ONLY way to remove a completed task
            const delBtn = new St.Button({
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 2px; border-radius: 4px; opacity: 0.7;',
            });
            const delIcon = new St.Icon({
                icon_name: 'user-trash-symbolic',
                icon_size: Math.max(12, Math.round(ls * 0.95)),
                style: 'color: rgba(255,255,255,0.7);',
            });
            delBtn.set_child(delIcon);
            delBtn.connect('clicked', () => {
                this._ctx.reminders.deleteReminder(t);
            });

            row.add_child(checkBtn);
            row.add_child(text);
            row.add_child(delBtn);
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
        this._unsubAccent?.();
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
