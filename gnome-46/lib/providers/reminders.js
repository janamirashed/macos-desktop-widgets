// Reminders provider -- stores and manages reminders locally in peachos-reminders.json
// so that only tasks voluntarily added from the reminder widget interface are shown,
// without polluting the widget with old/external tasks from Google Calendar or EDS.

import GLib from 'gi://GLib';

function remindersFilePath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(), 'gnome-shell', 'peachos-reminders.json',
    ]);
}

export class RemindersSource {
    constructor() {
        this._listeners = new Set();
        this._emitId = 0;
        this._emitting = false;
        this._tasks = [];
        this._load();
    }

    _load() {
        const path = remindersFilePath();
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            this._tasks = [];
            return;
        }
        try {
            const [, bytes] = GLib.file_get_contents(path);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            if (Array.isArray(data)) {
                this._tasks = data.map(item => ({
                    uid: item.uid || `peachos-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    summary: item.summary || '',
                    due: item.due ? new Date(item.due) : null,
                    dueAllDay: !!item.dueAllDay,
                    priority: item.priority || 0,
                    completed: !!item.completed,
                    createdAt: item.createdAt || Date.now(),
                }));
            }
        } catch (e) {
            logError(e, '[peachos-widgets] Failed to load reminders from JSON');
            this._tasks = [];
        }
    }

    _save() {
        try {
            const path = remindersFilePath();
            const data = this._tasks.map(t => ({
                uid: t.uid,
                summary: t.summary,
                due: t.due ? t.due.toISOString() : null,
                dueAllDay: t.dueAllDay,
                priority: t.priority,
                completed: t.completed,
                createdAt: t.createdAt,
            }));
            const json = JSON.stringify(data, null, 2);
            GLib.file_set_contents(path, new TextEncoder().encode(json));
        } catch (e) {
            logError(e, '[peachos-widgets] Failed to save reminders to JSON');
        }
    }

    subscribe(fn) {
        this._listeners.add(fn);
        fn();
        return () => this._listeners.delete(fn);
    }

    refreshNow() {
        this._load();
        this._scheduleEmit();
    }

    /** Create a new reminder live from the widget */
    createReminder(summary, due = null) {
        if (!summary || !summary.trim())
            return;
        const text = summary.trim();
        const uid = `peachos-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        const newTask = {
            uid,
            summary: text,
            due: due || null,
            dueAllDay: false,
            priority: 0,
            completed: false,
            createdAt: Date.now(),
        };
        this._tasks.unshift(newTask);
        this._save();
        this._scheduleEmit();
    }

    /** Complete / tick a reminder */
    completeReminder(task) {
        if (!task)
            return;
        task.completed = true;
        this._save();
        this._scheduleEmit();
    }

    /** Untick / uncomplete a reminder */
    uncompleteReminder(task) {
        if (!task)
            return;
        task.completed = false;
        this._save();
        this._scheduleEmit();
    }

    /** Complete / tick ALL active reminders live */
    completeAll() {
        for (const t of this._tasks)
            t.completed = true;
        this._save();
        this._scheduleEmit();
    }

    /** Delete / remove a reminder voluntarily */
    deleteReminder(task) {
        if (!task)
            return;
        this._tasks = this._tasks.filter(t => t !== task && t.uid !== task.uid);
        this._save();
        this._scheduleEmit();
    }

    /** All reminders: incomplete first (soonest-due first, undated last), then completed. */
    getReminders() {
        const incomplete = this._tasks
            .filter(t => !t.completed)
            .sort((a, b) => {
                if (!!a.due !== !!b.due)
                    return a.due ? -1 : 1;
                if (a.due && b.due && +a.due !== +b.due)
                    return a.due - b.due;
                return (b.createdAt || 0) - (a.createdAt || 0);
            });
        const completed = this._tasks
            .filter(t => t.completed)
            .sort((a, b) => {
                if (!!a.due !== !!b.due)
                    return a.due ? -1 : 1;
                if (a.due && b.due && +a.due !== +b.due)
                    return a.due - b.due;
                return (b.createdAt || 0) - (a.createdAt || 0);
            });
        return [...incomplete, ...completed];
    }

    _scheduleEmit() {
        if (this._emitId)
            return;
        this._emitId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._emitId = 0;
            if (this._emitting)
                return GLib.SOURCE_REMOVE;
            this._emitting = true;
            try {
                for (const fn of this._listeners)
                    fn();
            } finally {
                this._emitting = false;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._listeners.clear();
        if (this._emitId) {
            GLib.source_remove(this._emitId);
            this._emitId = 0;
        }
        this._tasks = [];
    }
}

export function formatDue(date, allDay) {
    if (!date)
        return '';
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((t0 - d0) / 86400000);
    const time = allDay ? '' : ` ${date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})}`;
    if (days === 0)
        return `Today${time}`;
    if (days === 1)
        return `Tomorrow${time}`;
    if (days === -1)
        return `Yesterday${time}`;
    if (days < 0)
        return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
    if (days < 7)
        return date.toLocaleDateString(undefined, {weekday: 'short'}) + time;
    return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
