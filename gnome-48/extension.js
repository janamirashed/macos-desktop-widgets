// peachOS Desktop Widgets.
//
// A widget layer above the wallpaper / below windows (lib/widgetLayer.js),
// placed widgets persisted as JSON in the `widgets` gsetting, an edit mode
// (lib/editMode.js) toggled by the `edit-mode` gsetting that the Control
// Center's "Manage Widgets" pill flips, and a bottom-left liquid-glass picker
// (lib/widgetPicker.js). Widget content lives in widgets/, shared data
// providers in lib/providers/. See .claude/plans/fluffy-dreaming-canyon.md.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {WidgetLayer} from './lib/widgetLayer.js';
import {EditMode} from './lib/editMode.js';
import {invalidateWallpaper, clearCropCache} from './lib/wallpaperCrop.js';
import {WeatherProvider} from './lib/providers/weather.js';
import {ICloudCalendarSource, GoogleCalendarSource} from './lib/providers/edsCalendar.js';
import {RemindersSource} from './lib/providers/reminders.js';
import {StocksProvider} from './lib/providers/stocks.js';
import {NewsProvider} from './lib/providers/news.js';
import {IcloudPhotosProvider} from './lib/providers/icloudPhotos.js';
import {MailProvider} from './lib/providers/mail.js';
import {GitHubProvider} from './lib/providers/github.js';
import {ScreenTimeProvider} from './lib/providers/screenTime.js';
import {AccountBridge, GoogleBridge} from './lib/providers/accountBridge.js';
import {CodeforcesProvider} from './lib/providers/codeforces.js';
import {AccentColorProvider} from './lib/accentColor.js';

export default class PeachosWidgetsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        // Never boot straight into edit mode (e.g. after a crash mid-edit).
        this._settings.set_boolean('edit-mode', false);

        this._bgSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._ifaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        if (Main.layoutManager._startingUp) {
            Main.layoutManager.connectObject('startup-complete',
                () => this._build(), this);
        } else {
            this._build();
        }
    }

    _build() {
        try {
            this._accentColor = new AccentColorProvider();
            this._weather = new WeatherProvider(this._settings);
            this._calendar = new ICloudCalendarSource();
            this._google = new GoogleBridge(this.path);
            this._gcal = new GoogleCalendarSource(this._google);
            this._reminders = new RemindersSource();
            this._stocks = new StocksProvider();
            this._news = new NewsProvider();
            this._icloudPhotos = new IcloudPhotosProvider();
            this._mail = new MailProvider(this._google);
            this._github = new GitHubProvider();
            this._leetcode = new AccountBridge(this.path, 'leetcode-fetch', this._settings.get_string('leetcode-user'));
            this._codeforces = new CodeforcesProvider(this._settings.get_string('codeforces-handle'));
            this._screenTime = new ScreenTimeProvider();

            const ctx = {
                settings: this._settings,
                accentColor: this._accentColor,
                weather: this._weather,
                calendar: this._calendar,
                gcal: this._gcal,
                reminders: this._reminders,
                stocks: this._stocks,
                news: this._news,
                icloudPhotos: this._icloudPhotos,
                mail: this._mail,
                github: this._github,
                leetcode: this._leetcode,
                codeforces: this._codeforces,
                screenTime: this._screenTime,
                path: this.path,
            };

            this._layer = new WidgetLayer(this._settings, ctx);
            this._editMode = new EditMode(this._layer, this._settings);

            this._settings.connectObject('changed::edit-mode',
                () => this._editMode.sync(), this);

            // A wallpaper / theme change rebuilds the background actors above the
            // widget layer -- re-raise it and refresh every widget's backdrop
            // crop (deferred, so it runs after the shell's own restack).
            const onBgChange = () => {
                if (this._bgRaiseId)
                    return;
                this._bgRaiseId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._bgRaiseId = 0;
                    invalidateWallpaper();
                    this._layer?.raise();
                    this._layer?.refreshBackdrops();
                    return GLib.SOURCE_REMOVE;
                });
            };
            this._bgSettings.connectObject('changed', onBgChange, this);
            this._ifaceSettings.connectObject('changed::color-scheme', onBgChange,
                'changed::gtk-theme', onBgChange, this);

            // Quick Settings toggle for Desktop Widgets (1 column, placed next to Airplane Mode)
            const qs = Main.panel.statusArea.quickSettings;
            if (qs?.menu) {
                this._quickToggle = new QuickSettings.QuickToggle({
                    title: 'Widgets',
                    iconName: 'view-grid-symbolic',
                    toggleMode: true,
                });
                this._quickToggle.connect('clicked', () => {
                    const current = this._settings.get_boolean('edit-mode');
                    this._settings.set_boolean('edit-mode', !current);
                    qs.menu.close();
                });
                this._settings.connectObject('changed::edit-mode', () => {
                    if (this._quickToggle)
                        this._quickToggle.checked = this._settings.get_boolean('edit-mode');
                }, this);
                this._quickToggle.checked = this._settings.get_boolean('edit-mode');

                const rfkillItem = qs._rfkill?.quickSettingsItems?.[0];
                if (rfkillItem && qs.menu._grid) {
                    qs.menu._grid.insert_child_above(this._quickToggle, rfkillItem);
                    qs.menu._completeAddItem(this._quickToggle, 1);
                } else {
                    qs.menu.addItem(this._quickToggle, 1);
                }
            }

            // Hide keyboard layout from top bar per user request
            if (Main.panel.statusArea.keyboard?.container) {
                Main.panel.statusArea.keyboard.container.hide();
                this._hidingKeyboard = false;
                this._keyboardNotifyId = Main.panel.statusArea.keyboard.container.connect(
                    'notify::visible', () => {
                        if (this._hidingKeyboard) return;
                        this._hidingKeyboard = true;
                        Main.panel.statusArea.keyboard.container.hide();
                        this._hidingKeyboard = false;
                    }
                );
            }

            console.log(`[peachos-widgets] enabled (${this._layer.count} widget(s) placed)`);
        } catch (e) {
            logError(e, '[peachos-widgets] _build() failed');
            this.disable();
        }
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings?.disconnectObject(this);
        this._bgSettings?.disconnectObject(this);
        this._ifaceSettings?.disconnectObject(this);

        if (this._bgRaiseId) {
            GLib.source_remove(this._bgRaiseId);
            this._bgRaiseId = 0;
        }

        if (this._quickToggle) {
            this._quickToggle.destroy();
            this._quickToggle = null;
        }

        if (this._keyboardNotifyId && Main.panel.statusArea.keyboard?.container) {
            try {
                Main.panel.statusArea.keyboard.container.disconnect(this._keyboardNotifyId);
            } catch (_) {}
            this._keyboardNotifyId = 0;
            Main.panel.statusArea.keyboard.container.show();
        }

        this._editMode?.destroy();
        this._layer?.destroy();
        this._weather?.destroy();
        this._calendar?.destroy();
        this._gcal?.destroy();
        this._reminders?.destroy();
        this._stocks?.destroy();
        this._news?.destroy();
        this._icloudPhotos?.destroy();
        this._mail?.destroy();
        this._github?.destroy();
        this._leetcode?.destroy();
        this._codeforces?.destroy();
        this._google?.destroy();
        this._screenTime?.destroy();
        this._accentColor?.destroy();
        clearCropCache();

        this._editMode = null;
        this._layer = null;
        this._weather = null;
        this._calendar = null;
        this._gcal = null;
        this._reminders = null;
        this._stocks = null;
        this._news = null;
        this._icloudPhotos = null;
        this._mail = null;
        this._github = null;
        this._leetcode = null;
        this._codeforces = null;
        this._google = null;
        this._screenTime = null;
        this._settings = null;
        this._bgSettings = null;
        this._ifaceSettings = null;
    }
}
