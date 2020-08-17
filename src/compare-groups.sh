#! /bin/bash

bin/viewer "Review Migrated Groups" sh -c "cd js && ../bin/tbscript @xl compare-groups.js ../data/classic.db ../data/xl2.db"
