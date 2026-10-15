// City selection panel for the City clock widget. Four slots + a searchable
// list of ~120 cities. Click a slot to target it, click a city to fill it;
// changes apply live to the widget.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {makeLiquidGlass} from './liquidGlass.js';
import {allCities, computeCity, lookupCity} from './worldClock.js';

export const CityPicker = GObject.registerClass(
class CityPicker extends Clutter.Actor {
    _init(clocks, callbacks) {
        super._init({name: 'peachos-city-picker', reactive: true});
        this._clocks = clocks.slice(0, 4);
        while (this._clocks.length < 4)
            this._clocks.push(null);
        this._callbacks = callbacks; // { onChange(clocks), onDone() }
        this._target = this._clocks.findIndex(c => !c);
        if (this._target < 0)
            this._target = 0;
        this._all = allCities();

        const mon = Main.layoutManager.primaryMonitor;

        // click-away scrim
        this._scrim = new St.Widget({
            reactive: true,
            x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            style: 'background-color: rgba(0,0,0,0.35);',
        });
        this._scrim.connect('button-press-event', () => {
            this._callbacks.onDone();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._scrim);

        this._pw = 540;
        this._ph = Math.min(600, mon.height - 120);
        this._glass = makeLiquidGlass({
            innerW: this._pw, innerH: this._ph,
            x: Math.round(mon.x + (mon.width - this._pw) / 2),
            y: Math.round(mon.y + (mon.height - this._ph) / 2),
            radius: 44, mode: 'dark',
        });
        this._glass.widget.reactive = true;
        this.add_child(this._glass.widget);

        // swallow clicks on the backdrop area outside the panel? handled by the
        // edit-mode scrim; nothing to do here.

        this._build();
        this._refreshSlots();
        this._refreshList('');
    }

    _build() {
        const root = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style_class: 'peachos-cities',
        });
        this._glass.content.add_child(root);

        const header = new St.BoxLayout({style_class: 'peachos-cities-header', x_expand: true});
        header.add_child(new St.Label({
            text: 'World Clocks', x_expand: true,
            style_class: 'peachos-cities-title',
        }));
        const done = new St.Button({
            style_class: 'peachos-cities-done',
            child: new St.Label({text: 'Done'}),
        });
        done.connect('clicked', () => this._callbacks.onDone());
        header.add_child(done);
        root.add_child(header);

        // 4 slots
        this._slotBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-cities-slots', x_expand: true,
        });
        root.add_child(this._slotBox);

        // search
        this._entry = new St.Entry({
            style_class: 'peachos-cities-search',
            hint_text: 'Search cities…',
            x_expand: true,
            can_focus: true,
        });
        this._entry.clutter_text.connect('text-changed',
            () => this._refreshList(this._entry.get_text().trim().toLowerCase()));
        root.add_child(this._entry);

        // list
        this._scroll = new St.ScrollView({
            x_expand: true, y_expand: true,
            style_class: 'peachos-cities-scroll',
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'peachos-cities-list',
        });
        this._scroll.set_child(this._list);
        root.add_child(this._scroll);
    }

    _refreshSlots() {
        this._slotBox.destroy_all_children();
        const now = new Date();
        for (let i = 0; i < 4; i++) {
            const tz = this._clocks[i];
            const slot = new St.Button({
                style_class: 'peachos-cities-slot' + (i === this._target ? ' target' : ''),
                x_expand: true,
            });
            slot.connect('clicked', () => {
                this._target = i;
                this._refreshSlots();
            });
            const row = new St.BoxLayout({x_expand: true, style_class: 'peachos-cities-slot-row'});
            row.add_child(new St.Label({
                text: `${i + 1}`, style_class: 'peachos-cities-slot-num',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (tz) {
                const info = lookupCity(tz);
                const c = computeCity(tz, now);
                row.add_child(new St.Label({
                    text: info.code, style_class: 'peachos-cities-slot-code',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                row.add_child(new St.Label({
                    text: info.name, x_expand: true,
                    style_class: 'peachos-cities-slot-name',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                row.add_child(new St.Label({
                    text: `${c.hour12}:${`${c.minute}`.padStart(2, '0')} ${c.ampm}`,
                    style_class: 'peachos-cities-slot-time',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                const clear = new St.Button({
                    style_class: 'peachos-cities-slot-clear',
                    child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
                });
                clear.connect('clicked', () => {
                    this._clocks[i] = null;
                    this._target = i;
                    this._emit();
                });
                row.add_child(clear);
            } else {
                row.add_child(new St.Label({
                    text: 'Empty', x_expand: true,
                    style_class: 'peachos-cities-slot-empty',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            slot.set_child(row);
            this._slotBox.add_child(slot);
        }
    }

    _refreshList(query) {
        this._list.destroy_all_children();
        const chosen = new Set(this._clocks.filter(Boolean));
        const matches = this._all.filter(c =>
            !query || c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query));
        for (const c of matches.slice(0, 200)) {
            const row = new St.Button({
                style_class: 'peachos-cities-item' + (chosen.has(c.tz) ? ' chosen' : ''),
                x_expand: true,
            });
            const b = new St.BoxLayout({x_expand: true});
            b.add_child(new St.Label({
                text: c.code, style_class: 'peachos-cities-item-code',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            b.add_child(new St.Label({
                text: c.name, x_expand: true,
                style_class: 'peachos-cities-item-name',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.set_child(b);
            row.connect('clicked', () => this._assign(c.tz));
            this._list.add_child(row);
        }
    }

    _assign(tz) {
        this._clocks[this._target] = tz;
        // advance to the next empty slot, else next slot
        let next = this._clocks.findIndex((c, idx) => idx > this._target && !c);
        if (next < 0)
            next = this._clocks.findIndex(c => !c);
        if (next < 0)
            next = (this._target + 1) % 4;
        this._target = next;
        this._emit();
    }

    _emit() {
        this._refreshSlots();
        this._refreshList(this._entry.get_text().trim().toLowerCase());
        this._callbacks.onChange(this._clocks.filter(Boolean));
    }

    panelRect() {
        return {
            x: this._glass.widget.x, y: this._glass.widget.y,
            w: this._pw, h: this._ph,
        };
    }
});
