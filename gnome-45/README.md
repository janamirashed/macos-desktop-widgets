# macOS Desktop Widgets — GNOME 45

This is a standalone build for GNOME Shell **45 only**, based on the working GNOME 46 edition. It includes the original widget set plus LeetCode and separate Codeforces contest/rating widgets, official logos and picker previews.

## Compatibility

- Uses the `vertical` St layout property appropriate for GNOME 45.
- Handles missing native accent settings and optional settings schemas.
- Screen Time records local activity without requiring GNOME Wellbeing history.
- Google uses the bundled Python bridge and read-only Gmail IMAP OAuth fallback.
- Metadata permits only GNOME 45; `install.sh` refuses other major versions.
- GNOME 46 is the user-tested baseline. Other builds are source/API checked and regression tested, **not runtime certified on their target desktops**. See the adjacent top-level VALIDATION.json and README.md.

## Accounts

**No personal LeetCode username or Codeforces handle is configured.** Upcoming Codeforces contests work without a handle; personal rating and LeetCode require setup. Never put session cookies in shell commands or contribution files.

After installing this build, configure your own usernames explicitly:

```sh
python3 helpers/configure-accounts.py --leetcode YOUR_LEETCODE_USERNAME --codeforces YOUR_CODEFORCES_HANDLE
```

The command writes only these two extension settings. Reload the extension/session after changing them. Select the LeetCode widget's username to import your session locally; it is validated against the configured username and stored in GNOME Keyring. Google setup uses GNOME Online Accounts. Existing user settings are preserved: blank defaults do not erase a user's previously saved account names.

## Dependencies

GNOME Shell 45, GJS, Soup 3, GdkPixbuf, Pango/Rsvg, and glib-compile-schemas. Account helpers require `/usr/bin/python3` and PyGObject. LeetCode connection needs GTK 3 and libsecret/GNOME Keyring; Google needs GNOME Online Accounts and suitable account grants. iCloud Mail, Outlook and remote Photos retain their original external-helper requirements. No dependencies are automatically downloaded.

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
