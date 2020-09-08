#! /bin/bash

ready=$(bin/tbscript @null js/db-stats.js reviewGroupsReady 2>/dev/null)
if [ "$ready" != "true" ]; then
	echo "Not ready to run 'compare-groups.sh' yet - refer to the documentation for the correct order"
	exit 2
fi

bin/viewer "Review Migrated Groups" sh -c "cd js && ../bin/tbscript @xl compare-groups.js ../data/classic.db ../data/xl2.db"
