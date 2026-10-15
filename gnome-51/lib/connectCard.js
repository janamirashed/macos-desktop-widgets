// Shared "not set up yet" card for account-backed widgets (Photos, Mail).
//
// The whole card is a button (stays clickable outside edit mode). It sizes
// itself to fit either footprint without clipping:
//   row  (348x170)  -- icon + brand lockup + pill      (status line dropped)
//   grid (348x348)  -- icon + brand lockup + wrapped status line + pill
//
// The status line was clipping to one line before: a line_wrap St.Label with
// no fixed size gets squished to its 1-line minimum when the column overflows.
// Here the column is sized to fit and the status sits in a fixed-height Bin.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {FONT, fontStyle, Pango} from './fonts.js';

export function buildConnectCard(o) {
    const {w, h, fg = '255,255,255', iconPath, markPath, name, status,
        pill, styleClass, onClick} = o;

    const compact = h < 210;
    const pad = Math.round(Math.min(w, h) * 0.08);
    const innerW = w - 2 * pad;
    const titlePx = Math.max(13, Math.round(h * (compact ? 0.11 : 0.072)));
    const subPx = Math.max(11, Math.round(titlePx * 0.68));
    const gap = Math.round(titlePx * (compact ? 0.55 : 0.68));

    const col = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        width: w, height: h,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: `spacing: ${gap}px; padding: ${pad}px;`,
    });

    col.add_child(new St.Icon({
        gicon: Gio.icon_new_for_string(iconPath),
        icon_size: Math.round(Math.min(w, h) * (compact ? 0.3 : 0.19)),
        x_align: Clutter.ActorAlign.CENTER,
    }));

    const titleRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `spacing: ${Math.round(titlePx * 0.3)}px;`,
    });
    if (markPath) {
        titleRow.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(markPath),
            icon_size: Math.round(titlePx * 1.1),
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    titleRow.add_child(new St.Label({
        text: name,
        style: fontStyle(FONT.rounded, titlePx, 1, fg) + ' font-weight: 600;',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    col.add_child(titleRow);

    if (!compact && status) {
        const lineH = Math.round(subPx * 1.34);
        const sub = new St.Label({
            text: status,
            x_align: Clutter.ActorAlign.CENTER,
            style: fontStyle(FONT.display, subPx, 0.55, fg),
        });
        sub.set_width(innerW);
        sub.clutter_text.line_wrap = true;
        sub.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        sub.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        sub.clutter_text.justify = false;               // else lines full-justify
        sub.clutter_text.line_alignment = Pango.Alignment.CENTER;  // centre each line

        // Reserve up to 3 lines and centre the (1-3 line) text within it, so a
        // longer string can never be clipped by the column.
        const box = new St.Bin({
            width: innerW, height: lineH * 3,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.set_child(sub);
        col.add_child(box);
    }

    if (pill) {
        const pillBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            style: `background-color: rgba(${fg},0.16); border-radius: 999px; `
                + `padding: ${Math.round(subPx * 0.5)}px ${Math.round(subPx * 1.05)}px;`,
        });
        pillBox.add_child(new St.Label({
            text: pill,
            style: fontStyle(FONT.rounded, subPx, 1, fg) + ' font-weight: 600;',
        }));
        col.add_child(pillBox);
    }

    const card = new St.Button({
        width: w, height: h,
        reactive: true, can_focus: true,
        style_class: styleClass,
    });
    card.set_child(col);
    if (onClick)
        card.connect('clicked', onClick);
    return card;
}
