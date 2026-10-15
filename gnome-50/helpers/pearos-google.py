#!/usr/bin/python3
"""Bundled replacement for the absent pearOS Google bridge; no installation needed."""
import argparse
import json
import subprocess
from accounts import google_sync, safe_error

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['sync', 'connect'])
    args = parser.parse_args()
    if args.command == 'connect':
        subprocess.Popen(['gnome-control-center', 'online-accounts'])
    else:
        try:
            print(json.dumps(google_sync()))
        except Exception as error:
            print(json.dumps({'error': safe_error(error)}))
            raise SystemExit(1)
