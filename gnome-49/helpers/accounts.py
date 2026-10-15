#!/usr/bin/python3
"""Account I/O runs outside GNOME Shell. Secrets live only in GNOME Keyring.
No packages, desktop entries, timers or extensions are installed by this program.
"""
import argparse
import datetime as dt
import email.utils
import email.policy
from email.parser import BytesParser
import imaplib
import re
import html
import json
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

UTC = dt.timezone.utc
LC_URL = 'https://leetcode.com/graphql/'
LC_QUERY = '''query Widget($username: String!, $year: Int!) {
 userStatus { isSignedIn username }
 streakCounter { streakCount }
 activeDailyCodingChallengeQuestion { date userStatus link question { title titleSlug difficulty } }
 matchedUser(username: $username) { userCalendar(year: $year) { submissionCalendar } }
}'''


class AccountError(Exception):
    pass


def request_json(url, data=None, headers=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json', 'User-Agent': 'DesktopWidgets/0.3', **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
    if len(payload) > 4 * 1024 * 1024:
        raise AccountError('Service response is too large')
    return json.loads(payload)


def secret_api():
    import gi
    gi.require_version('Secret', '1')
    from gi.repository import Secret
    schema = Secret.Schema.new('org.gnome.shell.extensions.peachos-widgets.leetcode',
                               Secret.SchemaFlags.NONE,
                               {'username': Secret.SchemaAttributeType.STRING})
    return Secret, schema


def leetcode_fetch(username, credentials=None):
    if credentials is None:
        Secret, schema = secret_api()
        saved = Secret.password_lookup_sync(schema, {'username': username}, None)
        if not saved:
            raise AccountError('Connect LeetCode')
        credentials = json.loads(saved)
    # Newlines/semicolons may not introduce other headers or cookies.
    for value in credentials.values():
        if not isinstance(value, str) or any(c in value for c in '\r\n;'):
            raise AccountError('Invalid session value')
    now = dt.datetime.now(UTC)
    cookie = f"LEETCODE_SESSION={credentials['session']}; csrftoken={credentials['csrf']}"
    result = request_json(LC_URL, {'query': LC_QUERY, 'variables': {'username': username, 'year': now.year}},
                          {'Cookie': cookie, 'x-csrftoken': credentials['csrf'],
                           'Referer': 'https://leetcode.com/'})
    data = result.get('data') or {}
    status = data.get('userStatus') or {}
    if not status.get('isSignedIn'):
        raise AccountError('Reconnect LeetCode: session expired')
    if str(status.get('username', '')).casefold() != username.casefold():
        raise AccountError('Session belongs to a different LeetCode username')
    if result.get('errors') or not data.get('matchedUser'):
        raise AccountError('LeetCode data is unavailable')
    calendar = json.loads(data['matchedUser']['userCalendar']['submissionCalendar'])
    # Include the previous year for heatmaps crossing January.
    previous = request_json(LC_URL, {
        'query': 'query($username:String!,$year:Int!){matchedUser(username:$username){userCalendar(year:$year){submissionCalendar}}}',
        'variables': {'username': username, 'year': now.year - 1}},
        {'Cookie': cookie, 'x-csrftoken': credentials['csrf'], 'Referer': 'https://leetcode.com/'})
    prior = ((previous.get('data') or {}).get('matchedUser') or {}).get('userCalendar') or {}
    if prior.get('submissionCalendar'):
        calendar = {**json.loads(prior['submissionCalendar']), **calendar}
    return {'username': username, 'connected': True, 'calendar': calendar,
            'streak': (data.get('streakCounter') or {}).get('streakCount'),
            'daily': data.get('activeDailyCodingChallengeQuestion'),
            'fetchedDay': now.date().isoformat(), 'updated': now.timestamp()}


def connect_leetcode(username):
    import gi
    gi.require_version('Gtk', '3.0')
    from gi.repository import Gtk, GLib
    Gtk.init(None)
    window = Gtk.Window(title='Connect LeetCode · Desktop Widgets')
    window.set_default_size(510, 360)
    window.set_border_width(24)
    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
    window.add(box)
    intro = Gtk.Label(label=f'Connect {username}\n\nSign in at leetcode.com in your browser. In Developer Tools →\nApplication/Storage → Cookies, copy LEETCODE_SESSION and csrftoken.\nThey are stored in GNOME Keyring, never in widget settings or files.')
    intro.set_line_wrap(True)
    box.pack_start(intro, False, False, 0)
    fields = []
    for name in ['LEETCODE_SESSION', 'csrftoken']:
        entry = Gtk.Entry(visibility=False, placeholder_text=name)
        box.pack_start(entry, False, False, 0)
        fields.append(entry)
    status = Gtk.Label(label='')
    status.set_line_wrap(True)
    box.pack_start(status, False, False, 0)
    row = Gtk.Box(spacing=12)
    box.pack_start(row, False, False, 0)
    save = Gtk.Button(label='Validate and connect')
    forget = Gtk.Button(label='Disconnect')
    row.pack_start(save, True, True, 0)
    row.pack_start(forget, True, True, 0)

    def finished(message, success=False):
        status.set_text(message)
        save.set_sensitive(True)
        forget.set_sensitive(True)
        if success:
            for entry in fields:
                entry.set_text('')
        return False

    def work(credentials, remove=False):
        try:
            Secret, schema = secret_api()
            if remove:
                Secret.password_clear_sync(schema, {'username': username}, None)
                message = 'Disconnected. Close this window to update the widget.'
            else:
                leetcode_fetch(username, credentials)
                Secret.password_store_sync(schema, {'username': username}, Secret.COLLECTION_DEFAULT,
                                           f'LeetCode · {username}', json.dumps(credentials), None)
                message = 'Connected. Close this window to update the widget.'
            GLib.idle_add(finished, message, True)
        except Exception as error:
            GLib.idle_add(finished, safe_error(error), False)

    def submit(_button, remove=False):
        credentials = {'session': fields[0].get_text().strip(), 'csrf': fields[1].get_text().strip()}
        if not remove and not all(credentials.values()):
            status.set_text('Enter both session values.')
            return
        save.set_sensitive(False)
        forget.set_sensitive(False)
        status.set_text('Working…')
        threading.Thread(target=work, args=(credentials, remove), daemon=True).start()

    save.connect('clicked', submit)
    forget.connect('clicked', lambda button: submit(button, True))
    window.connect('destroy', Gtk.main_quit)
    window.show_all()
    Gtk.main()


def google_accounts():
    # Generic D-Bus avoids a dependency on the optional Goa Python typelib.
    import gi
    from gi.repository import Gio, GLib
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    result = bus.call_sync('org.gnome.OnlineAccounts', '/org/gnome/OnlineAccounts',
                          'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', None,
                          None, Gio.DBusCallFlags.NONE, 15000, None).unpack()[0]
    for path, interfaces in result.items():
        account = interfaces.get('org.gnome.OnlineAccounts.Account', {})
        def value(key, default=None):
            raw = account.get(key, default)
            return raw.unpack() if isinstance(raw, GLib.Variant) else raw
        if value('ProviderType') != 'google' or 'org.gnome.OnlineAccounts.OAuth2Based' not in interfaces:
            continue
        try:
            token = bus.call_sync('org.gnome.OnlineAccounts', path,
                                  'org.gnome.OnlineAccounts.OAuth2Based', 'GetAccessToken', None,
                                  None, Gio.DBusCallFlags.NONE, 20000, None).unpack()[0]
            yield {'token': token, 'identity': value('PresentationIdentity', ''),
                   'mail': not value('MailDisabled', False),
                   'calendar': not value('CalendarDisabled', False)}
        except Exception:
            yield {'reauth': True}


def google_request(path, token):
    return request_json('https://www.googleapis.com/' + path, headers={'Authorization': 'Bearer ' + token})


def event_date(value):
    if 'dateTime' in value:
        return value['dateTime']
    return value['date'] + 'T00:00:00'


def gmail_imap(account):
    """GOA's client may permit mail.google.com but have Gmail REST API disabled.
    IMAP XOAUTH2 uses that existing grant and never marks messages as read.
    """
    identity = account.get('identity', '')
    if not identity or any(c in identity for c in '\r\n\x01'):
        raise AccountError('Reconnect Google in Online Accounts')
    client = imaplib.IMAP4_SSL('imap.gmail.com', 993, timeout=20)
    try:
        auth = f"user={identity}\x01auth=Bearer {account['token']}\x01\x01".encode()
        # After a rejected bearer token the server sends a JSON challenge. End
        # that exchange with an empty response, never resend the credential.
        first = True
        def respond(_challenge):
            nonlocal first
            if first:
                first = False
                return auth
            return b''
        client.authenticate('XOAUTH2', respond)
        status, _ = client.select('INBOX', readonly=True)
        if status != 'OK': raise AccountError('Gmail inbox unavailable')
        status, ids = client.uid('search', None, 'ALL')
        if status != 'OK': raise AccountError('Gmail inbox unavailable')
        messages = []
        for uid in reversed((ids[0] or b'').split()[-3:]):
            status, rows = client.uid('fetch', uid,
                '(FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])')
            if status != 'OK': continue
            for row in rows:
                if not isinstance(row, tuple) or len(row) != 2: continue
                metadata, raw = row
                header = BytesParser(policy=email.policy.default).parsebytes(raw)
                name, addr = email.utils.parseaddr(str(header.get('From', '')))
                try:
                    date = email.utils.parsedate_to_datetime(str(header.get('Date', ''))).timestamp()
                except (ValueError, TypeError, OverflowError):
                    date = 0
                flags = re.search(rb'FLAGS \(([^)]*)\)', metadata)
                seen = bool(flags and b'\\Seen' in flags.group(1).split())
                messages.append({'from': name or addr, 'addr': addr,
                                 'subject': str(header.get('Subject', '')),
                                 'preview': '', 'date': date, 'unread': not seen})
                break
        return messages
    finally:
        try: client.logout()
        except (imaplib.IMAP4.error, OSError): pass


def gmail_messages(account):
    token = account['token']
    try:
        listing = google_request('gmail/v1/users/me/messages?labelIds=INBOX&maxResults=3', token)
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read(100000)).get('error', {})
            reasons = {item.get('reason') for item in details.get('errors', [])}
        except (ValueError, OSError):
            reasons = set()
        if error.code == 403 and 'accessNotConfigured' in reasons:
            return gmail_imap(account)
        raise
    messages = []
    for item in listing.get('messages', []):
        message = google_request('gmail/v1/users/me/messages/' + item['id'] + '?format=metadata', token)
        headers = {h['name'].lower(): h['value'] for h in message.get('payload', {}).get('headers', [])}
        name, addr = email.utils.parseaddr(headers.get('from', ''))
        messages.append({'from': name or addr, 'addr': addr,
                         'subject': headers.get('subject', ''),
                         'preview': html.unescape(message.get('snippet', '')),
                         'date': int(message.get('internalDate', 0)) / 1000,
                         'unread': 'UNREAD' in message.get('labelIds', [])})
    return messages


def google_sync():
    result = {'connected': False, 'mailConnected': False, 'calendarConnected': False,
              'reauth': False, 'messages': [], 'events': [], 'updated': dt.datetime.now(UTC).timestamp()}
    now = dt.datetime.now(UTC)
    for account in google_accounts():
        if account.get('reauth'):
            result['reauth'] = True
            continue
        result['connected'] = True
        token = account['token']
        if account['mail']:
            try:
                result['messages'].extend(gmail_messages(account))
                result['mailConnected'] = True
            except urllib.error.HTTPError as error:
                result['mailError'] = 'Google mail permission required' if error.code in (401, 403) else 'Gmail unavailable'
                if error.code == 401: result['reauth'] = True
            except imaplib.IMAP4.error:
                result['mailError'] = 'Reconnect Google in Online Accounts to allow Gmail'
            except (AccountError, urllib.error.URLError, TimeoutError, OSError):
                result['mailError'] = 'Gmail unavailable; retry when connected'
        if account['calendar']:
            try:
                calendars = google_request('calendar/v3/users/me/calendarList?maxResults=250', token)
                for calendar in calendars.get('items', []):
                    if not calendar.get('selected', True): continue
                    params = urllib.parse.urlencode({'timeMin': (now - dt.timedelta(days=1)).isoformat(),
                                                     'timeMax': (now + dt.timedelta(days=63)).isoformat(),
                                                     'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 250})
                    path = 'calendar/v3/calendars/' + urllib.parse.quote(calendar['id'], safe='') + '/events?'
                    while True:
                        events = google_request(path + params, token)
                        for event in events.get('items', []):
                            if event.get('status') == 'cancelled' or 'start' not in event: continue
                            result['events'].append({'summary': event.get('summary', '(Untitled)'),
                                                     'date': event_date(event['start']), 'end': event_date(event['end']),
                                                     'allDay': 'date' in event['start'], 'color': calendar.get('backgroundColor')})
                        if not events.get('nextPageToken'): break
                        params = urllib.parse.urlencode({**dict(urllib.parse.parse_qsl(params)),
                                                         'pageToken': events['nextPageToken']})
                result['calendarConnected'] = True
            except urllib.error.HTTPError as error:
                result['calendarError'] = 'Google calendar permission required' if error.code in (401, 403) else 'Google Calendar unavailable'
                if error.code == 401: result['reauth'] = True
    if result['mailConnected']: result.pop('mailError', None)
    if result['calendarConnected']: result.pop('calendarError', None)
    result['messages'] = sorted(result['messages'], key=lambda m: m['date'], reverse=True)[:3]
    return result


def safe_error(error):
    if isinstance(error, AccountError): return str(error)
    if isinstance(error, urllib.error.HTTPError): return f'Service returned HTTP {error.code}'
    if isinstance(error, (urllib.error.URLError, TimeoutError)): return 'Network unavailable; try again'
    return 'Account service unavailable; check GNOME Keyring / Online Accounts'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['leetcode-fetch', 'leetcode-connect', 'google-sync', 'check'])
    parser.add_argument('--username', default='')
    args = parser.parse_args()
    if args.command.startswith('leetcode-') and not args.username.strip():
        print(json.dumps({'error': 'Configure a LeetCode username first; see README.md'}))
        return 1
    try:
        if args.command == 'check':
            import gi
            for name, version in [('Gtk', '3.0'), ('Secret', '1')]:
                gi.require_version(name, version)
                __import__('gi.repository.' + name)
            print(json.dumps({'available': True, 'installs': False}))
        elif args.command == 'leetcode-connect':
            connect_leetcode(args.username)
        else:
            data = leetcode_fetch(args.username) if args.command == 'leetcode-fetch' else google_sync()
            print(json.dumps(data))
    except Exception as error:
        print(json.dumps({'error': safe_error(error)}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
