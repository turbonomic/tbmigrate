#! /bin/bash

if [ "$1" = "-f" ]; then
	force=true # potentially dangerous! You've been warned.
	shift
else
	force=false
fi

. ./.env

ready=$(bin/tbscript @null js/db-stats.js reviewGroupsReady 2>/dev/null)
if [ "$force" = "false" ] && [ "$ready" != "true" ]; then
	echo "Not ready to run 'compare-groups' yet - refer to the documentation for the correct order"
	exit 2
fi

xldb="${xl1_db}"

if [ -s "${xl2_db}" ] && [ "${xl2_db}" -nt "${xldb}" ]; then
	xldb="${xl2_db}"
fi

if [ -s "${xl3_db}" ] && [ "${xl3_db}" -nt "${xldb}" ]; then
	xldb="${xl3_db}"
fi

if [ -t 0 ] && [ -t 1 ]; then
	bin/viewer -n "Review Migrated Groups" sh -c "cd js && ../bin/tbscript @null compare-groups.js '${classic_db}' '${xldb}'"
	stat="$?"
	if [ $stat = 9 ]; then
		echo "Saving report to file '/tmp/groups.txt' ..."
		cd js && ../bin/tbscript @null compare-groups.js "${classic_db}" "${xldb}" > /tmp/groups.txt
		echo "Done."
	fi
else
	cd js && ../bin/tbscript @null compare-groups.js "${classic_db}" "${xldb}"
fi