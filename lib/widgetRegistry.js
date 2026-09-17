// The catalogue the picker reads and widgetLayer instantiates from.
//
// type -> { name, appIcon (themed icon name, resolves in the MacTahoe theme),
//           variants: { id -> { name, shape, configurable?, make } } }
//
// There are three footprints and one fixed size:
//   'square' -- UNIT x UNIT
//   'row'    -- (UNIT*2 + GAP) x UNIT              (double width, same height)
//   'grid'   -- (UNIT*2 + GAP) x (UNIT*2 + GAP)    (2x2)
// Every widget's layout is derived from those pixels (KDE-style).

import {DigitalClock, AnalogClock} from '../widgets/clock.js';
import {CityClock} from '../widgets/cityClock.js';
import {WeatherWidget} from '../widgets/weather.js';
import {CalendarWidget} from '../widgets/calendar.js';
import {RemindersWidget} from '../widgets/reminders.js';
import {StocksWidget} from '../widgets/stocks.js';
import {NewsWidget} from '../widgets/news.js';
import {PhotosWidget} from '../widgets/photos.js';
import {MailWidget} from '../widgets/mail.js';

export const UNIT = 170;          // square widget side, px
export const ROW_GAP = 8;         // gap a row spans (matches widgetLayer GAP)
const RADIUS = Math.round(UNIT * 0.24);

function shapeSize(shape) {
    const wide = shape === 'row' || shape === 'grid';
    const tall = shape === 'grid';
    return {
        w: wide ? UNIT * 2 + ROW_GAP : UNIT,
        h: tall ? UNIT * 2 + ROW_GAP : UNIT,
        radius: RADIUS,
    };
}

export const REGISTRY = {
    clock: {
        name: 'Clock',
        appIcon: 'org.gnome.Clocks',
        variants: {
            digital: {
                name: 'Digital', shape: 'square',
                make: (parent, ctx, size) => new DigitalClock(parent, size),
            },
            analog: {
                name: 'Analog', shape: 'square',
                make: (parent, ctx, size) => new AnalogClock(parent, size, 'minimal'),
            },
            classic: {
                name: 'Classic', shape: 'square',
                make: (parent, ctx, size) => new AnalogClock(parent, size, 'classic'),
            },
            dial: {
                name: 'Dial', shape: 'square',
                make: (parent, ctx, size) => new AnalogClock(parent, size, 'fullface'),
            },
            world: {
                name: 'World', shape: 'square', configurable: true,
                make: (parent, ctx, size) => new CityClock(parent, ctx, {...size, layout: 'grid'}),
            },
            worldRow: {
                name: 'World Row', shape: 'row', configurable: true,
                make: (parent, ctx, size) => new CityClock(parent, ctx, {...size, layout: 'row'}),
            },
        },
    },
    weather: {
        name: 'Weather',
        appIcon: 'org.gnome.Weather',
        variants: {
            conditions: {
                name: 'Conditions', shape: 'square',
                make: (parent, ctx, size) => new WeatherWidget(parent, ctx, size, 'small'),
            },
            forecast: {
                name: 'Hourly', shape: 'row',
                make: (parent, ctx, size) => new WeatherWidget(parent, ctx, size, 'big'),
            },
            week: {
                name: 'Forecast', shape: 'grid',
                make: (parent, ctx, size) => new WeatherWidget(parent, ctx, size, 'full'),
            },
        },
    },
    calendar: {
        name: 'Calendar',
        appIcon: 'org.gnome.Calendar',
        variants: {
            month: {
                name: 'Month', shape: 'square',
                make: (parent, ctx, size) => new CalendarWidget(parent, ctx, size, 'month'),
            },
            agenda: {
                name: 'Agenda', shape: 'row',
                make: (parent, ctx, size) => new CalendarWidget(parent, ctx, size, 'agenda'),
            },
        },
    },
    news: {
        name: 'News',
        appIcon: 'icons/app/news.png',
        variants: {
            story: {
                name: 'Story', shape: 'square', configurable: true, config: 'newsTopic',
                make: (parent, ctx, size) => new NewsWidget(parent, ctx, size, 'square'),
            },
            headlines: {
                name: 'Headlines', shape: 'row', configurable: true, config: 'newsTopic',
                make: (parent, ctx, size) => new NewsWidget(parent, ctx, size, 'row'),
            },
            digest: {
                name: 'Digest', shape: 'grid', configurable: true, config: 'newsTopic',
                make: (parent, ctx, size) => new NewsWidget(parent, ctx, size, 'grid'),
            },
        },
    },
    stocks: {
        name: 'Stocks',
        appIcon: 'icons/app/stocks.png',
        variants: {
            single: {
                name: 'SPY', shape: 'square', configurable: true, config: 'stocks',
                make: (parent, ctx, size) => new StocksWidget(parent, ctx, size, 'square'),
            },
            row: {
                name: 'Watchlist', shape: 'row', configurable: true, config: 'stocks',
                make: (parent, ctx, size) => new StocksWidget(parent, ctx, size, 'row'),
            },
        },
    },
    reminders: {
        name: 'Reminders',
        appIcon: 'org.gnome.Todo',
        variants: {
            list: {
                name: 'List', shape: 'square',
                make: (parent, ctx, size) => new RemindersWidget(parent, ctx, size, 'list'),
            },
            wide: {
                name: 'Wide', shape: 'row',
                make: (parent, ctx, size) => new RemindersWidget(parent, ctx, size, 'wide'),
            },
        },
    },
    photos: {
        name: 'Photos',
        appIcon: 'org.gnome.Photos',
        variants: {
            single: {
                name: 'Photo', shape: 'square',
                make: (parent, ctx, size) => new PhotosWidget(parent, ctx, size, 'square'),
            },
            grid: {
                name: 'Featured', shape: 'grid',
                make: (parent, ctx, size) => new PhotosWidget(parent, ctx, size, 'grid'),
            },
        },
    },
    gmail: {
        name: 'Gmail',
        appIcon: 'icons/app/mail-gmail.png',
        variants: {
            row: {
                name: 'Inbox', shape: 'row',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'row', {brand: 'google'}),
            },
            big: {
                name: 'Large', shape: 'grid',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'grid', {brand: 'google'}),
            },
        },
    },
    icloudmail: {
        name: 'iCloud Mail',
        appIcon: 'icons/app/mail-icloud.svg',
        variants: {
            row: {
                name: 'Inbox', shape: 'row',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'row', {brand: 'apple'}),
            },
            big: {
                name: 'Large', shape: 'grid',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'grid', {brand: 'apple'}),
            },
        },
    },
    outlook: {
        name: 'Outlook',
        appIcon: 'icons/app/mail-outlook.png',
        variants: {
            row: {
                name: 'Inbox', shape: 'row',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'row', {brand: 'microsoft'}),
            },
            big: {
                name: 'Large', shape: 'grid',
                make: (parent, ctx, size) =>
                    new MailWidget(parent, ctx, size, 'grid', {brand: 'microsoft'}),
            },
        },
    },
    gcalendar: {
        name: 'Google Calendar',
        appIcon: 'icons/app/gcalendar.png',
        variants: {
            month: {
                name: 'Month', shape: 'square',
                make: (parent, ctx, size) =>
                    new CalendarWidget(parent, ctx, size, 'month', {brand: 'google'}),
            },
            agenda: {
                name: 'Agenda', shape: 'row',
                make: (parent, ctx, size) =>
                    new CalendarWidget(parent, ctx, size, 'agenda', {brand: 'google'}),
            },
        },
    },
};

export function variantDef(type, variant) {
    return REGISTRY[type]?.variants[variant] ?? null;
}

/** Real pixel geometry for a (type, variant) -- one of two fixed footprints. */
export function sizeFor(type, variant) {
    const def = variantDef(type, variant);
    if (!def)
        return null;
    return shapeSize(def.shape);
}
