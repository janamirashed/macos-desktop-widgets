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
