#!/usr/bin/env python3
"""Create version-specific distributions inside new/, never install or enable.
Run from any directory: python3 new/build.py
Existing output paths are refused, so builds never silently overwrite edits.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
VERSIONS = range(45, 52)
DIRS = ('lib', 'widgets', 'helpers', 'icons', 'fonts', 'previews', 'schemas')
FILES = ('extension.js', 'stylesheet.css', 'metadata.json', 'install.sh', 'uninstall.sh', 'Makefile')


def write(path, text):
    path.write_text(text, encoding='utf-8')


def edit(root, name, callback):
    path = root / name
    write(path, callback(path.read_text(encoding='utf-8')))


def clean_names(root):
    schema = root / 'schemas/org.gnome.shell.extensions.peachos-widgets.gschema.xml'
    tree = ET.parse(schema)
    for key in tree.findall('.//key'):
        if key.attrib['name'] in ('leetcode-user', 'codeforces-handle'):
            key.find('default').text = "''"
    ET.indent(tree, space='  ')
    tree.write(schema, encoding='utf-8', xml_declaration=True)
    edit(root, 'helpers/accounts.py', lambda s: re.sub(
        r"parser\.add_argument\('--username', default='[^']*'\)",
        "parser.add_argument('--username', default='')", s).replace(
        "    args = parser.parse_args()\n    try:",
        "    args = parser.parse_args()\n    if args.command.startswith('leetcode-') and not args.username.strip():\n"
        "        print(json.dumps({'error': 'Configure a LeetCode username first; see README.md'}))\n"
        "        return 1\n    try:"))
    edit(root, 'lib/providers/codeforces.js', lambda s: re.sub(
        r"constructor\(handle = '[^']*'\)", "constructor(handle = '')", s).replace(
        "        const next = () => {", "        if (!this.handle.trim()) queue.splice(1);\n        const next = () => {"))
    edit(root, 'widgets/codeforces.js', lambda s: s.replace(
        "'CODEFORCES · CONTESTS' : handle", "'CODEFORCES · CONTESTS' : (handle || 'Codeforces')").replace(
        "            const user = data.user;",
        "            if (!handle.trim()) { this._label('Set your handle', 16, 64); return; }\n            const user = data.user;"))
    edit(root, 'widgets/leetcode.js', lambda s: s.replace(
        'this._provider.username, m, 14', "(this._provider.username || 'LeetCode'), m, 14").replace(
        'this._provider.error || \'Loading LeetCode…\'', "this._provider.error || 'Configure LeetCode'"))
    edit(root, 'lib/providers/accountBridge.js', lambda s: s.replace(
        "        const argv = ['/usr/bin/python3'",
        "        if (this.command === 'leetcode-fetch' && !this.username?.trim()) {\n"
        "            this.error = 'Configure LeetCode username';\n            this._emit();\n            return;\n        }\n"
        "        const argv = ['/usr/bin/python3'"))


def install_guard(root, version):
    # This script is packaged for the recipient. The builder does not execute it.
    guard = f'''\n# This distribution intentionally targets GNOME {version} only.
if ! command -v gnome-shell >/dev/null 2>&1; then
    echo "GNOME Shell was not found; no files installed." >&2
    exit 1
fi
WIDGET_GNOME_VERSION="$(gnome-shell --version)"
WIDGET_GNOME_MAJOR="$(printf '%s' "$WIDGET_GNOME_VERSION" | sed -n 's/.* \\([0-9][0-9]*\\)\\..*/\\1/p')"
if [ "$WIDGET_GNOME_MAJOR" != "{version}" ]; then
    echo "This package requires GNOME {version}; found $WIDGET_GNOME_VERSION. No files installed." >&2
    exit 1
fi
'''
    edit(root, 'install.sh', lambda s: s.replace('set -e\n', 'set -e\n' + guard, 1))


def readme(version):
    api = 'vertical' if version <= 47 else 'orientation'
    return f'''# macOS Desktop Widgets — GNOME {version}

This is a standalone build for GNOME Shell **{version} only**, based on the working GNOME 46 edition. It includes the original widget set plus LeetCode and separate Codeforces contest/rating widgets, official logos and picker previews.

## Compatibility

- Uses the `{api}` St layout property appropriate for GNOME {version}.
- Handles missing native accent settings and optional settings schemas.
- Screen Time records local activity without requiring GNOME Wellbeing history.
- Google uses the bundled Python bridge and read-only Gmail IMAP OAuth fallback.
- Metadata permits only GNOME {version}; `install.sh` refuses other major versions.
- GNOME 46 is the user-tested baseline. Other builds are source/API checked and regression tested, **not runtime certified on their target desktops**. See the adjacent top-level VALIDATION.json and README.md.

## Accounts

**No personal LeetCode username or Codeforces handle is configured.** Upcoming Codeforces contests work without a handle; personal rating and LeetCode require setup. Never put session cookies in shell commands or contribution files.

After installing this build, configure your own usernames explicitly:

```sh
python3 helpers/configure-accounts.py --leetcode YOUR_LEETCODE_USERNAME --codeforces YOUR_CODEFORCES_HANDLE
```

The command writes only these two extension settings. Reload the extension/session after changing them. Select the LeetCode widget's username to import your session locally; it is validated against the configured username and stored in GNOME Keyring. Google setup uses GNOME Online Accounts. Existing user settings are preserved: blank defaults do not erase a user's previously saved account names.

## Dependencies

GNOME Shell {version}, GJS, Soup 3, GdkPixbuf, Pango/Rsvg, and glib-compile-schemas. Account helpers require `/usr/bin/python3` and PyGObject. LeetCode connection needs GTK 3 and libsecret/GNOME Keyring; Google needs GNOME Online Accounts and suitable account grants. iCloud Mail, Outlook and remote Photos retain their original external-helper requirements. No dependencies are automatically downloaded.

## Installation is a separate explicit action

Nothing is installed by building or inspecting this folder. Review the files before running:

```sh
./install.sh
```

The installer copies files and fonts to the user's local data directories and enables this extension. It does not restart GNOME. All versions use the upstream UUID `peachos-widgets@peachos`, so only one variant can be installed for a user at a time. Log out and back in to load changed code; X11 restart shortcuts only apply where X11 is supported.

## Usage

Open Quick Settings → Widgets. Choose a preview and drag it to the desktop. Weather unit controls appear under Weather in the picker. LeetCode has GitHub-style green activity plus connected daily completion/streak. Codeforces contests and rating are separate entries.

## License and attribution

The original project identifies its license as GPL-3.0. Preserve the original attribution/copyright notices when contributing or redistributing. Service logo provenance is recorded in icons/app/SOURCES.md. Preview figures are sample data, not live user statistics.
'''


CONFIGURE = '''#!/usr/bin/python3
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
        if any(c in value for c in '\\r\\n\\x00') or len(value) > 100:
            parser.error('Invalid username')
        settings.set_string(key, value)
Gio.Settings.sync()
print('Account settings saved. Reload the extension/session to use them.')
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--versions', nargs='+', type=int, choices=list(VERSIONS), default=list(VERSIONS))
    args = parser.parse_args()
    for version in args.versions:
        if (HERE / f'gnome-{version}').exists():
            parser.error(f'gnome-{version} already exists; move it aside before rebuilding')
    manifest = {}
    for directory in DIRS:
        for path in (SOURCE / directory).rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc' and path.name != 'gschemas.compiled':
                manifest[str(path.relative_to(SOURCE))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name in FILES:
        manifest[name] = hashlib.sha256((SOURCE / name).read_bytes()).hexdigest()
    write(HERE / 'SOURCE-MANIFEST.json', json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    archives = HERE / 'archives'
    archives.mkdir(exist_ok=True)
    for version in args.versions:
        root = HERE / f'gnome-{version}'
        root.mkdir()
        for directory in DIRS:
            shutil.copytree(SOURCE / directory, root / directory,
                ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'gschemas.compiled'))
        for name in FILES:
            shutil.copy2(SOURCE / name, root / name)
        clean_names(root)
        if version >= 48:
            for base in [root / 'lib', root / 'widgets']:
                for path in base.rglob('*.js'):
                    text = path.read_text()
                    updated = re.sub(r'\bvertical:\s*true\b', 'orientation: Clutter.Orientation.VERTICAL', text)
                    if text != updated:
                        if "import Clutter from 'gi://Clutter';" not in updated:
                            updated = "import Clutter from 'gi://Clutter';\n" + updated
                        write(path, updated)
        metadata = json.loads((root / 'metadata.json').read_text())
        metadata['shell-version'] = [str(version)]
        metadata['version-name'] = f'0.3.0-gnome{version}'
        write(root / 'metadata.json', json.dumps(metadata, indent=2) + '\n')
        write(root / 'README.md', readme(version))
        write(root / 'helpers/configure-accounts.py', CONFIGURE)
        install_guard(root, version)
        subprocess.run(['glib-compile-schemas', '--strict', str(root / 'schemas')], check=True)
        with zipfile.ZipFile(archives / f'peachos-widgets-gnome-{version}.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(root.rglob('*')):
                if path.is_file(): archive.write(path, path.relative_to(root))
        print(f'Built gnome-{version} and archive (not installed)')
    for name, digest in manifest.items():
        assert hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() == digest, f'Source changed unexpectedly: {name}'


if __name__ == '__main__':
    main()
