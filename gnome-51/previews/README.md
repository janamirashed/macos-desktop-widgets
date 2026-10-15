# Widget picker preview images

One PNG per variant, named `<type>-<variant>.png` (the ids in
`lib/widgetRegistry.js`). The picker shows it on that variant's card; if a file
is absent it falls back to the widget's app icon.

Dark-mode screenshots of the widget itself, cropped tight, roughly at the
variant's real footprint:

  square ≈ 300×300   row ≈ 600×300   grid ≈ 500×500

Full set:

  clock-digital      clock-analog     clock-classic    clock-dial
  clock-world        clock-worldRow
  weather-conditions weather-forecast weather-week
  calendar-month     calendar-agenda
  gcalendar-month    gcalendar-agenda
  news-story         news-headlines   news-digest
  stocks-single      stocks-row
  reminders-list     reminders-wide


## Coding widgets

- `leetcode-square.png` and `leetcode-row.png`
- `codeforcesContests-row.png`
- `codeforcesRating-square.png`

These transparent PNGs use the real widget layouts at 2× their desktop size.
They contain clearly labeled sample data, including the green activity heatmap;
no account tokens or live user data are needed to render them. The picker uses
the bundled official logos for the three sidebar entries and drag fallbacks.
Logo provenance is recorded in `icons/app/SOURCES.md`.

Rebuild offline on GNOME 46 from the repository root:

```sh
GI_TYPELIB_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14 \
LD_LIBRARY_PATH=/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-14 \
GSETTINGS_BACKEND=memory gjs -m scripts/render-coding-previews.js
```
