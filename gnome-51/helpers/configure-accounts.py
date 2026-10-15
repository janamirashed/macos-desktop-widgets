#!/usr/bin/python3
"""Explicitly set this extension's public account names; never accepts secrets."""
import argparse
from pathlib import Path
from gi.repository import Gio
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--leetcode')
parser.add_argument('--codeforces')
args = parser.parse_args()
if args.leetcode is None and args.codeforces is None:
    parser.error('Supply --leetcode and/or --codeforces; an empty string clears a name')
root = Path(__file__).resolve().parents[1]
source = Gio.SettingsSchemaSource.new_from_directory(str(root / 'schemas'), Gio.SettingsSchemaSource.get_default(), False)
schema = source.lookup('org.gnome.shell.extensions.peachos-widgets', False)
settings = Gio.Settings.new_full(schema, None, None)
for value, key in [(args.leetcode, 'leetcode-user'), (args.codeforces, 'codeforces-handle')]:
    if value is not None:
        value = value.strip()
        if any(c in value for c in '\r\n\x00') or len(value) > 100:
            parser.error('Invalid username')
        settings.set_string(key, value)
Gio.Settings.sync()
print('Account settings saved. Reload the extension/session to use them.')
