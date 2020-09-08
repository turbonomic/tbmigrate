#! /bin/bash

. ./.env
. bin/functions.sh

phase="$1"

if [ "$phase" != 1 ] && [ "$phase" != 2 ]; then
	echo
	echo "Usage is:"
	echo
	echo "  sh migrate-targets.sh {phase}"
	echo
	echo "Where {phase} is 1 or 2"
	echo
	exit 2
fi


phase1() {
	ready=$(bin/tbscript @null js/db-stats.js targets1Ready 2>/dev/null)
	if [ "$ready" != "true" ]; then
		echo "Not ready to run 'migrate-targets.sh 1' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-targets-1

	cd js || exit 2

	rm -f "$xl2_db" "$xl3_db"

	script -q -ec "../bin/tbscript \"$xl_cred\" migrate-targets.js \"$classic_db\" \"$xl1_db\"" -t"$logsdir/migrate-targets-1.tm" "$logsdir/migrate-targets-1.log"
	return $?
}


phase2() {
	ready=$(bin/tbscript @null js/db-stats.js targets2Ready 2>/dev/null)
	if [ "$ready" != "true" ]; then
		echo "Not ready to run 'migrate-targets.sh 2' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-targets-2

	cd js || exit 2

	rm -f "$xl3_db"

	script -q -ec "../bin/tbscript \"$xl_cred\" migrate-targets.js -include-scoped-targets \"$classic_db\" \"$xl2_db\"" -t"$logsdir/migrate-targets-2.tm" "$logsdir/migrate-targets-2.log"
	return $?
}


if [ ! -r "$datadir"/tbutil-credentials.json ]; then
	echo ""
	echo "File not found: $datadir/tbutil-credentials.json"
	echo "It looks as if you havent run 'sh setup.sh' yet."
	echo ""
	exit 2
fi

if [ "$phase" = 1 ]; then
	phase1
	exit $?
elif [ "$phase" = 2 ]; then
	phase2
	exit $?
fi
