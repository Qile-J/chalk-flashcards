#!/bin/bash
cd "$(dirname "$0")"
osascript -e 'tell application "Safari" to make new document with properties {URL:"http://localhost:8000"}' &
python3 server.py
