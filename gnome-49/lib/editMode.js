// Enter/exit desktop edit mode: hide the dock and open windows, dim to the
// wallpaper (widgetLayer owns the scrim), and show the picker. Driven by the
// `edit-mode` gsetting, which the Control Center "Manage Widgets" pill flips.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {WidgetPicker} from './widgetPicker.js';

// The peachOS dock is a dash2dock-lite fork; it names its container actor
// 'dashtodockContainer' (same constant macos-top-panel/lib/appLauncher.js uses).
const DOCK_ACTOR_NAME = 'dashtodockContainer';
const ANIM = 280;

function findActorByName(actor, name) {
    if (actor.name === name)
        return actor;
    for (const child of actor.get_children()) {
        const found = findActorByName(child, name);
        if (found)
            return found;
    }
    return null;
}

export class EditMode {
    constructor(widgetLayer, settings) {
        this._widgetLayer = widgetLayer;
        this._settings = settings;
        this._active = false;
        this._hiddenWindows = [];
        this._capturedId = 0;
    }

    get active() {
        return this._active;
    }

    toggle() {
        this._settings.set_boolean('edit-mode', !this._active);
    }

    sync() {
        if (this._settings.get_boolean('edit-mode'))
            this.enter();
        else
            this.exit();
    }

    enter() {
        if (this._active)
            return;
        this._active = true;

        this._widgetLayer.setEditing(true);
        this._widgetLayer.raise();
        this._setDockHidden(true);
        this._setWindowsHidden(true);

        // opening edit mode is a good moment to pull fresh account data
        const ctx = this._widgetLayer.ctx;
        for (const p of [ctx?.calendar, ctx?.gcal, ctx?.reminders])
            p?.refreshNow?.();

        this._picker = new WidgetPicker(this._widgetLayer, {
            onDone: () => this.toggle(),
        });
        this._widgetLayer.layer.add_child(this._picker);

        // hide the panel out of the way while a widget is being dragged
        this._widgetLayer.setDragListener(active => {
            if (active)
                this._picker?.slideOut();
            else
                this._picker?.slideIn();
        });

        this._capturedId = global.stage.connect('captured-event', (_s, ev) => {
            if (ev.type() === Clutter.EventType.KEY_PRESS &&
                ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    exit() {
        if (!this._active)
            return;
        this._active = false;

        if (this._capturedId) {
            global.stage.disconnect(this._capturedId);
            this._capturedId = 0;
        }
        this._widgetLayer.setDragListener(null);
        this._picker?.destroy();
        this._picker = null;

        this._widgetLayer.setEditing(false);
        this._setWindowsHidden(false);
        this._setDockHidden(false);
    }

    _setWindowsHidden(hidden) {
        if (hidden) {
            this._hiddenWindows = [];
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!win || win.is_override_redirect())
                    continue;
                if (!actor.visible || actor.opacity === 0)
                    continue;
                this._hiddenWindows.push(actor);
                actor.remove_all_transitions();
                actor.ease({
                    opacity: 0, duration: ANIM,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        if (this._active)
                            actor.hide();
                    },
                });
            }
        } else {
            for (const actor of this._hiddenWindows) {
                actor.remove_all_transitions();
                actor.show();
                actor.ease({
                    opacity: 255, duration: ANIM,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
            this._hiddenWindows = [];
        }
    }

    _setDockHidden(hidden) {
        const dock = findActorByName(Main.layoutManager.uiGroup, DOCK_ACTOR_NAME);
        if (!dock)
            return;
        dock.remove_all_transitions();
        if (hidden) {
            dock.ease({
                opacity: 0, duration: ANIM,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => {
                    if (this._active)
                        dock.visible = false;
                },
            });
        } else {
            dock.visible = true;
            dock.ease({
                opacity: 255, duration: ANIM,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    destroy() {
        this.exit();
        this._widgetLayer = null;
    }
}
