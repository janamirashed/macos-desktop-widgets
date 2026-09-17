// The widget gallery: a centred liquid-glass panel that rises from the desktop
// in edit mode. Left sidebar = a search field, an "All Widgets" entry, then one
// row per widget type (app icon + name). Right side = the bare previews for the
// selection, grouped by type, each at its true relative footprint (a row reads
// twice as wide as a square). Drag a preview onto the desktop to place it.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {makeLiquidGlass} from './liquidGlass.js';
import {REGISTRY} from './widgetRegistry.js';

// appIcon can be a themed name or a path relative to the extension.
function iconGicon(ctxPath, name) {
    if (name && (name.includes('/') || name.endsWith('.png') || name.endsWith('.svg')))
        return Gio.icon_new_for_string(GLib.build_filenamev([ctxPath, name]));
    return null;
}

const PU = 100;        // preview size for a square widget (px)
const PGAP = 8;        // gap inside a preview footprint (matches the desktop grid)
const CARD_GAP = 16;   // gap between previews
const SIDEBAR_W = 214;
const PLACE_MODE = 'dark';
const CENTER = Clutter.ActorAlign.CENTER;

// How much of the panel stays on-screen when the user manually collapses it
// (the grab handle + a sliver), vs. slideOut() which takes it fully away
// during a widget drag.
const PEEK_H = 44;
const DRAWER_MS = 260;

function previewDims(shape) {
    const wide = shape === 'row' || shape === 'grid';
    const tall = shape === 'grid';
    return {
        w: wide ? PU * 2 + PGAP : PU,
        h: tall ? PU * 2 + PGAP : PU,
    };
}

export const WidgetPicker = GObject.registerClass(
class WidgetPicker extends Clutter.Actor {
    _init(widgetLayer, callbacks) {
        super._init({name: 'peachos-widget-picker', reactive: false});
        this._widgetLayer = widgetLayer;
        this._ctx = widgetLayer.ctx;
        this._callbacks = callbacks;
        this._selectedType = null;   // null == "All Widgets"
        this._query = '';

        // A drawer hinged to the bottom edge: centred, with a fixed amount of
        // panel ON screen (visibleH) and a small bleed past the bottom so the
        // lower corners sit off-screen and it reads as "coming out of" the
        // desktop.
        const mon = Main.layoutManager.primaryMonitor;
        const BLEED = 44;
        const visibleH = Math.round(Math.min(640, Math.max(460, mon.height * 0.5)));
        this._pw = Math.round(Math.min(1180, Math.max(820, mon.width * 0.66)));
        this._ph = visibleH + BLEED;
        this._px = mon.x + Math.round((mon.width - this._pw) / 2);
        this._py = mon.y + mon.height - visibleH;

        // Drawer state:
        //   drawer  -- 'full' (all the way up) | 'peek' (collapsed to the handle),
        //              toggled by the handle at the top of the panel
        //   dragGone -- fully off-screen while a widget is being dragged
        // translation_y targets: full = 0, peek = _peekTy, gone = _ph
        this._peekTy = visibleH - PEEK_H;
        this._drawer = 'full';
        this._dragGone = false;
        this._chevrons = [];

        this._glass = makeLiquidGlass({
            innerW: this._pw, innerH: this._ph,
            x: this._px, y: this._py, radius: 40,
        });
        this._glass.widget.reactive = true;
        this.add_child(this._glass.widget);

        this._buildContents();
        this._select(null);

        this._wxUnsub = this._ctx.weather?.subscribe(() => this._syncWeatherLoc());
        this.connect('destroy', () => this._wxUnsub?.());

        // stay above every placed widget / chrome for as long as we're shown
        // (peek included -- the handle must stay clickable over placed widgets)
        const parent = this._widgetLayer.layer;
        parent.connectObject('child-added', () => {
            if (this.get_parent() === parent && !this._dragGone)
                parent.set_child_above_sibling(this, null);
        }, this);
        this.connect('destroy', () => parent.disconnectObject(this));

        // slide up out of the bottom edge
        const g = this._glass.widget;
        g.translation_y = Math.round(this._ph * 0.5);
        g.opacity = 0;
        g.ease({
            translation_y: 0, opacity: 255, duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // Take the panel fully off-screen while a widget is being dragged; restore
    // it (to whatever drawer state it was in) when the widget is dropped.
    slideOut() {
        if (this._dragGone)
            return;
        this._dragGone = true;
        this._applyDrawer(true);
    }

    slideIn() {
        if (!this._dragGone)
            return;
        this._dragGone = false;
        const parent = this._widgetLayer.layer;
        if (this.get_parent() === parent)
            parent.set_child_above_sibling(this, null);
        this._applyDrawer(true);
    }

    // The manual collapse/expand toggle, driven by the handle.
    _setDrawer(state) {
        if (state === this._drawer)
            return;
        this._drawer = state;
        if (!this._dragGone)
            this._applyDrawer(true);
        this._updateChevrons();
    }

    _applyDrawer(animate) {
        const g = this._glass.widget;
        const ty = this._dragGone ? this._ph
            : this._drawer === 'peek' ? this._peekTy : 0;
        const op = this._dragGone ? 0 : 255;
        g.remove_all_transitions();
        // stay reactive while peeking so the handle keeps working
        g.reactive = !this._dragGone;
        if (animate) {
            g.ease({
                translation_y: ty, opacity: op, duration: DRAWER_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            g.translation_y = ty;
            g.opacity = op;
        }
        this._updateChevrons();
    }

    _updateChevrons() {
        const name = this._drawer === 'peek' ? 'pan-up-symbolic' : 'pan-down-symbolic';
        for (const ic of this._chevrons)
            ic.icon_name = name;
    }

    // The grab handle at the top of the panel: three chevrons. Click to toggle
    // full <-> peek; or drag it (and release -- snaps to the nearer state); or
    // scroll over it.
    _buildHandle() {
        const handle = new St.BoxLayout({
            style_class: 'peachos-picker-handle',
            x_expand: true, x_align: Clutter.ActorAlign.FILL,
            reactive: true, track_hover: true,
        });
        const chevBox = new St.BoxLayout({
            style_class: 'peachos-picker-handle-chevrons',
            x_expand: true, x_align: CENTER,
        });
        for (let i = 0; i < 3; i++) {
            const ic = new St.Icon({
                icon_name: 'pan-down-symbolic', icon_size: 16,
                style_class: 'peachos-picker-handle-chevron',
            });
            this._chevrons.push(ic);
            chevBox.add_child(ic);
        }
        handle.add_child(chevBox);

        handle.connect('button-press-event', (_a, ev) => this._onHandlePress(ev));
        handle.connect('scroll-event', (_a, ev) => {
            const dir = ev.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.DOWN)
                this._setDrawer('peek');
            else if (dir === Clutter.ScrollDirection.UP)
                this._setDrawer('full');
            return Clutter.EVENT_STOP;
        });
        return handle;
    }

    _onHandlePress(ev) {
        if (ev.get_button && ev.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (this._dragGone)
            return Clutter.EVENT_STOP;

        const g = this._glass.widget;
        const [, startY] = ev.get_coords();
        const startTy = g.translation_y;
        let peakMove = 0;
        g.remove_all_transitions();

        const id = global.stage.connect('captured-event', (_s, e) => {
            const t = e.type();
            if (t === Clutter.EventType.MOTION) {
                const [, y] = e.get_coords();
                const dy = y - startY;
                peakMove = Math.max(peakMove, Math.abs(dy));
                g.translation_y = Math.min(this._peekTy, Math.max(0, startTy + dy));
                return Clutter.EVENT_STOP;
            }
            if (t === Clutter.EventType.BUTTON_RELEASE) {
                global.stage.disconnect(id);
                if (peakMove < 5)
                    this._drawer = this._drawer === 'full' ? 'peek' : 'full';
                else
                    this._drawer = g.translation_y > this._peekTy / 2 ? 'peek' : 'full';
                this._applyDrawer(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _buildContents() {
        const wrap = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style_class: 'peachos-picker-wrap',
        });
        this._glass.content.add_child(wrap);
        wrap.add_child(this._buildHandle());

        const row = new St.BoxLayout({
            x_expand: true, y_expand: true,
            style_class: 'peachos-picker-body',
        });
        wrap.add_child(row);
        this._body = row;

        // ---- sidebar --------------------------------------------------
        const side = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-picker-side',
            y_expand: true,
        });
        side.width = SIDEBAR_W;
        row.add_child(side);

        this._search = new St.Entry({
            hint_text: 'Search Widgets',
            style_class: 'peachos-picker-search',
            x_expand: true, can_focus: true,
        });
        this._search.set_primary_icon(new St.Icon({
            icon_name: 'edit-find-symbolic', icon_size: 14,
        }));
        this._search.clutter_text.connect('text-changed', () => {
            this._query = this._search.get_text().trim().toLowerCase();
            this._renderPreviews();
        });
        side.add_child(this._search);

        this._sideItems = new Map();
        side.add_child(this._sideItem(null, 'All Widgets', 'view-app-grid-symbolic'));

        const sideScroll = new St.ScrollView({
            style_class: 'peachos-picker-side-scroll', y_expand: true,
        });
        sideScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        const sideList = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        sideScroll.set_child(sideList);
        side.add_child(sideScroll);
        for (const [type, def] of Object.entries(REGISTRY))
            sideList.add_child(this._sideItem(type, def.name, def.appIcon));

        // ---- main ---------------------------------------------------
        const main = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style_class: 'peachos-picker-main',
        });
        row.add_child(main);

        const head = new St.BoxLayout({style_class: 'peachos-picker-head'});
        this._title = new St.Label({
            style_class: 'peachos-picker-title',
            x_expand: true, y_align: CENTER,
        });
        head.add_child(this._title);
        main.add_child(head);

        this._weatherLoc = this._buildWeatherLoc();
        main.add_child(this._weatherLoc);

        this._scroll = new St.ScrollView({
            x_expand: true, y_expand: true,
            style_class: 'peachos-picker-scroll',
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._grid = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-picker-grid',
            x_expand: true,
        });
        this._scroll.set_child(this._grid);
        main.add_child(this._scroll);

        // ---- footer action bar (last row of the panel) -------------
        const footer = new St.BoxLayout({
            style_class: 'peachos-picker-footer',
            x_expand: true, y_expand: false,
        });
        footer.add_child(new St.Label({
            text: 'Drag a widget to place it on the desktop…',
            style_class: 'peachos-picker-footer-hint',
            x_expand: true, y_align: CENTER,
        }));
        const done = new St.Button({
            style_class: 'peachos-picker-done',
            label: 'Done', can_focus: true, y_align: CENTER,
        });
        done.connect('clicked', () => this._callbacks.onDone());
        footer.add_child(done);
        wrap.add_child(footer);
    }

    _sideItem(type, label, icon) {
        const btn = new St.Button({
            style_class: 'peachos-picker-side-item',
            can_focus: true, x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        const box = new St.BoxLayout({
            style_class: 'peachos-picker-side-item-box',
            x_expand: true, x_align: Clutter.ActorAlign.FILL,
        });
        const gi = iconGicon(this._ctx.path, icon);
        box.add_child(new St.Icon({
            gicon: gi, icon_name: gi ? null : icon,
            icon_size: 24, y_align: CENTER,
        }));
        box.add_child(new St.Label({
            text: label, x_expand: true, y_align: CENTER,
            x_align: Clutter.ActorAlign.START,
        }));
        btn.set_child(box);
        btn.connect('clicked', () => this._select(type));
        this._sideItems.set(type, btn);
        return btn;
    }

    _select(type) {
        this._selectedType = type;
        for (const [t, btn] of this._sideItems)
            btn[t === type ? 'add_style_class_name' : 'remove_style_class_name']('selected');
        this._title.text = type ? REGISTRY[type].name : 'All Widgets';
        this._weatherLoc.visible = type === 'weather';
        if (type === 'weather')
            this._syncWeatherLoc();
        this._renderPreviews();
    }

    _renderPreviews() {
        this._grid.destroy_all_children();
        const maxRowW = Math.max(PU * 2 + PGAP, this._pw - SIDEBAR_W - 76);

        const types = Object.entries(REGISTRY)
            .filter(([t]) => !this._selectedType || t === this._selectedType);

        let any = false;
        for (const [type, def] of types) {
            const variants = Object.entries(def.variants).filter(([, vdef]) =>
                !this._query ||
                `${def.name} ${vdef.name}`.toLowerCase().includes(this._query));
            if (!variants.length)
                continue;
            any = true;

            const section = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'peachos-picker-section',
            });
            section.add_child(new St.Label({
                text: def.name, style_class: 'peachos-picker-section-title',
            }));

            let rowBox = null;
            let rowW = 0;
            for (const [variant, vdef] of variants) {
                const {w, h} = previewDims(vdef.shape);
                if (!rowBox || rowW + w > maxRowW) {
                    rowBox = new St.BoxLayout({style_class: 'peachos-picker-grid-row'});
                    section.add_child(rowBox);
                    rowW = 0;
                }
                rowBox.add_child(this._makeCard(type, variant, w, h));
                rowW += w + CARD_GAP;
            }
            this._grid.add_child(section);
        }

        if (!any) {
            this._grid.add_child(new St.Label({
                text: 'No widgets match your search',
                style_class: 'peachos-picker-empty',
            }));
        }
    }

    _previewPath(type, variant) {
        const p = GLib.build_filenamev(
            [this._ctx.path, 'previews', `${type}-${variant}.png`]);
        return GLib.file_test(p, GLib.FileTest.EXISTS) ? p : null;
    }

    _makeCard(type, variant, w, h) {
        const card = new St.Widget({
            width: w, height: h,
            reactive: true, track_hover: true,
            style_class: 'peachos-picker-preview',
            layout_manager: new Clutter.BinLayout(),
        });
        const path = this._previewPath(type, variant);
        if (path) {
            card.set_style(
                `background-image: url("file://${path}"); `
                + 'background-size: contain; background-position: center;');
        } else {
            const gi = iconGicon(this._ctx.path, REGISTRY[type].appIcon);
            card.add_child(new St.Icon({
                gicon: gi, icon_name: gi ? null : REGISTRY[type].appIcon,
                icon_size: Math.min(56, Math.round(Math.min(w, h) * 0.5)),
                x_align: CENTER, y_align: CENTER,
            }));
        }
        card.connect('button-press-event', (_a, event) =>
            this._beginDrag(type, variant, event));
        return card;
    }

    // ---- weather location (Auto / Manual) -----------------------------

    _buildWeatherLoc() {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-picker-weatherloc',
            visible: false,
        });

        const head = new St.BoxLayout({style_class: 'peachos-picker-weatherloc-head'});
        head.add_child(new St.Label({
            text: 'Location', x_expand: true, y_align: CENTER,
            style_class: 'peachos-picker-weatherloc-label',
        }));
        const seg = new St.BoxLayout({style_class: 'peachos-picker-modeseg'});
        this._wxSeg = new Map();
        for (const [key, label] of [['auto', 'Auto'], ['manual', 'Manual']]) {
            const b = new St.Button({
                style_class: 'peachos-picker-modeseg-btn',
                child: new St.Label({text: label}),
            });
            b.connect('clicked', () => {
                this._ctx.weather?.setAutoLocation(key === 'auto');
                if (key === 'manual')
                    this._wxEntry.grab_key_focus();
                this._syncWeatherLoc();
            });
            seg.add_child(b);
            this._wxSeg.set(key, b);
        }
        head.add_child(seg);
        box.add_child(head);

        this._wxManual = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-picker-wx-manual',
            visible: false,
        });
        this._wxEntry = new St.Entry({
            hint_text: 'Search for a city…',
            style_class: 'peachos-picker-wx-entry',
            x_expand: true, can_focus: true,
        });
        this._wxEntry.clutter_text.connect('activate', () => {
            const q = this._wxEntry.get_text();
            this._ctx.weather?.geocode(q, results => this._showWxResults(results));
        });
        this._wxManual.add_child(this._wxEntry);
        this._wxResults = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-picker-wx-results',
        });
        this._wxManual.add_child(this._wxResults);
        box.add_child(this._wxManual);

        this._wxCurrent = new St.Label({style_class: 'peachos-picker-wx-current'});
        box.add_child(this._wxCurrent);

        return box;
    }

    _showWxResults(results) {
        this._wxResults.destroy_all_children();
        if (!results.length) {
            this._wxResults.add_child(new St.Label({
                text: 'No matches', style_class: 'peachos-picker-wx-result',
            }));
            return;
        }
        for (const r of results) {
            const b = new St.Button({
                style_class: 'peachos-picker-wx-result',
                child: new St.Label({text: r.label}),
                x_expand: true,
            });
            b.connect('clicked', () => {
                this._ctx.weather?.setManualLocation(r.lat, r.lon, r.label);
                this._wxEntry.set_text('');
                this._wxResults.destroy_all_children();
                this._syncWeatherLoc();
            });
            this._wxResults.add_child(b);
        }
    }

    _syncWeatherLoc() {
        if (!this._weatherLoc)
            return;
        const wx = this._ctx.weather;
        const auto = wx ? wx.autoLocation : true;
        for (const [k, b] of this._wxSeg)
            b[(k === 'auto') === auto ? 'add_style_class_name' : 'remove_style_class_name']('selected');
        this._wxManual.visible = !auto;
        this._wxCurrent.text = wx
            ? (auto ? `Using your location · ${wx.locationName}` : `Showing · ${wx.locationName}`)
            : '';
    }

    // ---- drag-out placement -----------------------------------------

    _panelRect() {
        return {x: this._glass.widget.x, y: this._glass.widget.y, w: this._pw, h: this._ph};
    }

    _beginDrag(type, variant, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const def = REGISTRY[type];
        const {w, h} = previewDims(def.variants[variant].shape);
        const path = this._previewPath(type, variant);
        const ghost = new St.Widget({
            width: w, height: h, opacity: 210,
            layout_manager: new Clutter.BinLayout(),
        });
        if (path) {
            ghost.set_style(
                `background-image: url("file://${path}"); `
                + 'background-size: contain; background-position: center;');
        } else {
            const gi = iconGicon(this._ctx.path, def.appIcon);
            ghost.add_child(new St.Icon({
                gicon: gi, icon_name: gi ? null : def.appIcon, icon_size: 32,
                x_align: CENTER, y_align: CENTER,
            }));
        }
        this._widgetLayer.layer.add_child(ghost);
        this.slideOut();

        const [px, py] = event.get_coords();
        const move = (x, y) => ghost.set_position(
            Math.round(x - w / 2), Math.round(y - h / 2));
        move(px, py);

        const capturedId = global.stage.connect('captured-event', (_s, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.MOTION) {
                const [x, y] = ev.get_coords();
                move(x, y);
                return Clutter.EVENT_STOP;
            }
            if (t === Clutter.EventType.BUTTON_RELEASE) {
                global.stage.disconnect(capturedId);
                const [x, y] = ev.get_coords();
                ghost.destroy();
                this._widgetLayer.addWidget(type, variant, x, y, PLACE_MODE);
                this.slideIn();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }
});
