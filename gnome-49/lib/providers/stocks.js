// Stock / ETF / index / crypto quotes from Yahoo Finance's public endpoints
// (no key):
//   quote + sparkline: v8/finance/chart/<symbol>?range=1d&interval=5m
//   ticker search:     v1/finance/search?q=<query>
// Symbols are chosen per-widget (lib/stockPicker.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const REFRESH_SECONDS = 90;
const CHART_URL = s =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}`
    + '?range=1d&interval=5m';
const SEARCH_URL = q =>
    'https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&newsCount=0&q='
    + encodeURIComponent(q);

export const STOCK_DEFAULTS = {square: ['SPY'], row: ['SPY', 'AAPL', 'BTC-USD']};
export const STOCK_MAX = {square: 1, row: 3};

// friendlier display names for common symbols; anything else uses the ticker
const LABELS = {
    'SPY': 'SPY', 'AAPL': 'AAPL', 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum',
    '^GSPC': 'S&P 500', '^DJI': 'Dow Jones', '^IXIC': 'NASDAQ', '^RUT': 'Russell 2000',
};

// quote types we surface in search, best first
const TYPE_RANK = {EQUITY: 0, ETF: 1, INDEX: 1, CRYPTOCURRENCY: 2, CURRENCY: 3, MUTUALFUND: 4};
const US_EXCH = new Set(['NASDAQ', 'NYSE', 'NYSEArca', 'NYSE American', 'CCC', 'DJI', 'SNP', 'NIM', 'BATS', 'PCX']);

function fmtPrice(v) {
    if (!Number.isFinite(v))
        return '--';
    return v.toLocaleString('en-US', {
        minimumFractionDigits: v >= 2000 ? 0 : 2,
        maximumFractionDigits: v >= 2000 ? 0 : 2,
    });
}

function labelFor(symbol, shortName) {
    if (LABELS[symbol])
        return LABELS[symbol];
    if (symbol.endsWith('-USD'))
        return (shortName || symbol).replace(/\s*USD$/, '');
    return symbol.replace(/^\^/, '');
}

export class StocksProvider {
    constructor() {
        this._session = new Soup.Session({timeout: 15});
        this._listeners = new Set();
        this._data = new Map();     // symbol -> quote
        this._wanted = new Map();   // symbol -> refcount

        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn();
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners)
            fn();
    }

    get(symbol) {
        return this._data.get(symbol) ?? null;
    }

    /** Keep `symbols` refreshed for as long as the returned fn isn't called. */
    watch(symbols) {
        const list = [...new Set(symbols)];
        for (const s of list) {
            this._wanted.set(s, (this._wanted.get(s) ?? 0) + 1);
            if (!this._data.has(s))
                this._fetch(s);
        }
        return () => {
            for (const s of list) {
                const n = (this._wanted.get(s) ?? 1) - 1;
                if (n <= 0) {
                    this._wanted.delete(s);
                    this._data.delete(s);
                } else {
                    this._wanted.set(s, n);
                }
            }
        };
    }

    refresh() {
        for (const s of this._wanted.keys())
            this._fetch(s);
    }

    _fetch(symbol) {
        const msg = Soup.Message.new('GET', CHART_URL(symbol));
        msg.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)');
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (src, res) => {
            try {
                const bytes = src.send_and_read_finish(res);
                if (msg.get_status() !== Soup.Status.OK)
                    return;
                const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                const r = j?.chart?.result?.[0];
                if (!r)
                    return;
                const m = r.meta ?? {};
                const price = Number(m.regularMarketPrice);
                const prev = Number(m.chartPreviousClose ?? m.previousClose);
                if (!Number.isFinite(price) || !Number.isFinite(prev))
                    return;
                const spark = (r.indicators?.quote?.[0]?.close ?? []).filter(v => v != null);
                const pct = ((price - prev) / prev) * 100;
                const up = price >= prev;
                this._data.set(symbol, {
                    symbol,
                    label: labelFor(symbol, m.shortName),
                    sub: m.shortName || m.longName || symbol,
                    price,
                    prev,
                    priceText: fmtPrice(price),
                    changePct: pct,
                    changeText: `${up ? '+' : ''}${pct.toFixed(2)}%`,
                    up,
                    spark: spark.length >= 2 ? spark : [prev, price],
                });
                this._emit();
            } catch (e) {
                logError(e, '[peachos-widgets] stock fetch failed');
            }
        });
    }

    /**
     * Ticker typeahead. `cancellable` lets the caller drop an in-flight
     * request; `cb(results)` gets [{symbol, name, type, exch}] (may be []).
     */
    search(query, cancellable, cb) {
        const q = (query || '').trim();
        if (q.length < 1) {
            cb([]);
            return;
        }
        const msg = Soup.Message.new('GET', SEARCH_URL(q));
        msg.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)');
        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, cancellable, (src, res) => {
                try {
                    const bytes = src.send_and_read_finish(res);
                    if (msg.get_status() !== Soup.Status.OK) {
                        cb([]);
                        return;
                    }
                    const j = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    const rows = (j.quotes ?? [])
                        .filter(x => x.symbol && x.quoteType in TYPE_RANK)
                        .map(x => ({
                            symbol: x.symbol,
                            name: x.shortname || x.longname || x.symbol,
                            type: x.quoteType,
                            exch: x.exchDisp || '',
                        }));
                    const ql = q.toUpperCase();
                    rows.sort((a, b) => {
                        const ax = a.symbol.toUpperCase() === ql ? -1 : 0;
                        const bx = b.symbol.toUpperCase() === ql ? -1 : 0;
                        if (ax !== bx)
                            return ax - bx;
                        const au = US_EXCH.has(a.exch.split(' ')[0]) ? 0 : 1;
                        const bu = US_EXCH.has(b.exch.split(' ')[0]) ? 0 : 1;
                        if (au !== bu)
                            return au - bu;
                        return (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
                    });
                    cb(rows.slice(0, 7));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        cb([]);
                }
            });
    }

    destroy() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._session.abort();
        this._listeners.clear();
        this._data.clear();
        this._wanted.clear();
    }
}
