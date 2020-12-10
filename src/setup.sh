#! /bin/bash

. ./.env
. bin/functions.sh

roll_logs setup

logfile="$logsdir/setup.log"

log() {
	mkdir -p "$logsdir"
	echo "`date`: $*" >> "$logfile"
}

logError() {
	mkdir -p "$logsdir"
	$* 2> /tmp/$$.err
	stat=$?
	cat /tmp/$$.err
	cat /tmp/$$.err >> "$logfile"
	rm -f /tmp/$$.err
	return $stat
}

trap 'log "End"; rm -f /tmp/$$' 0

log "Begin"

clear
echo
log "ask - ok to continue?"
echo "+------------------------------------------------------------------------------------------------+"
echo "|                                          PLEASE NOTE                                           |"
echo "+------------------------------------------------------------------------------------------------+"
echo "|  In order to ensure that your infrastructure is not being managed by two Turbonomic instances  |"
echo "|  in parallel, this tool will turn ALL actions off in the XL instance. Please refer to the      |"
echo "|  documentation for advice on how and when to turn them back on (this should only be done       |"
echo "|  after turning them OFF in the 'Classic' instance).                                            |"
echo "+------------------------------------------------------------------------------------------------+"
while true; do
	echo -n "Do you wish to continue (y/n)? "
	read yn || exit 2
	log "answer: '$yn'"
	if [ "$yn" = y ]; then break; fi
	if [ "$yn" = n ]; then exit 0; fi
done

clear

export TURBO_FORCE_COLOUR=yes

logError rm -rf "$datadir" "$reportsdir" "$textlogsdir"
logError mkdir -p  "$datadir" "$logsdir" "$reportsdir" "$textlogsdir" || exit 2
find "$logsdir" -maxdepth 1 -type f \! -name 'setup.log*' -exec rm {} \;

cd js && ln -sf ../bin/select . && cd ..

echo '+-----------------------------------------------+'
echo '|                                               |'
echo '| Configure credentials for CLASSIC instance    |'
echo '|                                               |'
echo '+-----------------------------------------------+'
if $local_classic; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi

log "save credentials for classic"
TURBO_ASSERT_MODEL=classic \
TURBO_ASSERT_MIN_VERSION=$min_classic_version \
TURBO_ASSERT_USER_ROLE=administrator \
	./bin/tbutil "$classic_cred" save credentials
if [ $? -ne 0 ]; then
	log Failed
	exit 2
fi
log Okay

# Validate the license
log "license check for classic"
if ! logError ./bin/tbutil "$classic_cred" license -days-left > /tmp/$$ 2>&1; then
	log Failed
	cat /tmp/$$ >> "$logfile"
	echo
	setterm -foreground red -bold on
	echo Error validating the classic instance license.
	setterm -default
	echo
	exit 2
fi
log Okay

if [ "$local_classic" != "true" ]; then
	log "ask - ssh credentails for classic wanted?"
	echo ""
	echo "+----------------------------------------------------------------------------------------+"
	echo "| SSH credentials for CLASSIC instance                                                   |"
	echo "+----------------------------------------------------------------------------------------+"
	echo "| You can set up SSH credentials to the classic instance now. These are needed if you    |"
	echo "| want to auto-migrate target passwords. You can still perform config migration without  |"
	echo "| them, but you will need to supply the passwords for all targets yourself.              |"
	echo "+----------------------------------------------------------------------------------------+"
	echo ""
	echo -n "So: do you want to configure SSH crentials (y/n)? "
	while :; do
		read yn || exit 0
		log "answer: '$yn'"
		if [ "$yn" = "y" ] || [ "$yn" = "n" ]; then
			break
		fi
		echo "** wrong answer - must 'y' or 'n' **"
		echo -n "retry: "
	done

	if  [ "$yn" = 'y' ]; then
		log "save ssh credentials for classic"
		./bin/tbutil "$classic_cred" save ssh credentials
		if [ $? -ne 0 ]; then
			log Failed
			exit 2
		fi
		log Okay
	fi
fi


echo '+-----------------------------------------------+'
echo '|                                               |'
echo '| Configure credentials for XL instance         |'
echo '|                                               |'
echo '+-----------------------------------------------+'
if $local_xl; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi

log "save credentials for XL"
TURBO_ASSERT_MODEL=xl \
TURBO_ASSERT_MIN_VERSION=$min_xl_version \
TURBO_ASSERT_USER_ROLE="administrator|site_admin" \
	./bin/tbutil "$xl_cred" save credentials
if [ $? -ne 0 ]; then
	log Failed
	exit 2
fi
log Okay

# Validate the license
while true; do
	log "license check for XL"
	echo "Checking XL license ..."
	if ./bin/tbutil "$xl_cred" license -days-left > /tmp/$$ 2>&1; then
		break
	fi
	log Failed
	cat /tmp/$$ >> "$logfile"
	echo; echo; echo
	setterm -foreground red -bold on
	echo Error validating the XL instance license.
	setterm -default
	echo
	echo Please install a valid license in the XL instance using the UI.
	echo -n "Press <return> when ready (or 'q' then <return> to abort): "
	read cr
	if [ "$cr" = "q" ]; then
		exit 2
	fi

	echo
done
log Okay

echo
echo

log "get search critera from XL"
logError ./bin/tbutil "$xl_cred" get /search/criteria > "$datadir"/xl-search-criteria.json
if [ $? -ne 0 ]; then
	log Failed
	exit 2
fi
log Okay

echo "+--------------------------------------------------------------------------------------+"
echo "|                               Target Password Migration                              |"
echo "+--------------------------------------------------------------------------------------+"
echo "|  Do you wish to allow the tool to migrate passwords for your targets?                |"
echo "|                                                                                      |"
echo "|  If you answer 'n' (no) then you will need to enter them by hand later, in the       |"
echo "|  'migrate targets' step of this process.                                             |"
echo "|                                                                                      |"
echo "|  If you answer 'y' (yes), the passwords will be migrated for you.                    |"
echo "|                                                                                      |"
echo "|  NOTE: They will NOT be decrypted by this tool but will be passed to the XL instance |"
echo "|        in their encrypted form.                                                      |"
echo "|                                                                                      |"
echo "|  We recommend answering 'y'.                                                         |"
echo "+--------------------------------------------------------------------------------------+"
while true; do
	echo -n "Migrate Target Passwords (y/n)? "
	read yn || exit 2
	if [ "$yn" = y ] || [ "$yn" = n ]; then break; fi
done

if [ "$yn" = y ]; then
	touch data/.migrate-passwords
else
	rm -f data/.migrate-passwords
fi

echo ""
