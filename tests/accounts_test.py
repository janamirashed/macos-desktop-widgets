import sys
sys.dont_write_bytecode = True
import importlib.util
import io
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('accounts', pathlib.Path(__file__).resolve().parents[1] / 'gnome-46/helpers/accounts.py')
accounts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(accounts)


class LeetCodeTests(unittest.TestCase):
    def response(self, username='example-user', signed_in=True):
        now = accounts.dt.datetime.now(accounts.UTC)
        return {'data': {'userStatus': {'isSignedIn': signed_in, 'username': username},
                         'streakCounter': {'streakCount': 14},
                         'activeDailyCodingChallengeQuestion': {'date': now.date().isoformat(), 'userStatus': 'Finish'},
                         'matchedUser': {'userCalendar': {'submissionCalendar': '{"1":2}'}}}}

    def test_verified_session_and_calendar(self):
        with patch.object(accounts, 'request_json', return_value=self.response()) as request:
            data = accounts.leetcode_fetch('example-user', {'session': 'private-session', 'csrf': 'private-csrf'})
        self.assertTrue(data['connected'])
        self.assertEqual(data['streak'], 14)
        self.assertEqual(data['daily']['userStatus'], 'Finish')
        self.assertNotIn('private-session', str(data))
        self.assertEqual(request.call_count, 2)

    def test_wrong_account_is_rejected(self):
        with patch.object(accounts, 'request_json', return_value=self.response('other')):
            with self.assertRaisesRegex(accounts.AccountError, 'different'):
                accounts.leetcode_fetch('example-user', {'session': 'x', 'csrf': 'y'})

    def test_expired_session_is_rejected(self):
        with patch.object(accounts, 'request_json', return_value=self.response(signed_in=False)):
            with self.assertRaisesRegex(accounts.AccountError, 'expired'):
                accounts.leetcode_fetch('example-user', {'session': 'x', 'csrf': 'y'})

    def test_header_injection_is_rejected(self):
        with self.assertRaisesRegex(accounts.AccountError, 'Invalid'):
            accounts.leetcode_fetch('example-user', {'session': 'x\r\nCookie: bad', 'csrf': 'y'})

    def test_no_google_account_does_not_claim_connected(self):
        with patch.object(accounts, 'google_accounts', return_value=iter([])):
            data = accounts.google_sync()
        self.assertFalse(data['connected'])
        self.assertFalse(data['mailConnected'])
        self.assertFalse(data['calendarConnected'])

    def test_google_service_permissions_are_independent(self):
        def request(path, token):
            if path.startswith('gmail/'):
                raise accounts.urllib.error.HTTPError('https://example.invalid', 403, 'forbidden', {}, None)
            return {'items': []}
        with patch.object(accounts, 'google_accounts', return_value=iter([{'token':'secret','mail':True,'calendar':True}])), patch.object(accounts, 'google_request', side_effect=request):
            data = accounts.google_sync()
        self.assertFalse(data['mailConnected'])
        self.assertTrue(data['calendarConnected'])
        self.assertNotIn('secret', str(data))


class GmailTests(unittest.TestCase):
    def http_error(self, reason):
        body=accounts.json.dumps({'error': {'errors': [{'reason': reason}]}}).encode()
        return accounts.urllib.error.HTTPError('https://example.invalid',403,'Forbidden',{},io.BytesIO(body))

    def test_disabled_rest_api_uses_existing_imap_grant(self):
        account={'identity':'fixture@example.invalid','token':'private-token'}
        with patch.object(accounts,'google_request',side_effect=self.http_error('accessNotConfigured')), patch.object(accounts,'gmail_imap',return_value=[{'subject':'fixture'}]) as fallback:
            self.assertEqual(accounts.gmail_messages(account),[{'subject':'fixture'}])
            fallback.assert_called_once_with(account)

    def test_missing_scope_is_not_hidden_by_fallback(self):
        with patch.object(accounts,'google_request',side_effect=self.http_error('insufficientPermissions')), patch.object(accounts,'gmail_imap') as fallback:
            with self.assertRaises(accounts.urllib.error.HTTPError):
                accounts.gmail_messages({'token':'private-token'})
            fallback.assert_not_called()

    def test_imap_never_marks_mail_read_and_decodes_headers(self):
        from unittest.mock import MagicMock
        client=MagicMock()
        client.select.return_value=('OK',[b'2'])
        header=b'From: Fixture <fixture@example.invalid>\r\nSubject: =?utf-8?q?Hello_=E2=9C=93?=\r\nDate: Wed, 14 Oct 2026 10:00:00 +0000\r\n\r\n'
        client.uid.side_effect=[('OK',[b'10 11']),('OK',[(b'2 (FLAGS (\\Seen) UID 11)',header),b')']),('OK',[(b'1 (FLAGS () UID 10)',header),b')'])]
        with patch.object(accounts.imaplib,'IMAP4_SSL',return_value=client):
            messages=accounts.gmail_imap({'identity':'fixture@example.invalid','token':'private-token'})
        client.select.assert_called_once_with('INBOX',readonly=True)
        self.assertEqual(len(messages),2)
        self.assertEqual(messages[0]['subject'],'Hello ✓')
        self.assertFalse(messages[0]['unread'])
        self.assertTrue(messages[1]['unread'])
        self.assertTrue(all('BODY.PEEK' in call.args[2] for call in client.uid.call_args_list if call.args[0]=='fetch'))
        response=client.authenticate.call_args.args[1]
        self.assertIn(b'Bearer private-token',response(b''))
        self.assertEqual(response(b'error challenge'),b'')
        client.logout.assert_called_once()

    def test_one_account_failure_does_not_hide_another_inbox(self):
        accounts_fixture=[{'token':'first','mail':True,'calendar':False},{'token':'second','mail':True,'calendar':False}]
        with patch.object(accounts,'google_accounts',return_value=iter(accounts_fixture)), patch.object(accounts,'gmail_messages',side_effect=[[{'date':1}],self.http_error('insufficientPermissions')]):
            result=accounts.google_sync()
        self.assertTrue(result['mailConnected'])
        self.assertNotIn('mailError',result)
        self.assertEqual(len(result['messages']),1)


if __name__ == '__main__':
    unittest.main()
