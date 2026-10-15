// Pure date/accounting helpers shared with the regression tests.
export function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function recordInterval(days, start, end, appId = null) {
    while (start < end) {
        const date = new Date(start);
        const key = localDay(date);
        const hour = date.getHours();
        const next = new Date(start);
        next.setHours(hour + 1, 0, 0, 0);
        const stop = Math.min(end, next.getTime());
        const seconds = (stop - start) / 1000;
        const day = days[key] ??= {total: 0, hourly: Array(24).fill(0), apps: {},
            hourlyApps: Array.from({length: 24}, () => ({}))};
        day.total += seconds;
        day.hourly[hour] += seconds;
        if (appId) {
            day.apps[appId] = (day.apps[appId] || 0) + seconds;
            day.hourlyApps[hour][appId] = (day.hourlyApps[hour][appId] || 0) + seconds;
        }
        start = stop;
    }
}

export function utcDay(date = new Date()) { return date.toISOString().slice(0, 10); }

export function activityStreak(calendar, now = new Date()) {
    const date = new Date(`${utcDay(now)}T00:00:00Z`);
    const has = d => (calendar[String(d.getTime() / 1000)] || 0) > 0;
    if (!has(date)) date.setUTCDate(date.getUTCDate() - 1);
    let streak = 0;
    while (has(date)) { streak++; date.setUTCDate(date.getUTCDate() - 1); }
    return streak;
}

export function dailyStatus(daily, connected, fetchedDay, now = new Date()) {
    if (!connected || !daily || fetchedDay !== utcDay(now) || daily.date !== utcDay(now))
        return 'unknown';
    if (daily.userStatus === 'Finish') return 'solved';
    if (['NotStart', 'InProgress'].includes(daily.userStatus)) return 'pending';
    return 'unknown';
}
