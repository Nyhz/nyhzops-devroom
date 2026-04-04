#!/bin/bash
# devroom-xbar-run.sh — headless wrapper for xbar menu actions
# Runs devroom-ctl.sh commands via osascript so launchctl has
# a proper login session context, without opening a Terminal window.

CMD="$1"
CTL="$HOME/devroom/nyhzops-devroom/scripts/devroom-ctl.sh"

osascript -e "do shell script \"'${CTL}' ${CMD}\"" &>/dev/null &
