import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {makeLiquidGlass} from './liquidGlass.js';

const CENTER = Clutter.ActorAlign.CENTER;

export const CalendarPicker = GObject.registerClass(
class CalendarPicker extends Clutter.Actor {
    _init(currentMode, ctx, callbacks) {
        super._init({name: 'peachos-calendar-picker', reactive: true});
        this._current = currentMode || 'calendar';
        this._ctx = ctx;
        this._callbacks = callbacks; // { onChange(mode), onDone() }

        const mon = Main.layoutManager.primaryMonitor;

        // Scrim backdrop
        this._scrim = new St.Widget({
            reactive: true,
            x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            style: 'background-color: rgba(0,0,0,0.4);',
        });
        this._scrim.connect('button-press-event', () => {
            this._callbacks.onDone();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._scrim);

        const W = 350, H = 290;
        const px = mon.x + Math.round((mon.width - W) / 2);
        const py = mon.y + Math.round((mon.height - H) / 2);

        this._glass = makeLiquidGlass({innerW: W, innerH: H, x: px, y: py, radius: 28, mode: 'dark'});
        this._glass.widget.reactive = true;
        this.add_child(this._glass.widget);

        const wrap = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'peachos-calpick',
            x_expand: true, y_expand: true,
        });
        this._glass.content.add_child(wrap);

        // Header
        const header = new St.BoxLayout({style_class: 'peachos-calpick-header'});
        header.add_child(new St.Label({
            text: 'Event Colors',
            style_class: 'peachos-calpick-title',
            x_expand: true, y_align: CENTER,
        }));
        const done = new St.Button({
            style_class: 'peachos-calpick-done',
            child: new St.Label({text: 'Done'}),
        });
        done.connect('clicked', () => this._callbacks.onDone());
        header.add_child(done);
        wrap.add_child(header);

        // Subtitle instructions
        const sub = new St.Label({
            text: 'Choose how event indicators are colored in the agenda list.',
            style: 'font-size: 11.5px; color: rgba(255,255,255,0.55); margin-bottom: 4px;',
        });
        wrap.add_child(sub);

        const accentRgb = ctx?.accentColor?.rgb || '213, 97, 153';

        // Option 1: Calendar Colors
        const optCal = this._createOptionCard({
            id: 'calendar',
            title: 'Calendar Colors',
            desc: 'Use original event & calendar colors',
            previewPips: ['#007AFF', '#34C759', '#FF9500', '#AF52DE'],
            selected: this._current === 'calendar',
        });
        wrap.add_child(optCal);

        // Option 2: Accent Color
        const optAccent = this._createOptionCard({
            id: 'accent',
            title: 'Accent Color',
            desc: 'Match system display accent color',
            previewPips: [`rgb(${accentRgb})`, `rgb(${accentRgb})`, `rgb(${accentRgb})`],
            selected: this._current === 'accent',
        });
        wrap.add_child(optAccent);
    }

    _createOptionCard({id, title, desc, previewPips, selected}) {
        const btn = new St.Button({
            style_class: 'peachos-calpick-option' + (selected ? ' selected' : ''),
            can_focus: true,
            x_expand: true,
        });

        const row = new St.BoxLayout({
            x_expand: true,
            y_align: CENTER,
            style: 'spacing: 12px;',
        });

        // Left color preview bars
        const pipBox = new St.BoxLayout({
            y_align: CENTER,
            style: 'spacing: 3px;',
        });
        for (const col of previewPips) {
            pipBox.add_child(new St.Widget({
                width: 4, height: 24,
                style: `background-color: ${col}; border-radius: 2px;`,
            }));
        }
        row.add_child(pipBox);

        // Text details
        const textCol = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: CENTER,
            style: 'spacing: 2px;',
        });
        textCol.add_child(new St.Label({
            text: title,
            style: 'font-size: 13.5px; font-weight: 700; color: #ffffff;',
        }));
        textCol.add_child(new St.Label({
            text: desc,
            style: 'font-size: 11px; color: rgba(255,255,255,0.55);',
        }));
        row.add_child(textCol);

        // Checkmark indicator if selected
        if (selected) {
            const check = new St.Label({
                text: '✓',
                y_align: CENTER,
                style: 'font-size: 14px; font-weight: 700; color: #ffffff;',
            });
            row.add_child(check);
        }

        btn.set_child(row);
        btn.connect('clicked', () => {
            this._current = id;
            this._callbacks.onChange(id);
            this._callbacks.onDone();
        });
        return btn;
    }

    destroy() {
        this._glass?.widget?.destroy();
        this._scrim?.destroy();
        super.destroy();
    }
});
