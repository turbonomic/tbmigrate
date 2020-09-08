#! /bin/bash

export TURBO_FORCE_COLOUR=yes

. ./.env
. bin/functions.sh

ready=$(bin/tbscript @null js/db-stats.js policiesReady 2>/dev/null)
if [ "$ready" != "true" ]; then
	echo "Not ready to run 'migate-policies.sh' yet - refer to the documentation for the correct order"
	exit 2
fi

roll_logs migrate-policies

cd js || exit 2

if [ -s "$xl2_db" ] && [ ! -s "$xl3_db" ]; then
	cp "$xl2_db" "$xl3_db"
fi

script -q -c "../bin/tbscript \"$xl_cred\" migrate-policies.js \"$classic_db\" \"$xl3_db\"" -t"$logsdir/migrate-policies.tm" "$logsdir/migrate-policies.log"