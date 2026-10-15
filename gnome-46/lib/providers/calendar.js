// Shared calendar-event helper. The actual event sources live in
// lib/providers/edsCalendar.js (ICloudCalendarSource / GoogleCalendarSource).
//
// CRITICAL note kept here for whoever touches the sources: DBusEventSource's
// requestRange() must be called ONLY from a dedicated _refreshRange(), never
// from getEvents(). A requestRange whose window differs from the last one
// makes DBusEventSource reload and re-emit 'changed'; inside the
// 'changed' -> subscribers -> render -> getEvents chain that recurses forever
// and takes the shell down. getEvents() is a pure read of the cache.

import GLib from 'gi://GLib';

export function formatEventTime(ev) {
    if (ev.allDay)
        return 'All day';
    const t = GLib.DateTime.new_from_unix_local(Math.floor(ev.date.getTime() / 1000));
    return t.format('%-I:%M %p');
}
