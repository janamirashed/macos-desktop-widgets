// Weather data from Open-Meteo (no API key, plain HTTPS GET via libsoup -- the
// same Soup.Session/send_and_read_async pattern as
// macos-top-panel/lib/mediaPlayerController.js). Ported from the KDE repo's
// WeatherData.qml; location + unit come from this extension's gsettings.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const REFRESH_SECONDS = 900;       // weather, 15 min
const RELOCATE_SECONDS = 6 * 3600; // re-check IP geolocation, 6 h

// Free, key-less, HTTPS IP-geolocation endpoints, tried in order until one
// returns a usable fix. ipinfo.io and geojs.io resolve to the actual city on
// most US ISPs; ipapi.co is last -- it has been seen returning the upstream
// carrier hub instead (e.g. Minneapolis for eastern Iowa).
const GEOIP_SOURCES = [
    {
        url: 'https://ipinfo.io/json',
        parse: j => {
            const [la, lo] = String(j.loc || '').split(',');
            return {lat: parseFloat(la), lon: parseFloat(lo), name: j.city, region: j.region};
        },
    },
    {
        url: 'https://get.geojs.io/v1/ip/geo.json',
        parse: j => ({
            lat: parseFloat(j.latitude), lon: parseFloat(j.longitude),
            name: j.city, region: j.region,
        }),
    },
    {
        url: 'https://ipapi.co/json/',
        parse: j => ({
            lat: parseFloat(j.latitude), lon: parseFloat(j.longitude),
            name: j.city, region: j.region,
        }),
    },
];

function windCompass(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
}

// WMO code -> KDE icon-set basename (icons/weather/*.png).
export function wmoIconName(code, isDay = true) {
    const night = !isDay;
    if (code === 0)
        return night ? 'clearnight' : 'sunny';
    if (code === 1 || code === 2)
        return night ? 'partlycloudynight' : 'partlysunny';
    if (code === 3)
        return 'cloudy';
    if (code === 45 || code === 48)
        return 'fog';
    if (code === 56 || code === 57 || code === 66 || code === 67)
        return 'sleet';                               // freezing drizzle / rain
    if (code >= 51 && code <= 55)
        return night ? 'nightdrizzle' : 'drizzle';
    if (code === 61 || code === 63)
        return 'rain';
    if (code === 65)
        return 'heavyrain';
    if (code === 71 || code === 73 || code === 75 || code === 85 || code === 86)
        return 'snow';
    if (code === 77)
        return 'scatteredsnow';
    if (code === 80 || code === 81)
        return 'rain';
    if (code === 82)
        return 'heavyrain';
    if (code >= 95)
        return 'thunderbolt';
    return night ? 'clearnight' : 'sunny';
}

// Card colour for the weather widget's "light" mode: the sky. Vertical
// gradient top->bottom, plus `dark` = true when the sky is dark enough that
// the widget should switch to white text.
export function skyGradient(code, isDay) {
    const hex = h => [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
    ];
    const G = (t, b, dark) => ({top: hex(t), bottom: hex(b), dark});

    if (!isDay) {
        if (code <= 1)
            return G('0a1626', '20364f', true);   // clear night -- dusky blue-black
        if (code === 2)
            return G('101d2c', '2b3d51', true);
        if (code === 3 || code === 45 || code === 48)
            return G('1a222c', '333d47', true);   // overcast night
        if (code >= 95)
            return G('141a24', '2a3340', true);
        if (code >= 51)
            return G('141c26', '2b3742', true);   // rain/snow night
        return G('0d1a2b', '243b54', true);
    }
    if (code <= 1)
        return G('3d84c6', '9ac6ec', false);      // clear day -- blue
    if (code === 2)
        return G('5391c9', 'a9cbe6', false);      // partly cloudy
    if (code === 3)
        return G('8a97a3', 'b9c2cb', false);      // overcast -- grey
    if (code === 45 || code === 48)
        return G('9aa1a8', 'c6cace', false);      // fog
    if ((code >= 71 && code <= 77) || code === 85 || code === 86)
        return G('93aac2', 'cdd9e6', false);      // snow
    if (code >= 95)
        return G('3a4653', '5b6675', true);       // thunderstorm
    if (code >= 51)
        return G('5c6b7a', '8894a1', true);       // rain / drizzle
    return G('3d84c6', '9ac6ec', false);
}

// WMO code -> human condition label (ported from WeatherData.qml).
export function wmoCondition(code) {
    const map = {
        0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Rime Fog',
        51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
        56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
        61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
        66: 'Freezing Rain', 67: 'Freezing Rain',
        71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
        80: 'Rain Showers', 81: 'Rain Showers', 82: 'Violent Showers',
        85: 'Snow Showers', 86: 'Snow Showers',
        95: 'Thunderstorm', 96: 'Thunderstorm with Hail', 99: 'Heavy Thunderstorm',
    };
    return map[code] ?? '—';
}

export class WeatherProvider {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session({timeout: 15});
        this._listeners = new Set();
        this._data = null;
        this._error = null;
        this._auto = settings.get_boolean('weather-auto-location');
        this._loc = null; // {lat, lon, name} once IP geolocation resolves

        this._settings.connectObject(
            'changed::weather-auto-location', () => {
                this._auto = this._settings.get_boolean('weather-auto-location');
                this._loc = null;
                this._resolveLocation();
            },
            'changed::weather-latitude', () => {
                if (!this._auto)
                    this.refresh();
            },
            'changed::weather-longitude', () => {
                if (!this._auto)
                    this.refresh();
            },
            'changed::weather-unit', () => this.refresh(),
            'changed::weather-location-name', () => {
                if (!this._auto)
                    this._reemit();
            },
            this);

        this._resolveLocation();
        this._periodicId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._relocateId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RELOCATE_SECONDS, () => {
            this._resolveLocation();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fetchJSON(url, cb) {
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append('User-Agent', 'peachOS-widgets/1');
        this._session.send_and_read_async(
            msg, GLib.PRIORITY_DEFAULT, null, (src, res) => {
                try {
                    const bytes = src.send_and_read_finish(res);
                    if (msg.get_status() !== Soup.Status.OK) {
                        cb(null);
                        return;
                    }
                    cb(JSON.parse(new TextDecoder().decode(bytes.get_data())));
                } catch (e) {
                    cb(null);
                }
            });
    }

    // Geolocate by IP (when weather-auto-location is on), then fetch weather.
    _resolveLocation() {
        if (!this._auto) {
            this._loc = null;
            this.refresh();
            return;
        }
        const tryNext = i => {
            if (i >= GEOIP_SOURCES.length) {
                // Every source failed (usually no network this early in the
                // boot). Fall back to the settings coords -- Savannah, GA out
                // of the box -- and retry geolocation shortly so a transient
                // failure doesn't pin the widget there until the 6 h relocate.
                this.refresh();
                if (!this._geoipRetryId) {
                    this._geoipRetryId = GLib.timeout_add_seconds(
                        GLib.PRIORITY_LOW, 120, () => {
                            this._geoipRetryId = 0;
                            if (this._auto && !this._loc)
                                this._resolveLocation();
                            return GLib.SOURCE_REMOVE;
                        });
                }
                return;
            }
            const src = GEOIP_SOURCES[i];
            this._fetchJSON(src.url, j => {
                const r = j ? src.parse(j) : {};
                if (Number.isFinite(r.lat) && Number.isFinite(r.lon) &&
                    (r.lat !== 0 || r.lon !== 0)) {
                    this._loc = {
                        lat: r.lat, lon: r.lon,
                        name: r.name || r.region || 'Current Location',
                    };
                    this.refresh();
                } else {
                    tryNext(i + 1);
                }
            });
        };
        tryNext(0);
    }

    _locName() {
        return this._loc?.name || this._settings.get_string('weather-location-name');
    }

    get autoLocation() {
        return this._auto;
    }

    get locationName() {
        return this._locName();
    }

    // Drop widgets to their loading state until the next payload lands.
    _clearForReload() {
        this._data = null;
        this._error = null;
        this._emit();
    }

    /** Toggle IP auto-location on/off (persisted); refetches immediately. */
    setAutoLocation(on) {
        this._auto = !!on;
        this._loc = null;
        this._settings.set_boolean('weather-auto-location', this._auto);
        this._clearForReload();
        if (this._auto)
            this._resolveLocation();
        else
            this.refresh();
    }

    /** Pin a manually chosen place (turns auto-location off). */
    setManualLocation(lat, lon, name) {
        this._auto = false;
        this._loc = null;
        this._settings.set_boolean('weather-auto-location', false);
        this._settings.set_double('weather-latitude', lat);
        this._settings.set_double('weather-longitude', lon);
        this._settings.set_string('weather-location-name', name);
        this._clearForReload();
        this.refresh();
    }

    /** Open-Meteo geocoding search -> cb([{lat, lon, name, label}]). */
    geocode(query, cb) {
        const q = encodeURIComponent((query || '').trim());
        if (!q) {
            cb([]);
            return;
        }
        this._fetchJSON(
            'https://geocoding-api.open-meteo.com/v1/search'
            + `?name=${q}&count=6&language=en&format=json`,
            j => cb((j && Array.isArray(j.results) ? j.results : []).map(r => ({
                lat: r.latitude,
                lon: r.longitude,
                name: r.name,
                label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
            }))));
    }

    get data() {
        return this._data;
    }

    get error() {
        return this._error;
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn(this._data, this._error);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners)
            fn(this._data, this._error);
    }

    _reemit() {
        if (this._data)
            this._data.name = this._locName();
        this._emit();
    }

    refresh() {
        const lat = this._loc?.lat ?? this._settings.get_double('weather-latitude');
        const lon = this._loc?.lon ?? this._settings.get_double('weather-longitude');
        const unit = this._settings.get_string('weather-unit');

        const windUnit = unit === 'celsius' ? 'kmh' : 'mph';
        const url = 'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${lat}&longitude=${lon}`
            + '&current=temperature_2m,apparent_temperature,weather_code,is_day,'
            + 'precipitation,wind_speed_10m,wind_direction_10m'
            + '&hourly=temperature_2m,weather_code'
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,'
            + 'precipitation_probability_max,sunrise,sunset'
            + `&temperature_unit=${unit}&wind_speed_unit=${windUnit}&timezone=auto&forecast_days=8`;

        const msg = Soup.Message.new('GET', url);
        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                if (msg.get_status() !== Soup.Status.OK) {
                    this._error = `HTTP ${msg.get_status()}`;
                    this._emit();
                    return;
                }
                const json = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                this._data = this._parse(json);
                this._error = null;
                this._emit();
            } catch (e) {
                logError(e, '[peachos-widgets] weather fetch failed');
                this._error = 'unavailable';
                this._emit();
            }
        });
    }

    _parse(j) {
        const metric = this._settings.get_string('weather-unit') === 'celsius';
        const unitLetter = metric ? 'C' : 'F';
        const windUnit = metric ? 'km/h' : 'mph';
        const cur = j.current ?? {};
        const daily = j.daily ?? {};
        const hourly = j.hourly ?? {};
        const days = (daily.time ?? []).map((iso, i) => {
            const d = new Date(`${iso}T12:00:00`);
            return {
                label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, {weekday: 'short'}),
                hi: Math.round(daily.temperature_2m_max?.[i] ?? 0),
                lo: Math.round(daily.temperature_2m_min?.[i] ?? 0),
                code: daily.weather_code?.[i] ?? 0,
                precipProb: daily.precipitation_probability_max?.[i] ?? null,
            };
        });

        // Sunrise / sunset events across the loaded days.
        const sun = [];
        (daily.time ?? []).forEach((_, i) => {
            if (daily.sunrise?.[i])
                sun.push({type: 'sunrise', time: new Date(daily.sunrise[i])});
            if (daily.sunset?.[i])
                sun.push({type: 'sunset', time: new Date(daily.sunset[i])});
        });
        sun.sort((a, b) => a.time - b.time);
        // Daytime at instant t = the most recent sun event before t is a sunrise.
        const isDaytime = t => {
            let day = cur.is_day !== 0;
            let seen = false;
            for (const e of sun) {
                if (e.time > t)
                    break;
                day = e.type === 'sunrise';
                seen = true;
            }
            return seen ? day : cur.is_day !== 0;
        };

        // Next hourly slots from now (per-slot day/night from the sun table).
        const nowMs = Date.now();
        const hourFmt = {hour: 'numeric'};
        const hours = [];
        const times = hourly.time ?? [];
        for (let i = 0; i < times.length && hours.length < 8; i++) {
            const dt = new Date(times[i]);
            if (dt.getTime() < nowMs - 3600000)
                continue;
            hours.push({
                kind: 'hour',
                time: dt,
                hour: dt.toLocaleTimeString(undefined, hourFmt),
                temp: Math.round(hourly.temperature_2m?.[i] ?? 0),
                code: hourly.weather_code?.[i] ?? 0,
                isDay: isDaytime(dt),
            });
        }

        // Merge in any sunrise/sunset that lands inside the hourly window, the
        // way Apple Weather slots them into the strip.
        const strip = hours.slice();
        if (hours.length) {
            const lo = hours[0].time;
            const hi = hours[hours.length - 1].time;
            for (const e of sun) {
                if (e.time >= lo && e.time <= hi) {
                    strip.push({
                        kind: 'sun',
                        time: e.time,
                        type: e.type,
                        hour: e.time.toLocaleTimeString(undefined,
                            {hour: 'numeric', minute: '2-digit'}),
                    });
                }
            }
            strip.sort((a, b) => a.time - b.time);
        }

        const precipProb = days[0]?.precipProb ?? null;
        const precipExpected =
            (precipProb != null && precipProb >= 30) || (cur.precipitation ?? 0) > 0;

        return {
            name: this._locName(),
            temp: Math.round(cur.temperature_2m ?? 0),
            feels: Math.round(cur.apparent_temperature ?? 0),
            code: cur.weather_code ?? 0,
            isDay: cur.is_day !== 0,
            unit: unitLetter,
            wind: Math.round(cur.wind_speed_10m ?? 0),
            windUnit,
            windDir: windCompass(cur.wind_direction_10m ?? 0),
            precip: cur.precipitation ?? 0,
            precipProb,
            precipText: precipExpected
                ? 'Precipitation expected today'
                : 'No precipitation expected today',
            hi: days[0]?.hi ?? 0,
            lo: days[0]?.lo ?? 0,
            sunrise: sun.find(e => e.type === 'sunrise' && e.time.getTime() >= nowMs)?.time ?? null,
            sunset: sun.find(e => e.type === 'sunset' && e.time.getTime() >= nowMs)?.time ?? null,
            days,
            hours,
            strip,
        };
    }

    destroy() {
        if (this._periodicId)
            GLib.source_remove(this._periodicId);
        this._periodicId = 0;
        if (this._relocateId)
            GLib.source_remove(this._relocateId);
        this._relocateId = 0;
        if (this._geoipRetryId)
            GLib.source_remove(this._geoipRetryId);
        this._geoipRetryId = 0;
        this._settings.disconnectObject(this);
        this._session.abort();
        this._listeners.clear();
        this._data = null;
    }
}
