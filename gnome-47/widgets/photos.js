// Photos widget -- displays pictures from your laptop files or your
// iCloud Photo Library.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {FONT, fontStyle} from '../lib/fonts.js';
import {buildConnectCard} from '../lib/connectCard.js';

export function pickLocalPhoto(onChosen) {
    try {
        const proc = Gio.Subprocess.new(
            ['zenity', '--file-selection', '--title=Choose a Photo for Desktop Widget',
             '--file-filter=Image Files (*.png, *.jpg, *.jpeg, *.webp, *.bmp, *.gif)|*.png *.jpg *.jpeg *.webp *.bmp *.gif *.PNG *.JPG *.JPEG *.WEBP'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                const path = stdout ? stdout.trim() : null;
                if (path && GLib.file_test(path, GLib.FileTest.EXISTS))
                    onChosen(path);
            } catch (_) {}
        });
    } catch (e) {
        logError(e, '[peachos-widgets] zenity file selection failed');
    }
}

function openICloudSettings() {
    for (const argv of [
        ['peachos-settings', 'internetaccounts'],
        ['gnome-control-center', 'online-accounts'],
    ]) {
        try {
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            return;
        } catch (_) {}
    }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

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
        this._photoPath = size.photoPath || null;
        this._onConfigured = size.onConfigured;

        this._root = new Clutter.Actor({
            width: size.w, height: size.h, clip_to_allocation: true,
        });
        parent.add_child(this._root);

        this._unsub = ctx.icloudPhotos?.subscribe(() => this._render());
        if (ctx.accentColor)
            this._unsubAccent = ctx.accentColor.subscribe(() => this._render());
    }

    setPhotoPath(path) {
        this._photoPath = path;
        this._render();
    }

    _render() {
        if (this._rendering)
            return;
        this._rendering = true;
        try {
            this._root.destroy_all_children();

            // 1. Check if user configured a local photo or directory from laptop
            if (this._photoPath && GLib.file_test(this._photoPath, GLib.FileTest.EXISTS)) {
                let actualPath = this._photoPath;
                let dateStr = '';

                if (GLib.file_test(this._photoPath, GLib.FileTest.IS_DIR)) {
                    // Pick a random image from directory
                    const dir = Gio.File.new_for_path(this._photoPath);
                    const enumerator = dir.enumerate_children(
                        'standard::name,standard::content-type,time::modified',
                        Gio.FileQueryInfoFlags.NONE, null
                    );
                    const images = [];
                    let info;
                    while ((info = enumerator.next_file(null)) !== null) {
                        const name = info.get_name();
                        if (name.match(/\.(png|jpg|jpeg|webp|bmp|gif)$/i))
                            images.push({name, mtime: info.get_attribute_uint64('time::modified')});
                    }
                    if (images.length > 0) {
                        const chosen = images[Math.floor(Math.random() * images.length)];
                        actualPath = GLib.build_filenamev([this._photoPath, chosen.name]);
                        if (chosen.mtime > 0) {
                            const d = new Date(chosen.mtime * 1000);
                            dateStr = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
                        }
                    }
                } else {
                    const file = Gio.File.new_for_path(this._photoPath);
                    const info = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
                    const mtime = info ? info.get_attribute_uint64('time::modified') : 0;
                    if (mtime > 0) {
                        const d = new Date(mtime * 1000);
                        dateStr = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
                    }
                }

                if (actualPath && GLib.file_test(actualPath, GLib.FileTest.EXISTS)) {
                    this._setImage?.(actualPath);
                    return;
                }
            }

            // 2. Fall back to iCloud Photos if connected
            const cur = this._ctx.icloudPhotos?.get();
            const st = this._ctx.icloudPhotos?.status ?? {};

            if (cur && GLib.file_test(cur.path, GLib.FileTest.EXISTS)) {
                this._setImage?.(cur.path);
                return;
            }

            // 3. Nothing to show yet -- render placeholder with Choose Photo action
            this._setImage?.(null);
            this._renderPlaceholder(st);
        } finally {
            this._rendering = false;
        }
    }

    _renderPlaceholder(st) {
        const accentRgb = this._ctx.accentColor ? this._ctx.accentColor.rgb : '213, 97, 153';

        this._root.add_child(buildConnectCard({
            w: this._w, h: this._h, fg: '255,255,255',
            iconPath: GLib.build_filenamev(
                [this._ctx.path, 'icons', 'app', 'icloud-photos.svg']),
            markPath: null,
            name: 'Photos',
            status: 'Choose any picture from your laptop files or connect iCloud Photos in Settings',
            pill: 'Choose Photo…',
            styleClass: 'peachos-photos-connect',
            onClick: () => {
                pickLocalPhoto(path => {
                    this.setPhotoPath(path);
                    this._onConfigured?.(path);
                });
            },
        }));
    }

    destroy() {
        this._unsub?.();
        this._unsubAccent?.();
        this._setImage?.(null);
        this._root.destroy();
    }
}
