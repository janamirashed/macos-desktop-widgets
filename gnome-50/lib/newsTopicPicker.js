// Topic picker for the News widget -- a small dark glass panel with the
// available topics; pick one and it applies live.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {makeLiquidGlass} from './liquidGlass.js';
import {NEWS_TOPICS} from './providers/news.js';

export const NewsTopicPicker = GObject.registerClass(
class NewsTopicPicker extends Clutter.Actor {
    _init(current, callbacks) {
        super._init({name: 'peachos-news-topic-picker', reactive: true});
        this._current = current;
        this._callbacks = callbacks;   // { onChange(id), onDone() }

        const mon = Main.layoutManager.primaryMonitor;

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

        const pw = 340;
        const ph = Math.min(560, mon.height - 140);
        this._glass = makeLiquidGlass({
            innerW: pw, innerH: ph,
            x: Math.round(mon.x + (mon.width - pw) / 2),
            y: Math.round(mon.y + (mon.height - ph) / 2),
            radius: 40, mode: 'dark',
        });
        this._glass.widget.reactive = true;
        this.add_child(this._glass.widget);

        const root = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style_class: 'peachos-newstopic',
        });
        this._glass.content.add_child(root);

        const header = new St.BoxLayout({style_class: 'peachos-newstopic-header'});
        header.add_child(new St.Label({
            text: 'News Topic', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'peachos-newstopic-title',
        }));
        const done = new St.Button({
            style_class: 'peachos-newstopic-done',
            child: new St.Label({text: 'Done'}),
        });
        done.connect('clicked', () => this._callbacks.onDone());
        header.add_child(done);
        root.add_child(header);

        const scroll = new St.ScrollView({
            x_expand: true, y_expand: true,
            style_class: 'peachos-newstopic-scroll',
        });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        const list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true,
        });
        scroll.set_child(list);
        root.add_child(scroll);

        for (const t of NEWS_TOPICS) {
            const btn = new St.Button({
                style_class: 'peachos-newstopic-item'
                    + (t.id === current ? ' selected' : ''),
                child: new St.Label({text: t.name}),
                x_expand: true,
            });
            btn.connect('clicked', () => {
                this._callbacks.onChange(t.id);
                this._callbacks.onDone();
            });
            list.add_child(btn);
        }
    }

    destroy() {
        this._glass?.widget.destroy();
        super.destroy();
    }
});
