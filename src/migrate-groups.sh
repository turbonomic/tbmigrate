#! /bin/bash

export TURBO_FORCE_COLOUR=yes

. ./.env
. bin/functions.sh

phase="$1"

if [ "$phase" != 1 ] && [ "$phase" != 2 ]; then
	echo
	echo "Usage is:"
	echo
	echo "  sh migrate-groups.sh {phase}"
	echo
	echo "Where {phase} is 1 or 2"
	echo
	exit 2
fi


phase1() {
	ready=$(bin/tbscript @null js/db-stats.js groups1Ready 2>/dev/null)
	if [ "$ready" != "true" ]; then
		echo "Not ready to run 'migate-groups.sh 1' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-groups-1

	cd js || exit 2
	exec script -q -c "../bin/tbscript \"$xl_cred\" migrate-groups.js \"$classic_db\" \"$xl2_db\"" -t"$logsdir"/migrate-groups-1.tm "$logsdir"/migrate-groups-1.log
}

phase2() {
	ready=$(bin/tbscript @null js/db-stats.js groups2Ready 2>/dev/null)
	if [ "$ready" != "true" ]; then
		echo "Not ready to run 'migate-groups.sh 2' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-groups-2

	cd js || exit 2

	if [ -s "$xl2_db" ] && [ ! -s "$xl3_db" ]; then
		cp "$xl2_db" "$xl3_db"
	fi

	exec script -q -c "../bin/tbscript \"$xl_cred\" migrate-groups.js \"$classic_db\" \"$xl3_db\"" -t"$logsdir"/migrate-groups-2.tm "$logsdir"/migrate-groups-2.log
}

export TURBO_FORCE_COLOUR=yes

if [ ! -r "$datadir"/tbutil-credentials.json ]; then
	echo ""
	echo "File not found: $datadir/tbutil-credentials.json"
	echo "It looks as if you havent run 'sh setup.sh' yet."
	echo ""
	exit 2
fi

if [ "$phase" = 1 ]; then
	phase1
elif [ "$phase" = 2 ]; then
	phase2
fi