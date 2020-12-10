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

option=""

if [ "$1" = "-skip-passwords" ]; then
	shift
	option="-skip-passwords"
elif [ ! -f data/.migrate-passwords ]; then
	option="-skip-passwords"
fi

phase="$1"

if [ "$phase" != 1 ] && [ "$phase" != 2 ] && [ "$phase" != 3 ]; then
	echo
	echo "Usage is:"
	echo
	echo "  sh collect-data.sh [-skip-passwords] {phase}"
	echo
	echo "Where {phase} is 1, 2 or 3"
	echo
	exit 2
fi

phase1() {
	ready=$(bin/tbscript @null js/db-stats.js collect1Ready 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'collect-data.sh 1' yet - refer to the documentation for the correct order"
		exit 2
	fi

	rm -f "$classic_db" "$classic_db"-work \
		"$xl1_db" "$xl1_db"-work \
		"$xl2_db" "$xl2_db"-work \
		"$xl3_db" "$xl3_db"-work \
		data/.redo-collect-1
#		"$logsdir"/*.log*

	echo "+---------------------------------------------------------------+"
	echo "|                                                               |"
	echo "| Collecting data from CLASSIC instance                         |"
	echo "|                                                               |"
	echo "+---------------------------------------------------------------+"

	roll_logs classic-collect

	(
		cd js 
		script -q -c "
			../bin/tbscript \"$classic_cred\" collect.js $option -target-criteria \"$datadir\"/xl-search-criteria.json \"$classic_db\"-work &&
			mv \"$classic_db\"-work \"$classic_db\"
		" "$logsdir"/classic-collect.log
	)

	if [ ! -f "$classic_db" ]; then
		echo Error detected
		exit 2
	fi

	(cd js && ../bin/tbscript "$classic_cred" report.js "$classic_db" > "$reportsdir"/classic.html)

	echo "+---------------------------------------------------------------+"
	echo "|                                                               |"
	echo "| Collecting data from XL instance (phase 1)                    |"
	echo "|                                                               |"
	echo "+---------------------------------------------------------------+"

	roll_logs xl-collect-1

	(
		cd js
		script -q -c "
			../bin/tbscript \"$xl_cred\" collect.js -skip-passwords -source-db \"$classic_db\" \"$xl1_db\"-work &&
			mv \"$xl1_db\"-work \"$xl1_db\"
		" "$logsdir"/xl-collect-1.log
	)

	if [ ! -f "$xl1_db" ]; then
		echo Error detected
		exit 2
	fi

	(cd js && ../bin/tbscript "$xl_cred" report.js "$xl1_db" > "$reportsdir"/xl1.html)

	(
		# Can we skip the first migrate-targets and following collection?
		cd js
		../bin/tbscript "$xl_cred" migrate-targets.js -count-only "$classic_db" "$xl1_db"
		if [ $? = 111 ]; then
			cp "$xl1_db" "$xl2_db"
			cp "$reportsdir/xl1.html" "$reportsdir/xl2.html"

			roll_logs migrate-targets-1
			date > "$logsdir/migrate-targets-1.log"

			roll_logs xl-collect-2
			date > "$logsdir/xl-collect-2.log"
		fi
	)
}


phase2() {
	ready=$(bin/tbscript @null js/db-stats.js collect2Ready 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'collect-data.sh 2' yet - refer to the documentation for the correct order"
		exit 2
	fi

	rm -f \
		"$xl2_db" "$xl2_db"-work \
		"$xl3_db" "$xl3_db"-work

	echo "+---------------------------------------------------------------+"
	echo "|                                                               |"
	echo "| Collecting data from XL instance (phase 2)                    |"
	echo "|                                                               |"
	echo "+---------------------------------------------------------------+"

	roll_logs xl-collect-2

	(
		cd js
		script -q -c "
			../bin/tbscript \"$xl_cred\" collect.js -skip-passwords -check-discovery -source-db \"$classic_db\" -map-groups \"$xl2_db\"-work &&
			mv \"$xl2_db\"-work \"$xl2_db\"
		" "$logsdir"/xl-collect-2.log
	)

	if [ ! -f "$xl2_db" ]; then
		echo Error detected
		exit 2
	fi

	(cd js && ../bin/tbscript "$xl_cred" report.js "$xl2_db" > "$reportsdir"/xl2.html)
}


phase3() {
	ready=$(bin/tbscript @null js/db-stats.js collect3Ready 2>/dev/null)
	if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
		echo "Not ready to run 'collect-data.sh 3' yet - refer to the documentation for the correct order"
		exit 2
	fi

	rm -f "$xl3_db" "$xl3_db"-work

	echo "+---------------------------------------------------------------+"
	echo "|                                                               |"
	echo "| Collecting data from XL instance (phase 3)                    |"
	echo "|                                                               |"
	echo "+---------------------------------------------------------------+"

	roll_logs xl-collect-3

	(
		cd js
		script -q -c "
			../bin/tbscript \"$xl_cred\" collect.js -skip-passwords -source-db \"$classic_db\" -map-groups \"$xl3_db\"-work &&
			mv \"$xl3_db\"-work \"$xl3_db\"
		" "$logsdir"/xl-collect-3.log
	)

	if [ ! -f "$xl3_db" ]; then
		echo Error detected
		exit 2
	fi

	(cd js && ../bin/tbscript "$xl_cred" report.js "$xl3_db" > "$reportsdir"/xl3.html)
}


mkdir -p `pwd`/data `pwd`/logs || exit 2

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
elif [ "$phase" = 3 ]; then
	phase3
fi
