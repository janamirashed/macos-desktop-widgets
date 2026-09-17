// Photos widget -- a random picture from your iCloud Photo Library, rotated
// through the day. The image fills the squircle (painted by the glass card,
// same as the News "story"); a small date sits over the base gradient.
//
// Sign-in + the local photo cache: lib/providers/icloudPhotos.js (backed by the
// peachos-icloud-photos Python helper). When there's nothing cached yet the
// widget shows a short "set up in Settings" note instead.
//
//   'square' / 'grid' -- one photo at the footprint's size.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {FONT, fontStyle} from '../lib/fonts.js';
import {buildConnectCard} from '../lib/connectCard.js';

// Open peachOS Settings on the Internet Accounts page (where the iCloud sign-in
// lives). Same subprocess spawn edsCalendar.openAccountSettings uses.
function openICloudSettings() {
    for (const argv of [
        ['peachos-settings', 'internetaccounts'],
        ['gnome-control-center', 'online-accounts'],
    ]) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return;
        } catch (e) {
            // try the next
        }
    }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// "June 14, 2019" -> with a "N years ago today" tail when it's this calendar day
function prettyDate(iso) {
    if (!iso)
        return '';
    const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d)
        return '';
    let s = `${MONTHS[m - 1]} ${d}, ${y}`;
    const now = new Date();
    if (now.getMonth() + 1 === m && now.getDate() === d) {
        const yrs = now.getFullYear() - y;
        if (yrs === 1)
            s = 'One year ago today';
        else if (yrs > 1)
            s = `${yrs} years ago today`;
    }
    return s;
}

export class PhotosWidget {
    constructor(parent, ctx, size, variant) {
        this._ctx = ctx;
        this._variant = variant;
        this._w = size.w;
        this._h = size.h;
        this._setImage = size.setImage;

        this._root = new Clutter.Actor({
            width: size.w, height: size.h, clip_to_allocation: true,
        });
        parent.add_child(this._root);

        this._unsub = ctx.icloudPhotos?.subscribe(() => this._render());
    }

    _render() {
        if (this._rendering)
            return;
        this._rendering = true;
        try {
            this._root.destroy_all_children();

            const cur = this._ctx.icloudPhotos?.get();
            const st = this._ctx.icloudPhotos?.status ?? {};
            const fs = Math.max(10, Math.round(this._h * 0.075));

            if (cur && GLib.file_test(cur.path, GLib.FileTest.EXISTS)) {
                this._setImage?.(cur.path);
                const date = prettyDate(cur.date);
                if (date) {
                    const m = Math.round(this._h * 0.09);
                    const lbl = new St.Label({
                        text: date,
                        style: fontStyle(FONT.display, fs, 0.95, '255,255,255')
                            + ' font-weight: 600;',
                    });
                    lbl.set_position(m, Math.round(this._h - m - fs * 1.3));
                    this._root.add_child(lbl);
                }
                return;
            }

            // nothing to show -- the "set it up" placeholder
            this._setImage?.(null);
            this._renderPlaceholder(st);
        } finally {
            this._rendering = false;
        }
    }

    _renderPlaceholder(st) {
        const fetching = st.connected && !st.reauthNeeded;
        const status = !st.connected
            ? 'Add your iCloud account in Settings to see photos from your library'
            : st.reauthNeeded
                ? 'Your iCloud session expired — sign in again in Settings'
                : 'Loading your photos…';

        this._root.add_child(buildConnectCard({
            w: this._w, h: this._h, fg: '255,255,255',
            iconPath: GLib.build_filenamev(
                [this._ctx.path, 'icons', 'app', 'icloud-photos.svg']),
            markPath: GLib.build_filenamev(
                [this._ctx.path, 'icons', 'app', 'apple-logo-white.svg']),
            name: 'iCloud Photos',
            status,
            pill: fetching ? null : (st.reauthNeeded ? 'Sign In' : 'Open Settings'),
            styleClass: 'peachos-photos-connect',
            onClick: () => openICloudSettings(),
        }));
    }

    destroy() {
        this._unsub?.();
        this._setImage?.(null);
        this._root.destroy();
    }
}
