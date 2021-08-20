#! /bin/bash

. ./.env

export _classic="$branding_classic"
export _xl="$branding_xl"
export _vendor="$branding_vendor"
export _product="$branding_product"

export TURBO_BRANDING_PRODUCT="$_product"
export TURBO_COOKIES_DIR=$cookiesdir

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
(
	echo "PLEASE NOTE"
	echo ""
	echo "In order to ensure that your infrastructure is not being managed by two $_product instances"
	echo "in parallel, this tool will turn ALL actions off in the $_xl instance."
	echo ""
	echo "Please refer to the"
	echo "documentation for advice on how and when to turn them back on (this should only be done"
	echo "after turning them OFF in the $_classic instance)."
) | bin/viewer -box

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

(
	echo "Configure credentials for $_classic instance"
) | bin/viewer -box

if $local_classic; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi

log "save credentials for classic"
if [ "$_classic" = CWOM ]; then
	prod=CWOM
	platform="CWOM"
else
	prod="Turbonomic"
	platform="Turbonomic"
fi

TURBO_BRANDING_PRODUCT=$prod \
TURBO_ASSERT_MODEL=classic \
_TURBO_ASSERT_PLATFORM=$platform \
TURBO_ASSERT_MIN_VERSION=$min_classic_version \
TURBO_ASSERT_USER_ROLE=administrator \
	$tbutil "$classic_cred" save local credentials
if [ $? -ne 0 ]; then
	log Failed
	exit 2
fi
log Okay

# Validate the license
log "license check for classic"
if ! logError $tbutil "$classic_cred" license -days-left > /tmp/$$ 2>&1; then
	log Failed
	cat /tmp/$$ >> "$logfile"
	echo
	setterm -foreground red -bold on
	echo Error validating the $_classic instance license.
	setterm -default
	echo
	exit 2
fi
log Okay

if [ "$local_classic" != "true" ]; then
	log "ask - ssh credentails for classic wanted?"
	(
		echo "SSH credentials for $_classic instance"
		echo ""
		echo "You can set up SSH credentials to the $_classic instance now. These are needed if you"
		echo "want to auto-migrate target passwords. You can still perform config migration without"
		echo "them, but you will need to supply the passwords for all targets yourself."
	) | bin/viewer -box
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
		$tbutil "$classic_cred" save ssh credentials
		if [ $? -ne 0 ]; then
			log Failed
			exit 2
		fi
		log Okay
	fi
fi


(
	echo "Configure credentials for $_xl instance"
) | bin/viewer -box
if $local_xl; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi

log "save credentials for XL"
if [ "$_xl" = IWO ]; then
	while :; do
		TURBO_REDUCED_HEADER=true $tbutil "$xl_cred" save iwo credentials
		if [ $? -ne 0 ]; then
			log Failed
			exit 2
		fi

		rm -rf "$TURBO_COOKIES_DIR"

		if $tbutil "$xl_cred" ping; then
			break
		fi

		log "Ping test failed"
		echo "Credential test failed"

		while :; do
			echo -n "Press <return> to re-enter the credentials or 'q' then <return> to quit: "
			read ok || exit 2
			if [ "$ok" = "q" ]; then
				exit 2
			fi
			if [ "$ok" = "" ]; then
				break
			fi
		done
	done
else
	TURBO_ASSERT_MODEL=xl \
	TURBO_ASSERT_MIN_VERSION=$min_xl_version \
	TURBO_ASSERT_USER_ROLE="administrator|site_admin" \
		$tbutil "$xl_cred" save credentials
	if [ $? -ne 0 ]; then
		log Failed
		exit 2
	fi
fi
log Okay

# Validate the license
while true; do
	log "license check for XL"
	echo "Checking $_xl license ..."
	if $tbutil "$xl_cred" license -days-left > /tmp/$$ 2>&1; then
		break
	fi
	log Failed
	cat /tmp/$$ >> "$logfile"
	echo; echo; echo
	setterm -foreground red -bold on
	echo Error validating the $_xl instance license.
	setterm -default
	echo
	echo Please install a valid license in the $_xl instance using the UI.
	echo -n "Press <return> when ready (or 'q' then <return> to quite): "
	read cr || exit 2
	if [ "$cr" = "q" ]; then
		exit 2
	fi

	echo
done
log Okay

echo
echo

log "get search critera from XL"
logError $tbutil "$xl_cred" get /search/criteria > "$datadir"/xl-search-criteria.json
if [ $? -ne 0 ]; then
	log Failed
	exit 2
fi
log Okay

if [ "$_xl" != "IWO" ]; then
	(
		echo "Target Password Migration"
		echo ""
		echo "Do you wish to allow the tool to migrate passwords for your targets?"
		echo ""
		echo "If you answer 'n' (no) then you will need to enter them by hand later, in the"
		echo "'migrate targets' step of this process."
		echo ""
		echo "If you answer 'y' (yes), the passwords will be migrated for you."
		echo ""
		echo "NOTE: They will NOT be decrypted by this tool but will be passed to the $_xl instance"
		echo "in their encrypted form."
		echo ""
		echo "We recommend answering 'y'."
	) | bin/viewer -box

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
fi

echo ""
