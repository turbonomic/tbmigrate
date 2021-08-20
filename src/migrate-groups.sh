#! /bin/bash

if [ "$1" = "-f" ]; then
	force=true # potentially dangerous! You've been warned.
	shift
else
	force=false
fi


export TURBO_FORCE_COLOUR=yes

. ./.env
export _classic="$branding_classic"
export _xl="$branding_xl"
export _vendor="$branding_vendor"
export _product="$branding_product"

. bin/functions.sh

if [ "$1" = "-i" ]; then
	iopt="-i"
	shift
else
	iopt=""
fi


phase="$1"

if [ "$phase" != 1 ] && [ "$phase" != 2 ]; then
	echo
	echo "Usage is:"
	echo
	echo "  sh migrate-groups.sh [-i] {phase}"
	echo
	echo "Where {phase} is 1 or 2"
	echo "And '-i' enables the interactive group selector."
	echo
	exit 2
fi


phase1() {
	ready=$(bin/tbscript @null js/db-stats.js groups1Ready 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'migate-groups (1)' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-groups-1

	if [ "$_xl" = IWO ] && [ ! -s "$xl2_db" ] && [ -s "$xl1_db" ]; then
		cp "$xl1_db" "$xl2_db"
	fi

	cd js || exit 2
	script -q -ec "../bin/tbscript \"$xl_cred\" migrate-groups.js $iopt -skip-scoped-targets \"$classic_db\" \"$xl2_db\"" "$logsdir"/migrate-groups-1.log
	stat=$?
	../bin/cleanlog "$logsdir/migrate-groups-1.log"
	return $stat

}

phase2() {
	ready=$(bin/tbscript @null js/db-stats.js groups2Ready 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'migate-groups (2)' yet - refer to the documentation for the correct order"
		exit 2
	fi

	roll_logs migrate-groups-2

	cd js || exit 2

	if [ -s "$xl2_db" ] && [ ! -s "$xl3_db" ]; then
		cp "$xl2_db" "$xl3_db"
	fi

	script -q -ec "../bin/tbscript \"$xl_cred\" migrate-groups.js $iopt \"$classic_db\" \"$xl3_db\"" "$logsdir"/migrate-groups-2.log
	stat=$?
	../bin/cleanlog "$logsdir/migrate-groups-2.log"
	return $stat
}

export TURBO_FORCE_COLOUR=yes

if [ ! -r "$datadir"/tbutil-credentials.json ]; then
	echo ""
	echo "File not found: $datadir/tbutil-credentials.json"
	echo "It looks as if you havent run 'setup' yet."
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
