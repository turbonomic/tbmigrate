#! /bin/bash

if [ "$1" = "-f" ]; then
	force=true # potentially dangerous! You've been warned.
	shift
else
	force=false
fi

export TURBO_FORCE_COLOUR=yes

. ./.env
. bin/functions.sh

ready=$(bin/tbscript @null js/db-stats.js usersReady 2>/dev/null)
if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
	echo "Not ready to run 'migate-users' yet - refer to the documentation for the correct order"
	exit 2
fi

roll_logs migrate-users

cd js || exit 2

if [ -s "$xl2_db" ] && [ ! -s "$xl3_db" ]; then
	cp "$xl2_db" "$xl3_db"
fi

script -q -c "../bin/tbscript \"$xl_cred\" migrate-users.js \"$classic_db\" \"$xl3_db\"" "$logsdir/migrate-users.log"
