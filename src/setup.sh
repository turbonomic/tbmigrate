#! /bin/bash

clear
echo
echo "+------------------------------------------------------------------------------------------------+"
echo "|                                          PLEASE NOTE                                           |"
echo "+------------------------------------------------------------------------------------------------+"
echo "|  In order to ensure that your infrastructure is not being managed by two Turbonomic instances  |"
echo "|  in parallel, this tool will turn ALL actions off in the XL instance. Please refer to the      |"
echo "|  documentation for advise on how and when to turn them back on (this should only be done       |"
echo "|  after turning them OFF in the 'Classic' instance).                                            |"
echo "+------------------------------------------------------------------------------------------------+"
while true; do
	echo -n "Do you wish to continue (y/n)? "
	read yn || exit 2
	if [ "$yn" = y ]; then break; fi
	if [ "$yn" = n ]; then exit 0; fi
done

clear


trap 'rm -f /tmp/$$' 0

export TURBO_FORCE_COLOUR=yes

. ./.env

rm -rf "$datadir" "$logsdir" "$reportsdir"
mkdir -p  "$datadir" "$logsdir" "$reportsdir" || exit 2

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


echo "+--------------------------------------------------------------------------------------+"
echo "|                               Target Password Migration                              |"
echo "+--------------------------------------------------------------------------------------+"
echo "|  Do you wish to allow the tool to migrate passwords for your targets? If you answer  |"
echo "|  'n' (no) then you will need to enter them by hand later in the process.             |"
echo "|                                                                                      |"
echo "|  Note: If you answer 'y' (yes), the passwords will NOT be decrypted by this tool     |"
echo "|  but will be passed to the XL instance in encrypted form.                            |"
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
