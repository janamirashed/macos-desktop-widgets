// World-clock model for the City clock widget. Timezone/DST math via the ICU
// Intl API (available in GJS); per-city day/night, hand angles, UTC offset,
// day-word. City table ported from the KDE repo's 1-common/components/cities.js.

export const CITY_TABLE = {
// --- North America ---
"America/New_York":       { code: "NYC",  name: "New York" },
"America/Detroit":        { code: "DET",  name: "Detroit" },
"America/Toronto":        { code: "YYZ",  name: "Toronto" },
"America/Montreal":       { code: "YUL",  name: "Montreal" },
"America/Chicago":        { code: "CHI",  name: "Chicago" },
"America/Winnipeg":       { code: "YWG",  name: "Winnipeg" },
"America/Mexico_City":    { code: "MEX",  name: "Mexico City" },
"America/Denver":         { code: "DEN",  name: "Denver" },
"America/Phoenix":        { code: "PHX",  name: "Phoenix" },
"America/Edmonton":       { code: "YEG",  name: "Edmonton" },
"America/Los_Angeles":    { code: "LAX",  name: "Los Angeles" },
"America/Vancouver":      { code: "YVR",  name: "Vancouver" },
"America/Tijuana":        { code: "TIJ",  name: "Tijuana" },
"America/Anchorage":      { code: "ANC",  name: "Anchorage" },
"America/Halifax":        { code: "YHZ",  name: "Halifax" },
"America/St_Johns":       { code: "YYT",  name: "St. John's" },
"America/Havana":         { code: "HAV",  name: "Havana" },
"Pacific/Honolulu":       { code: "HNL",  name: "Honolulu" },

// --- Central / South America ---
"America/Guatemala":      { code: "GUA",  name: "Guatemala City" },
"America/Panama":         { code: "PTY",  name: "Panama City" },
"America/Bogota":         { code: "BOG",  name: "Bogotá" },
"America/Lima":           { code: "LIM",  name: "Lima" },
"America/Caracas":        { code: "CCS",  name: "Caracas" },
"America/La_Paz":         { code: "LPB",  name: "La Paz" },
"America/Santiago":       { code: "SCL",  name: "Santiago" },
"America/Argentina/Buenos_Aires": { code: "BUE", name: "Buenos Aires" },
"America/Montevideo":     { code: "MVD",  name: "Montevideo" },
"America/Sao_Paulo":      { code: "SAO",  name: "São Paulo" },
"America/Asuncion":       { code: "ASU",  name: "Asunción" },

// --- Europe ---
"Atlantic/Reykjavik":     { code: "REK",  name: "Reykjavík" },
"Europe/Lisbon":          { code: "LIS",  name: "Lisbon" },
"Europe/Dublin":          { code: "DUB",  name: "Dublin" },
"Europe/London":          { code: "LON",  name: "London" },
"Europe/Madrid":          { code: "MAD",  name: "Madrid" },
"Europe/Paris":           { code: "PAR",  name: "Paris" },
"Europe/Brussels":        { code: "BRU",  name: "Brussels" },
"Europe/Amsterdam":       { code: "AMS",  name: "Amsterdam" },
"Europe/Berlin":          { code: "BER",  name: "Berlin" },
"Europe/Zurich":          { code: "ZRH",  name: "Zürich" },
"Europe/Rome":            { code: "ROM",  name: "Rome" },
"Europe/Vienna":          { code: "VIE",  name: "Vienna" },
"Europe/Prague":          { code: "PRG",  name: "Prague" },
"Europe/Copenhagen":      { code: "CPH",  name: "Copenhagen" },
"Europe/Oslo":            { code: "OSL",  name: "Oslo" },
"Europe/Stockholm":       { code: "STO",  name: "Stockholm" },
"Europe/Warsaw":          { code: "WAW",  name: "Warsaw" },
"Europe/Budapest":        { code: "BUD",  name: "Budapest" },
"Europe/Belgrade":        { code: "BEG",  name: "Belgrade" },
"Europe/Athens":          { code: "ATH",  name: "Athens" },
"Europe/Bucharest":       { code: "OTP",  name: "Bucharest" },
"Europe/Helsinki":        { code: "HEL",  name: "Helsinki" },
"Europe/Kyiv":            { code: "KBP",  name: "Kyiv" },
"Europe/Kiev":            { code: "KBP",  name: "Kyiv" },
"Europe/Istanbul":        { code: "IST",  name: "Istanbul" },
"Europe/Moscow":          { code: "MOW",  name: "Moscow" },

// --- Africa ---
"Africa/Casablanca":      { code: "CMN",  name: "Casablanca" },
"Africa/Lagos":           { code: "LOS",  name: "Lagos" },
"Africa/Accra":           { code: "ACC",  name: "Accra" },
"Africa/Algiers":         { code: "ALG",  name: "Algiers" },
"Africa/Tunis":           { code: "TUN",  name: "Tunis" },
"Africa/Cairo":           { code: "CAI",  name: "Cairo" },
"Africa/Johannesburg":    { code: "JNB",  name: "Johannesburg" },
"Africa/Cape_Town":       { code: "CPT",  name: "Cape Town" },
"Africa/Nairobi":         { code: "NBO",  name: "Nairobi" },
"Africa/Addis_Ababa":     { code: "ADD",  name: "Addis Ababa" },
"Africa/Kampala":         { code: "KLA",  name: "Kampala" },
"Africa/Kinshasa":        { code: "FIH",  name: "Kinshasa" },

// --- Middle East / West Asia ---
"Asia/Jerusalem":         { code: "JLM",  name: "Jerusalem" },
"Asia/Beirut":            { code: "BEY",  name: "Beirut" },
"Asia/Amman":             { code: "AMM",  name: "Amman" },
"Asia/Riyadh":            { code: "RUH",  name: "Riyadh" },
"Asia/Qatar":             { code: "DOH",  name: "Doha" },
"Asia/Dubai":             { code: "DXB",  name: "Dubai" },
"Asia/Tehran":            { code: "THR",  name: "Tehran" },
"Asia/Baghdad":           { code: "BGW",  name: "Baghdad" },
"Asia/Kuwait":            { code: "KWI",  name: "Kuwait City" },
"Asia/Baku":              { code: "GYD",  name: "Baku" },
"Asia/Yerevan":           { code: "EVN",  name: "Yerevan" },
"Asia/Tbilisi":           { code: "TBS",  name: "Tbilisi" },

// --- Central / South Asia ---
"Asia/Karachi":           { code: "KHI",  name: "Karachi" },
"Asia/Tashkent":          { code: "TAS",  name: "Tashkent" },
"Asia/Kabul":             { code: "KBL",  name: "Kabul" },
"Asia/Kolkata":           { code: "DEL",  name: "Mumbai" },
"Asia/Calcutta":          { code: "DEL",  name: "Mumbai" },
"Asia/Colombo":           { code: "CMB",  name: "Colombo" },
"Asia/Kathmandu":         { code: "KTM",  name: "Kathmandu" },
"Asia/Dhaka":             { code: "DAC",  name: "Dhaka" },
"Asia/Almaty":            { code: "ALA",  name: "Almaty" },

// --- East / Southeast Asia ---
"Asia/Yangon":            { code: "RGN",  name: "Yangon" },
"Asia/Bangkok":           { code: "BKK",  name: "Bangkok" },
"Asia/Jakarta":           { code: "JKT",  name: "Jakarta" },
"Asia/Ho_Chi_Minh":       { code: "SGN",  name: "Ho Chi Minh City" },
"Asia/Saigon":            { code: "SGN",  name: "Ho Chi Minh City" },
"Asia/Kuala_Lumpur":      { code: "KUL",  name: "Kuala Lumpur" },
"Asia/Singapore":         { code: "SIN",  name: "Singapore" },
"Asia/Manila":            { code: "MNL",  name: "Manila" },
"Asia/Hong_Kong":         { code: "HKG",  name: "Hong Kong" },
"Asia/Taipei":            { code: "TPE",  name: "Taipei" },
"Asia/Shanghai":          { code: "SHA",  name: "Shanghai" },
"Asia/Chongqing":         { code: "CKG",  name: "Chongqing" },
"Asia/Urumqi":            { code: "URC",  name: "Ürümqi" },
"Asia/Seoul":             { code: "SEL",  name: "Seoul" },
"Asia/Pyongyang":         { code: "FNJ",  name: "Pyongyang" },
"Asia/Tokyo":             { code: "TYO",  name: "Tokyo" },
"Asia/Ulaanbaatar":       { code: "ULN",  name: "Ulaanbaatar" },
"Asia/Vladivostok":       { code: "VVO",  name: "Vladivostok" },
"Asia/Yekaterinburg":     { code: "SVX",  name: "Yekaterinburg" },
"Asia/Novosibirsk":       { code: "OVB",  name: "Novosibirsk" },
"Asia/Krasnoyarsk":       { code: "KJA",  name: "Krasnoyarsk" },

// --- Oceania ---
"Australia/Perth":        { code: "PER",  name: "Perth" },
"Australia/Adelaide":     { code: "ADL",  name: "Adelaide" },
"Australia/Darwin":       { code: "DRW",  name: "Darwin" },
"Australia/Brisbane":     { code: "BNE",  name: "Brisbane" },
"Australia/Sydney":       { code: "SYD",  name: "Sydney" },
"Australia/Melbourne":    { code: "MEL",  name: "Melbourne" },
"Australia/Hobart":       { code: "HBA",  name: "Hobart" },
"Pacific/Auckland":       { code: "AKL",  name: "Auckland" },
"Pacific/Fiji":           { code: "SUV",  name: "Suva" },
"Pacific/Port_Moresby":   { code: "POM",  name: "Port Moresby" },
"Pacific/Guam":           { code: "GUM",  name: "Guam" },
"Pacific/Tongatapu":      { code: "TBU",  name: "Nukuʻalofa" },
"Pacific/Pago_Pago":      { code: "PPG",  name: "Pago Pago" }
};

function nameFromTz(tz) {
    if (!tz)
        return '';
    const seg = String(tz).split('/').pop().replace(/_/g, ' ');
    return seg.replace(/\b\w/g, c => c.toUpperCase());
}

function codeFromName(name) {
    if (!name)
        return '';
    const words = name.split(' ').filter(w => w.length > 0);
    if (words.length >= 2)
        return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
    return name.slice(0, 3).toUpperCase();
}

export function lookupCity(tz) {
    if (tz && Object.prototype.hasOwnProperty.call(CITY_TABLE, tz))
        return {tz, ...CITY_TABLE[tz]};
    const name = nameFromTz(tz);
    return {tz, code: codeFromName(name), name};
}

/** All known cities as [{tz, code, name}], sorted by name. */
export function allCities() {
    return Object.entries(CITY_TABLE)
        .map(([tz, v]) => ({tz, code: v.code, name: v.name}))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function tzParts(tz, date) {
    const p = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        year: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(date);
    const g = k => parseInt(p.find(x => x.type === k)?.value ?? '0', 10);
    let hour = g('hour');
    if (hour === 24)
        hour = 0;
    return {hour, minute: g('minute'), second: g('second'),
        year: g('year'), month: g('month'), day: g('day')};
}

function offsetHours(tz, date) {
    const s = new Intl.DateTimeFormat('en-US', {timeZone: tz, timeZoneName: 'shortOffset'})
        .formatToParts(date).find(x => x.type === 'timeZoneName')?.value ?? 'GMT+0';
    const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m)
        return 0;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0));
}

/**
 * @param {string} tz  IANA timezone
 * @returns {{code,name,tz,hourAngle,minuteAngle,secondAngle,isDay,offsetLabel,dayWord}}
 */
export function computeCity(tz, date = new Date()) {
    const info = lookupCity(tz);
    const t = tzParts(tz, date);
    const min = t.minute + t.second / 60;
    const hr = (t.hour % 12) + min / 60;

    const relLocal = -date.getTimezoneOffset() / 60;
    const rel = offsetHours(tz, date) - relLocal;
    const sign = rel > 0 ? '+' : (rel < 0 ? '-' : '');
    const abs = Math.abs(rel);
    const num = abs % 1 === 0 ? `${abs}` : abs.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

    const zoneDay = Date.UTC(t.year, t.month - 1, t.day);
    const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((zoneDay - localDay) / 86400000);

    return {
        code: info.code,
        name: info.name,
        tz,
        hourAngle: hr / 12 * 360,
        minuteAngle: min / 60 * 360,
        secondAngle: t.second / 60 * 360,
        isDay: t.hour >= 6 && t.hour < 18,
        offsetLabel: `${sign}${num}HRS`,
        dayWord: diff < 0 ? 'Yesterday' : (diff > 0 ? 'Tomorrow' : 'Today'),
        hour12: ((t.hour + 11) % 12) + 1,
        minute: t.minute,
        ampm: t.hour < 12 ? 'AM' : 'PM',
    };
}
