// Mail widget -- your three most recent inbox messages for one provider
// (Gmail / iCloud Mail / Outlook), matched to the other list widgets.
//
//   'row'  -- provider header + 3 messages (sender / subject / time).
//   'grid' -- same, taller rows, each with a dim preview line.
//
// Data + notifications: lib/providers/mail.js (backed by the peachos-mail
// Python helper). Before the account is connected the widget shows a branded
// "set it up in Settings" card, like the Photos widget.
//
// Tapping the widget opens that provider's webmail in the default browser.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {openAccountSettings} from '../lib/providers/edsCalendar.js';
import {buildConnectCard} from '../lib/connectCard.js';
import {FONT, fontStyle, Pango} from '../lib/fonts.js';

// accent per brand: [glass, dark, light] rgb triplets (0-1). glass is always
// white (like every other widget); dark/light show the provider colour.
const ACCENTS = {
    google: [[1, 1, 1], [0.918, 0.263, 0.208], [0.776, 0.157, 0.106]],
    apple: [[1, 1, 1], [0.212, 0.576, 0.953], [0.098, 0.463, 0.824]],
    microsoft: [[1, 1, 1], [0.114, 0.506, 0.847], [0.0, 0.353, 0.620]],
};

const NAMES = {google: 'Gmail', apple: 'iCloud Mail', microsoft: 'Outlook'};
const ACCOUNT = {google: 'Google', apple: 'iCloud', microsoft: 'Microsoft'};
const ICON = {google: 'mail-gmail.png', apple: 'mail-icloud.svg', microsoft: 'mail-outlook.png'};
const WEBMAIL = {
    google: 'https://mail.google.com/',
    apple: 'https://www.icloud.com/mail/',
    microsoft: 'https://outlook.live.com/mail/',
};

// unix seconds -> "now" / "9m" / "3h" / "2d" / "Sep 4"
function relTime(unix) {
    if (!unix)
        return '';
    const d = Date.now() / 1000 - unix;
    if (d < 90)
        return 'now';
    if (d < 3600)
        return `${Math.round(d / 60)}m`;
    if (d < 86400)
        return `${Math.round(d / 3600)}h`;
    if (d < 7 * 86400)
        return `${Math.round(d / 86400)}d`;
    return new Date(unix * 1000)
        .toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export class MailWidget {
    constructor(parent, ctx, size, variant, opts = {}) {
        this._ctx = ctx;
        this._variant = variant;                  // 'row' | 'grid'
        this._brand = opts.brand || 'google';     // 'google' | 'apple' | 'microsoft'
        this._cardMode = size.mode || 'glass';
        this._w = size.w;
        this._h = size.h;
        this._fg = size.fg || '255,255,255';

        const [g, dk, lt] = ACCENTS[this._brand] || ACCENTS.google;
        this._accent = this._cardMode === 'glass' ? g
            : (this._cardMode === 'light' ? lt : dk);
        this._accentRgb = this._accent.map(v => Math.round(v * 255)).join(',');

        this._root = new Clutter.Actor({
            width: size.w, height: size.h, clip_to_allocation: true,
        });
        parent.add_child(this._root);

        this._unsub = ctx.mail?.subscribe(() => this._render());
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 300, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // frame.js calls this when edit mode toggles -- drop the click-to-open
    // target so the card can be dragged.
    setEditing(editing) {
        this._editing = editing;
        if (this._clickTarget)
            this._clickTarget.reactive = !editing;
    }

    _icoPath(n) {
        return GLib.build_filenamev([this._ctx.path, 'icons', 'app', n]);
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
            this._root.destroy_all_children();
            this._clickTarget = null;

            const st = this._ctx.mail?.status(this._brand) ?? {};
            if (!st.connected || st.reauthNeeded) {
                this._renderConnect(st);
                return;
            }
            this._renderList(this._ctx.mail?.getInbox(this._brand) ?? []);
        } finally {
            this._rendering = false;
        }
    }

    _brandMark(px) {
        return new St.Icon({
            gicon: Gio.icon_new_for_string(this._icoPath(ICON[this._brand])),
            icon_size: px,
        });
    }

    // ---- connected: the message list --------------------------------

    _renderList(msgs) {
        const w = this._w;
        const h = this._h;
        const grid = this._variant === 'grid';
        const m = Math.round(h * (grid ? 0.06 : 0.1));
        const fg = this._fg;

        const headFs = Math.max(12, Math.round(h * (grid ? 0.05 : 0.09)));
        const head = new St.BoxLayout({width: w - 2 * m});
        head.add_child(new St.Label({
            text: NAMES[this._brand], x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, headFs, 1, this._accentRgb) + ' font-weight: 800;',
        }));
        const mark = this._brandMark(Math.round(headFs * 1.2));
        mark.y_align = Clutter.ActorAlign.CENTER;
        head.add_child(mark);
        this._add(head, m, m);

        const top = m + Math.round(headFs * 1.95);
        const rows = 3;
        const rowH = (h - top - m) / rows;

        if (!msgs.length) {
            this._add(new St.Label({
                text: 'Inbox Zero',
                style: fontStyle(FONT.display, Math.max(12, Math.round(h * 0.06)), 0.4, fg),
            }), m, top + Math.round((h - top - m) / 2 - h * 0.03));
            this._installClickTarget();
            return;
        }

        const fs = Math.max(10,
            Math.min(grid ? 16 : 13, Math.floor((rowH - 8) / (grid ? 4.4 : 3.2))));
        const subFs = Math.round(fs * 0.86);
        const timeFs = Math.round(fs * 0.8);
        const dotD = Math.round(fs * 0.52);

        let contentH = Math.round(fs * 1.3) + Math.round(subFs * 1.3)
            + Math.round(fs * 0.24);
        if (grid)
            contentH += Math.round(subFs * 1.3);

        for (let i = 0; i < rows; i++) {
            const msg = msgs[i];
            const y0 = top + i * rowH;

            if (i > 0) {
                this._add(new St.Widget({
                    width: w - 2 * m, height: 1,
                    style: `background-color: rgba(${fg},0.10);`,
                }), m, y0);
            }
            if (!msg)
                continue;

            const row = new St.BoxLayout({
                width: w - 2 * m,
                style: `spacing: ${Math.round(fs * 0.5)}px;`,
            });

            const txt = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                style: `spacing: ${Math.round(fs * 0.24)}px;`,
            });

            const senderRow = new St.BoxLayout({
                style: `spacing: ${Math.round(fs * 0.42)}px;`,
            });
            if (msg.unread) {
                senderRow.add_child(new St.Widget({
                    width: dotD, height: dotD,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `background-color: rgba(${this._accentRgb},1); `
                        + 'border-radius: 999px;',
                }));
            }
            const sender = new St.Label({
                text: msg.from || msg.addr || 'Unknown',
                x_expand: true,
                style: fontStyle(FONT.display, fs, 1, fg)
                    + (msg.unread ? ' font-weight: 700;' : ' font-weight: 600;'),
            });
            sender.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            senderRow.add_child(sender);
            txt.add_child(senderRow);

            const subj = new St.Label({
                text: msg.subject || '(no subject)',
                style: fontStyle(FONT.display, subFs, msg.unread ? 0.72 : 0.5, fg),
            });
            subj.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            txt.add_child(subj);

            if (grid && msg.preview) {
                const prev = new St.Label({
                    text: msg.preview,
                    style: fontStyle(FONT.display, subFs, 0.38, fg),
                });
                prev.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                txt.add_child(prev);
            }
            row.add_child(txt);

            row.add_child(new St.Label({
                text: relTime(msg.date),
                y_align: Clutter.ActorAlign.START,
                style: fontStyle(FONT.display, timeFs, 0.4, fg),
            }));

            this._add(row, m, y0 + Math.max(2, (rowH - contentH) / 2));
        }

        this._installClickTarget();
    }

    // ---- not set up: the branded placeholder ------------------------

    _renderConnect(st) {
        const status = st.reauthNeeded
            ? 'Your session expired — reconnect in Settings'
            : `Add your ${ACCOUNT[this._brand]} account in Settings to see your inbox`;

        const card = buildConnectCard({
            w: this._w, h: this._h, fg: this._fg,
            iconPath: this._icoPath(ICON[this._brand]),
            name: NAMES[this._brand],
            status,
            pill: st.reauthNeeded ? 'Reconnect' : 'Open Settings',
            styleClass: 'peachos-mail-connect',
            onClick: () => openAccountSettings(),
        });
        card.reactive = !this._editing;
        this._root.add_child(card);
        this._clickTarget = card;
    }

    // A transparent full-card button under the list content -> open webmail.
    _installClickTarget() {
        const btn = new St.Button({
            width: this._w, height: this._h,
            reactive: !this._editing, can_focus: true,
            style_class: 'peachos-mail-open',
        });
        btn.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(WEBMAIL[this._brand], null);
            } catch (e) {
                logError(e, '[peachos-widgets] mail: open webmail failed');
            }
        });
        this._root.insert_child_below(btn, this._root.get_first_child());
        this._clickTarget = btn;
    }

    destroy() {
        this._unsub?.();
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._root.destroy();
    }
}
