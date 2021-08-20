#! /bin/bash

. ./.env
. bin/functions.sh

main() {
	ready=$(bin/tbscript @null js/db-stats.js matchTargetsReady 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'match-targets' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs match-targets

	cd js || exit 2

	rm -f "$xl2_db" "$xl3_db"

	script -q -ec "../bin/tbscript \"$xl_cred\" match-targets.js \"$classic_db\" \"$xl1_db\"" "$logsdir/match-targets.log"
	stat=$?
	../bin/cleanlog "$logsdir/match-targets.log"

	return $stat
}

if [ ! -r "$datadir"/tbutil-credentials.json ]; then
	echo ""
	echo "File not found: $datadir/tbutil-credentials.json"
	echo "It looks as if you havent run 'setup' yet."
	echo ""
	exit 2
fi

main
exit $?