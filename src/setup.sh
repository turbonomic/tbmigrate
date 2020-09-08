#! /bin/bash

trap 'rm -f /tmp/$$' 0

export TURBO_FORCE_COLOUR=yes

. ./.env

rm -rf "$datadir" "$logsdir" "$reportsdir"
mkdir -p  "$datadir" "$logsdir" "$reportsdir" || exit 2

cd js && ln -sf ../bin/select . && cd ..

echo '================================================='
echo '|                                               |'
echo '| Configure credentials for CLASSIC instance    |'
echo '|                                               |'
echo '================================================='
if $local_classic; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi
TURBO_ASSERT_MODEL=classic \
TURBO_ASSERT_MIN_VERSION=$min_classic_version \
TURBO_ASSERT_USER_ROLE=administrator \
	./bin/tbutil "$classic_cred" save credentials || exit 2

# Validate the license
if ! ./bin/tbutil "$classic_cred" license -days-left > /tmp/$$ 2>&1; then
	echo
	setterm -foreground red -bold on
	echo Error validating the classic instance license.
	setterm -default
	echo
	exit 2
fi

if [ "$local_classic" != "true" ]; then
	echo ""
	echo "+========================================================================================+"
	echo "| SSH credentials for CLASSIC instance                                                   |"
	echo "+========================================================================================+"
	echo "| You can set up SSH credentials to the classic instance now. These are needed if you    |"
	echo "| want to auto-migrate target passwords. You can still perform config migration without  |"
	echo "| them, but you will need to supply the passwords for all targets yourself.              |"
	echo "+========================================================================================+"
	echo ""
	echo -n "So: do you want to configure SSH crentials (y/n)? "
	while :; do
		read yn || exit 0
		if [ "$yn" = "y" ] || [ "$yn" = "n" ]; then
			break
		fi
		echo "** wrong answer - must 'y' or 'n' **"
		echo -n "retry: "
	done

	if  [ "$yn" = 'y' ]; then
		./bin/tbutil "$classic_cred" save ssh credentials || exit 2
	fi

fi


echo '================================================='
echo '|                                               |'
echo '| Configure credentials for XL instance         |'
echo '|                                               |'
echo '================================================='
if $local_xl; then
	export TURBO_CRED_HOST=127.0.0.1
else
	unset TURBO_CRED_HOST
fi
TURBO_ASSERT_MODEL=xl \
TURBO_ASSERT_MIN_VERSION=$min_xl_version \
TURBO_ASSERT_USER_ROLE="administrator|site_admin" \
	./bin/tbutil "$xl_cred" save credentials || exit 2

# Validate the license
if ! ./bin/tbutil "$xl_cred" license -days-left > /tmp/$$ 2>&1; then
	echo
	setterm -foreground red -bold on
	echo Error validating the XL instance license.
	setterm -default
	echo
	exit 2
fi

./bin/tbutil "$xl_cred" get /search/criteria > "$datadir"/xl-search-criteria.json || exit 2
