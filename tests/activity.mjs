import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../gnome-46/lib/activity.js', import.meta.url), 'utf8');
const {recordInterval, localDay, activityStreak, dailyStatus} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const days = {};
const start = new Date(2026, 9, 14, 23, 59, 58);
recordInterval(days, start.getTime(), start.getTime() + 5000, 'editor.desktop');
assert.equal(days['2026-10-14'].total, 2);
assert.equal(days['2026-10-15'].total, 3);
assert.equal(days['2026-10-14'].hourly[23], 2);
assert.equal(days['2026-10-15'].hourlyApps[0]['editor.desktop'], 3);
recordInterval(days, start.getTime(), start.getTime(), 'editor.desktop');
assert.equal(days['2026-10-14'].total, 2);
assert.equal(localDay(new Date(2026, 0, 2)), '2026-01-02');
const now = new Date('2026-01-01T23:59:59Z');
const calendar = Object.fromEntries(['2025-12-30', '2025-12-31'].map(day => [new Date(day+'T00:00:00Z').getTime()/1000, 1]));
assert.equal(activityStreak(calendar, now), 2);
assert.equal(activityStreak({}, now), 0);
const daily = {date:'2026-01-01', userStatus:'Finish'};
assert.equal(dailyStatus(daily, true, '2026-01-01', now), 'solved');
assert.equal(dailyStatus(daily, false, '2026-01-01', now), 'unknown');
assert.equal(dailyStatus(daily, true, '2026-01-01', new Date('2026-01-02T00:00:00Z')), 'unknown');
assert.equal(dailyStatus({...daily,userStatus:'NotStart'},true,'2026-01-01',now),'pending');
assert.equal(dailyStatus({...daily,userStatus:'FutureEnum'},true,'2026-01-01',now),'unknown');
// DST civil day lengths must not assign the next day's usage to this day.
for (const [month, day] of [[2,8], [10,1]]) {
    const a = new Date(2026,month,day,0,0,0);
    const b = new Date(2026,month,day+1,0,0,0);
    const tracked = {};
    recordInterval(tracked,a.getTime(),b.getTime());
    assert.equal(Object.keys(tracked).length,1);
    assert.equal(tracked[localDay(a)].total,(b-a)/1000);
}
console.log('Activity accounting, UTC rollover, stale completion and DST tests passed.');
