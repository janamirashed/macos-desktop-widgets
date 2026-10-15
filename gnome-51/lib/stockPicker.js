// Ticker picker for the Stocks widget -- a small dark glass panel with the
// currently chosen tickers as removable chips and a debounced typeahead
// search (Yahoo Finance) below. Applies live as tickers are added/removed.
//
// Smoothness: keystrokes are debounced (~200ms), each request has its own
// Gio.Cancellable (the previous in-flight one is dropped), a monotonic
// sequence id discards stale responses, and every query's results are cached
// so backspacing is instant.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {makeLiquidGlass} from './liquidGlass.js';

const DEBOUNCE_MS = 200;

export const StockPicker = GObject.registerClass(
class StockPicker extends Clutter.Actor {
    _init(current, max, ctx, callbacks) {
        super._init({name: 'peachos-stock-picker', reactive: true});
        this._max = max;
        this._ctx = ctx;
        this._callbacks = callbacks;                 // { onChange(symbols[]), onDone() }
        this._chosen = [...(current || [])];
        this._cache = new Map();                     // query -> results[]
        this._seq = 0;
        this._debounceId = 0;
        this._cancellable = null;

        const mon = Main.layoutManager.primaryMonitor;

        this._scrim = new St.Widget({
            reactive: true,
            x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            style: 'background-color: rgba(0,0,0,0.35);',
        });
        this._scrim.connect('button-press-event', () => {
            this._finish();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._scrim);

        const pw = 380;
        const ph = Math.min(540, mon.height - 140);
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
            style_class: 'peachos-stockpick',
        });
        this._glass.content.add_child(root);

        // header
        const header = new St.BoxLayout({style_class: 'peachos-stockpick-header'});
        header.add_child(new St.Label({
            text: max > 1 ? 'Tickers' : 'Ticker', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'peachos-stockpick-title',
        }));
        const done = new St.Button({
            style_class: 'peachos-stockpick-done',
            child: new St.Label({text: 'Done'}),
        });
        done.connect('clicked', () => this._finish());
        header.add_child(done);
        root.add_child(header);

        // chosen chips
        this._chips = new St.BoxLayout({
            style_class: 'peachos-stockpick-chips',
            x_expand: true,
        });
        root.add_child(this._chips);

        // search entry
        this._entry = new St.Entry({
            style_class: 'peachos-stockpick-entry',
            hint_text: max > 1 ? 'Add a ticker or company' : 'Search a ticker or company',
            can_focus: true, x_expand: true,
        });
        root.add_child(this._entry);
        this._entry.clutter_text.connect('text-changed', () => this._onType());
        this._entry.clutter_text.connect('activate', () => this._onActivate());

        // results
        this._scroll = new St.ScrollView({
            x_expand: true, y_expand: true,
            style_class: 'peachos-stockpick-scroll',
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._results = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, x_expand: true,
        });
        this._scroll.set_child(this._results);
        root.add_child(this._scroll);

        this._status = new St.Label({
            text: '', style_class: 'peachos-stockpick-status',
        });
        this._results.add_child(this._status);

        this._renderChips();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- chosen tickers ------------------------------------------------

    _renderChips() {
        this._chips.destroy_all_children();
        if (!this._chosen.length) {
            this._chips.add_child(new St.Label({
                text: 'None yet', style_class: 'peachos-stockpick-empty',
            }));
            return;
        }
        for (const sym of this._chosen) {
            const chip = new St.BoxLayout({style_class: 'peachos-stockpick-chip'});
            chip.add_child(new St.Label({
                text: sym.replace(/-USD$/, '').replace(/^\^/, ''),
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const x = new St.Button({
                style_class: 'peachos-stockpick-chip-x',
                child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 11}),
            });
            x.connect('clicked', () => this._remove(sym));
            chip.add_child(x);
            this._chips.add_child(chip);
        }
    }

    _add(sym) {
        sym = sym.toUpperCase();
        if (this._chosen.includes(sym))
            return;
        if (this._max === 1)
            this._chosen = [sym];
        else if (this._chosen.length < this._max)
            this._chosen.push(sym);
        else
            return;                                   // full
        this._renderChips();
        this._callbacks.onChange([...this._chosen]);
        this._entry.set_text('');
        this._entry.grab_key_focus();
    }

    _remove(sym) {
        this._chosen = this._chosen.filter(s => s !== sym);
        this._renderChips();
        this._callbacks.onChange([...this._chosen]);
    }

    // --- typeahead ---------------------------------------------------

    _onType() {
        const q = this._entry.get_text().trim();
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        if (!q) {
            this._cancelInflight();
            this._render([]);
            this._status.text = '';
            return;
        }
        // instant on a cache hit -- no spinner, no wait
        if (this._cache.has(q)) {
            this._render(this._cache.get(q));
            return;
        }
        this._status.text = 'Searching…';
        this._debounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._debounceId = 0;
                this._search(q);
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelInflight() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }

    _search(q) {
        this._cancelInflight();
        const seq = ++this._seq;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._ctx.stocks.search(q, cancellable, results => {
            if (seq !== this._seq)
                return;                               // stale
            this._cancellable = null;
            this._cache.set(q, results);
            // only paint if the entry still matches this query
            if (this._entry.get_text().trim() === q) {
                this._status.text = results.length ? '' : 'No matches';
                this._render(results);
            }
        });
    }

    _onActivate() {
        const q = this._entry.get_text().trim();
        if (!q)
            return;
        const rows = this._cache.get(q) || [];
        const exact = rows.find(r => r.symbol.toUpperCase() === q.toUpperCase());
        if (exact)
            this._add(exact.symbol);
        else if (rows.length)
            this._add(rows[0].symbol);
        else if (/^[A-Za-z0-9.\-^]{1,12}$/.test(q))
            this._add(q);
    }

    _render(rows) {
        for (const c of this._results.get_children()) {
            if (c !== this._status)
                c.destroy();
        }
        const full = this._max > 1 && this._chosen.length >= this._max;
        for (const r of rows) {
            const have = this._chosen.includes(r.symbol.toUpperCase());
            const btn = new St.Button({
                style_class: 'peachos-stockpick-result'
                    + (have ? ' selected' : ''),
                x_expand: true, can_focus: false,
                reactive: !have && !full,
            });
            const box = new St.BoxLayout({x_expand: true});
            box.add_child(new St.Label({
                text: r.symbol.replace(/-USD$/, '').replace(/^\^/, ''),
                style_class: 'peachos-stockpick-result-sym',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            box.add_child(new St.Label({
                text: r.name, x_expand: true,
                style_class: 'peachos-stockpick-result-name',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            if (r.exch) {
                box.add_child(new St.Label({
                    text: r.exch, style_class: 'peachos-stockpick-result-exch',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
            btn.set_child(box);
            btn.connect('clicked', () => this._add(r.symbol));
            this._results.add_child(btn);
        }
    }

    _finish() {
        if (this._done)
            return;
        this._done = true;
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._cancelInflight();
        this._callbacks.onDone();
    }

    destroy() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        this._cancelInflight();
        this._glass?.widget.destroy();
        super.destroy();
    }
});
