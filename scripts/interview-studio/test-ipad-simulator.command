#!/bin/bash
# Opens the completed synthetic QA room in an explicitly selected iPad Simulator.
# Captures UI evidence; it does not assert WebRTC camera/microphone support.
set -euo pipefail

if [ "$(uname -s)" != Darwin ]; then
  echo 'Run this launcher on the Mac with Xcode installed.' >&2
  exit 2
fi
xcrun --find simctl >/dev/null

if [ "${1:-}" = --list ] || [ "$#" -eq 0 ]; then
  xcrun simctl list devices available | /usr/bin/awk '/^-- / || /iPad/'
  echo 'Run again with an explicit iPad Simulator UDID.'
  exit 0
fi
simulator_udid=$1
if ! [[ "$simulator_udid" =~ ^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$ ]]; then
  echo 'Supply an iPad Simulator UDID from --list.' >&2
  exit 2
fi
qa_url=${PRESENT_QA_URL:-}
if [ -z "$qa_url" ]; then
  read -r -s -p 'Paste the completed voice-test invitation URL: ' qa_url
  echo
fi
# Restrict this helper to the synthetic QA room, preserving the human-test room.
case "$qa_url" in
  'https://interview-studio-web-production.up.railway.app/interviews?brief=4a9fe88f-b28b-4912-97bd-1f7dd16bdd61#access='?*) ;;
  *) echo 'Use the completed synthetic voice-test invitation, including its access fragment.' >&2; exit 2 ;;
esac

qa_output=$(mktemp -d "${TMPDIR:-/tmp}/present-ipad-qa.XXXXXX")
chmod 700 "$qa_output"
xcrun simctl list devices available --json > "$qa_output/devices.json"
if ! /usr/bin/grep -q "$simulator_udid" "$qa_output/devices.json"; then
  echo 'That simulator is not available in the selected Xcode installation.' >&2
  exit 2
fi
if ! xcrun simctl boot "$simulator_udid" > "$qa_output/boot.log" 2>&1; then
  # bootstatus succeeds for a simulator that was already booted.
  xcrun simctl bootstatus "$simulator_udid" -b
fi
xcrun simctl bootstatus "$simulator_udid" -b
open -a Simulator --args -CurrentDeviceUDID "$simulator_udid"
if ! xcrun simctl openurl "$simulator_udid" "$qa_url" > "$qa_output/safari-launch.log" 2>&1; then
  echo "Safari launch failed; local diagnostics: $qa_output" >&2
  exit 1
fi
unset qa_url
read -r -p 'When PRESENT is visible in Safari, press Return to record 20 seconds. ' _ready

recording_pid=''
finish_recording() {
  if [ -n "$recording_pid" ]; then
    kill -INT "$recording_pid" 2>/dev/null || true
    wait "$recording_pid" 2>/dev/null || true
    recording_pid=''
  fi
}
trap finish_recording EXIT INT TERM
xcrun simctl io "$simulator_udid" recordVideo --codec=h264 --force "$qa_output/safari-qa.mp4" > "$qa_output/recording.log" 2>&1 &
recording_pid=$!
echo 'Recording: inspect Meet, Brief, Canvas and the Session inspector.'
sleep 20
finish_recording
xcrun simctl io "$simulator_udid" screenshot "$qa_output/safari-qa.png"
xcodebuild -version > "$qa_output/xcode-version.txt"
echo "Capture saved to $qa_output"
echo 'Review the screenshot and recording before claiming Safari QA passed.'
echo 'Actual iPad camera, microphone and playback still require a device test.'
