# peachOS Desktop Widgets

macOS-style liquid-glass desktop widgets for peachOS (GNOME Shell 50).

## What it does

- A widget layer above the wallpaper / below every window
  (`lib/widgetLayer.js`), parented into `Main.layoutManager._backgroundGroup`.
- Placed widgets persist as JSON in the `widgets` gsetting.
- **Edit mode** (`lib/editMode.js`), toggled by the `edit-mode` gsetting that
  the Control Center's "Manage Widgets" pill flips: the dock and open windows
  hide, the desktop dims to the wallpaper, and a bottom-left liquid-glass
  **picker** (`lib/widgetPicker.js`) appears -- a left rail of widget types, a
  right grid of variants you drag onto the desktop to place. Drag placed
  widgets to move them (snaps to an 8px grid); a corner ✕ removes them.
- Widgets: **Clock** (digital / analog), **Weather** (Open-Meteo, no API key),
  **Calendar** (month grid + agenda, events via GNOME Shell's own
  `DBusEventSource` / Evolution Data Server).

## Structure

```
extension.js              wiring: settings, providers, layer, edit mode
lib/liquidGlass.js        LiquidGlass St.Widget: wallpaper crop + ported shader + content overlay
lib/wallpaperTexture.js   wallpaper -> Cogl texture crop behind a screen rect
lib/widgetLayer.js        the actor layer, frames, JSON persistence, edit dim
lib/widgetRegistry.js     type/variant catalogue (sizes, icons, factories)
lib/widgetPicker.js       bottom-left glass picker
lib/editMode.js           dock/window hide, dim, picker host, Esc
lib/providers/weather.js  Open-Meteo via libsoup
lib/providers/calendar.js GNOME Shell DBusEventSource wrapper
widgets/frame.js          one placed widget: glass + content + drag + remove
widgets/{clock,weather,calendar}.js   widget content
shaders/liquidglass.glsl  ported refraction shader
```

## Attribution

The liquid-glass shader (`shaders/liquidglass.glsl`) is re-implemented from
[`jaxparrow07/liquidglass-kde-widgets`](https://github.com/jaxparrow07/liquidglass-kde-widgets)
(`1-common/components/shaders/liquidglass.frag`), itself ported from
[`iyinchao/liquid-glass-studio`](https://github.com/iyinchao/liquid-glass-studio).
Ported from Qt RHI GLSL to Clutter/Cogl GLSL for GNOME Shell, and toned down
(no chromatic dispersion, gentle refraction) for peachOS. **GPL-3.0.**

The `Clutter.ShaderEffect` wiring follows `blur-my-shell@aunetx` (also GPL-3);
the desktop-layer parenting follows `azclock` / "Desktop Widgets"
(gitlab.com/AndrewZaech/azclock, GPL-3).

Not affiliated with Apple Inc.
