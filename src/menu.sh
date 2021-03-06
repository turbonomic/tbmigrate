#! /bin/bash

yellow=`setterm -foreground yellow -bold on`
green=`setterm -foreground green -bold on`
blue=`setterm -foreground blue -bold on`
red=`setterm -foreground red -bold on`
bold=`setterm -bold on`
reset=`setterm -default`
white=`setterm -foreground white -bold on`

export width

if [ -f /srv/tomcat/webapps/vmturbo.war ] && [ -f /var/log/tomcat/catalina.out ]; then
	:
else
	export local_classic=${local_classic:-false}
fi

if [ "$TERM" = "xterm" ]; then
	export TERM=xterm-256color
fi

productName() {
	nCisco=`sqlite3 data/classic.db 'select * from metadata where name = "version"' 2>&1 | fgrep -ic "cisco workload optimization manager"`
	nTurbo=`sqlite3 data/classic.db 'select * from metadata where name = "version"' 2>&1 | fgrep -ic "turbonomic operations manager"`
	if [ $nCisco = 1 ] && [ $nTurbo = 0 ]; then
		echo CWOM
		return
	fi
	echo Turbonomic
}

run() {
	clear
	echo "$green$USER@`hostname`$reset:${blue}`pwd | sed -e s@$HOME@~@`${reset}\$: ${bold}$*${reset}"
	echo
	sleep 1
	eval $*
	return $?
}

viewlog() {
	clear
	echo "${yellow}================================================================"
	echo Viewing: $1
	echo "================================================================${reset}"
	echo
	if [ -f "$1.clean" ]; then
		more -d "$1.clean"
		rm -f "$1.clean"
	else
		more -d "$1"
	fi
}

. ./.env

while : ; do
	clear
	opt=$(bin/menu) || exit
	clear

	export width=`bin/select -w`
	waitAtEnd=true

	if [ "$opt" = "" ]; then
		(
			for f in logs/*.log; do
				sed "s,\x1B\[[0-9;]*m,,g" < "$f" > "text-$f"
			done
		) > /dev/null 2>&1

		exit 0
	fi

	if [ "$opt" = "too_small" ]; then
		echo
		echo "Please expand this window to a minimum of:"
		echo
		echo " 126 columns by 34 lines"
		echo
		echo "Then re-run 'sh menu.sh'. Thank you."
		exit 0

	elif [ "$opt" = creds ]; then
		run sh setup.sh

	elif [ "$opt" = x-creds ]; then
		export min_classic_version=0.0.0
		run sh setup.sh

	elif [ "$opt" = "collect-1" ]; then
		run sh collect-data.sh 1

	elif [ "$opt" = "targets-1" ]; then
		run sh migrate-targets.sh 1
		stat=$?
		if [ $stat != 1 ] && [ $stat != 22 ]; then
			echo
			x="${yellow}*${reset}"
			echo "${yellow}***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************${reset}"
			echo "$x You should wait until discovery of the new targets is 100% complete $x"
			echo "$x before progressing to the next step. You can monitor progress using $x"
			echo "$x the UI, and waiting until you see that the supply chain etc are     $x"
			echo "$x fully populated.                                                    $x"
			echo "$x                                                                     $x"
			echo "$x We recommend that you wait AT LEAST ${min_discovery_wait_mins} minutes (though longer may   $x"
			echo "$x be needed for large topologies).                                    $x"
			echo "$x                                                                     $x"
			echo "$x Please review the created targets before continuing to the next     $x"
			echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
			echo "$x TARGETS' section of the web page ...                                $x"
			echo "$x                                                                     $x"
			echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
			echo "$x                                                                     $x"
			echo "$x or in the 'Review migration results' document which can be viewed   $x"
			echo "$x from the main menu.                                                 $x"
			echo "${yellow}***********************************************************************${reset}"
			echo
		fi

	elif [ "$opt" = "collect-2" ]; then
		age=$(bin/tbscript @null js/db-stats.js xl1_target_age)
		if [ "$age" -lt ${min_discovery_wait_mins} ]; then
			echo
			echo "${red}Error: it's been $age mins since the last target was migrated to XL.${reset}"
			echo
			echo "${yellow}You should wait ${red}at least ${min_discovery_wait_mins} mins${yellow} for discovery to complete.${reset}"
			echo
			echo "(${yellow}but note: medium and large infrastructures may well require longer${reset})"
			echo
		else
			x="${yellow}*${reset}"
			echo "${yellow}***********************************************************************"
			echo "*                             PLEASE CONFIRM                          *"
			echo "***********************************************************************${reset}"
			echo -n "Has the `productName` XL instance finished discovering the topology (y/n)? "
			read yn || continue
			if [ "$yn" = "y" ]; then
				run sh collect-data.sh 2
			else
				echo
				echo "${red}Warning: Data collection cancelled${reset}"
				echo
			fi
		fi

	elif [ "$opt" = "x-collect-2" ]; then
		x="${yellow}*${reset}"
		echo "${yellow}***********************************************************************"
		echo "*                             PLEASE CONFIRM                          *"
		echo "***********************************************************************${reset}"
		echo -n "Has the `productName` XL instance finished discovering the topology (y/n)? "
		read yn || continue
		if [ "$yn" = "y" ]; then
			run sh collect-data.sh 2
		else
			echo
			echo "${red}Warning: Data collection cancelled${reset}"
			echo
		fi

	elif [ "$opt" = "groups-1" ]; then
		run sh migrate-groups.sh -i 1
		if [ $? != 1 ]; then
			x="${yellow}*${reset}"
			echo
			echo "${yellow}***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************${reset}"
			echo "$x Please review the created groups before continuing to the next      $x"
			echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
			echo "$x GROUPS' section of the web page ...                                 $x"
			echo "$x                                                                     $x"
			echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
			echo "$x                                                                     $x"
			echo "$x or in the 'Review migration results' document which can be viewed   $x"
			echo "$x from the main menu.                                                 $x"
			echo "${yellow}***********************************************************************${reset}"
			echo
		fi

	elif [ "$opt" = "review-groups-1" ]; then
		run sh compare-groups.sh

	elif [ "$opt" = "targets-2" ]; then
		run sh migrate-targets.sh 2
		if [ $? != 1 ]; then
			x="${yellow}*${reset}"
			echo
			echo "${yellow}***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************${reset}"
			echo "$x You should wait until discovery of the new targets is 100% complete $x"
			echo "$x before progressing to the next step. You can monitor progress using $x"
			echo "$x the UI, and waiting until you see that the supply chain is fully    $x"
			echo "$x populated.                                                          $x"
			echo "$x                                                                     $x"
			echo "$x We recommend that you wait AT LEAST ${min_discovery_wait_mins} minutes (though longer may   $x"
			echo "$x be needed for large topologies)                                     $x"
			echo "$x                                                                     $x"
			echo "$x Please re-review the created targets before continuing to the next  $x"
			echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
			echo "$x TARGETS' section of the web page ...                                $x"
			echo "$x                                                                     $x"
			echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
			echo "$x                                                                     $x"
			echo "$x or in the 'Review migration results' document which can be viewed   $x"
			echo "$x from the main menu.                                                 $x"
			echo "${yellow}***********************************************************************${reset}"
			echo
		fi

	elif [ "$opt" = "collect-3" ]; then
		age=$(bin/tbscript @null js/db-stats.js xl2_target_age)
		if [ "$age" -lt ${min_discovery_wait_mins} ]; then
			echo
			echo "${red}Error: it's been $age mins since the last target was migrated to XL.${reset}"
			echo
			echo "${yellow}You should wait ${red}at least ${min_discovery_wait_mins} mins${yellow} for discovery to complete.${reset}"
			echo
			echo "(${yellow}but note: medium and large infrastructures may well require longer${reset})"
			echo
		else
			x="${yellow}*${reset}"
			echo "${yellow}***********************************************************************"
			echo "*                                CONFIRM                              *"
			echo "***********************************************************************${reset}"
			echo -n "Is topology discovery complete (y/n)? "
			read yn || continue
			if [ "$yn" = "y" ]; then
				run sh collect-data.sh 3
			else
				echo
				echo "${red}Warning: Data collection cancelled${reset}"
				echo
			fi
		fi

	elif [ "$opt" = "x-collect-3" ]; then
		x="${yellow}*${reset}"
		echo "${yellow}***********************************************************************"
		echo "*                                CONFIRM                              *"
		echo "***********************************************************************${reset}"
		echo -n "Is topology discovery complete (y/n)? "
		read yn || continue
		if [ "$yn" = "y" ]; then
			run sh collect-data.sh 3
		else
			echo
			echo "${red}Warning: Data collection cancelled${reset}"
			echo
		fi

	elif [ "$opt" = "groups-2" ]; then
		run sh migrate-groups.sh -i 2
		if [ $? != 1 ]; then
			x="${yellow}*${reset}"
			echo
			echo "${yellow}***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************${reset}"
			echo "$x Please review the created groups before continuing to the next      $x"
			echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
			echo "$x GROUPS' section of the web page ...                                 $x"
			echo "$x                                                                     $x"
			echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
			echo "$x                                                                     $x"
			echo "$x or in the 'Review migration results' document which can be viewed   $x"
			echo "$x from the main menu.                                                 $x"
			echo "${yellow}***********************************************************************${reset}"
			echo
		fi

	elif [ "$opt" = "templates" ]; then
		run sh migrate-templates.sh
		x="${yellow}*${reset}"
		echo
		echo "${yellow}***********************************************************************"
		echo "*                                 NOTE                                *"
		echo "***********************************************************************${reset}"
		echo "$x Please review the created templates before continuing to the next   $x"
		echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
		echo "$x TEMPLATES' section of the web page ...                              $x"
		echo "$x                                                                     $x"
		echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
		echo "$x                                                                     $x"
		echo "$x or in the 'Review migration results' document which can be viewed   $x"
		echo "$x from the main menu.                                                 $x"
		echo "${yellow}***********************************************************************${reset}"
		echo

	elif [ "$opt" = "policies" ]; then
		run sh migrate-policies.sh
		x="${yellow}*${reset}"
		echo
		echo "${yellow}***********************************************************************"
		echo "*                                 NOTE                                *"
		echo "***********************************************************************${reset}"
		echo "$x Please review the created policies before continuing to the next    $x"
		echo "$x step. Information on how to do this is available in the 'REVIEWING  $x"
		echo "$x POLICIES' and 'REVIEWING ACTION SCRIPTS' sections of the web page:  $x"
		echo "$x                                                                     $x"
		echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
		echo "$x                                                                     $x"
		echo "$x or in the 'Review migration results' document which can be viewed   $x"
		echo "$x from the main menu.                                                 $x"
		echo "${yellow}***********************************************************************${reset}"
		echo

	elif [ "$opt" = "users" ]; then
		run sh migrate-users.sh
		echo
		echo "${yellow}***********************************************************************"
		echo "*                                 NOTE                                *"
		echo "***********************************************************************${reset}"
		echo "$x Please review the created users and user groups  before continuing  $x"
		echo "$x to the next step. Information on how to do this is available in the $x"
		echo "$x 'REVIEWING USERS AND USER GROUPS' section of the web page ...       $x"
		echo "$x                                                                     $x"
		echo "$x  ${yellow}https://github.com/turbonomic/tbmigrate/blob/master/REVIEW.md      $x"
		echo "$x                                                                     $x"
		echo "$x or in the 'Review migration results' document which can be viewed   $x"
		echo "$x from the main menu.                                                 $x"
		echo "${yellow}***********************************************************************${reset}"
		echo

	elif [ "$opt" = "expose-classic-report" ]; then
		cp reports/classic.html /var/www/html/tbmigrate-report.html
		if [ $? = 0 ]; then
			echo
			echo "You can view the report by browsing to.."
			echo
			n=`ip addr | awk '/scope global eth0/ { print $2 }' | cut -f1 -d/  | wc -w`
			if [ "$n" -eq 1 ]; then
				IP=`ip addr | awk '/scope global eth0/ { print $2 }' | cut -f1 -d/`
			else
				IP=IP_ADDRESS
			fi
			echo "    http://$IP/tbmigrate-report.html"
			echo
			echo -n "Press /return/ when finished: "
			read x
			rm -f /var/www/html/tbmigrate-report.html
			waitAtEnd=false
		fi

	elif [ "$opt" = "review" ]; then
		bin/viewer -m "Reviewing The Migration Results" cat REVIEW.md
		waitAtEnd=false

	elif [ $(expr "$opt" : "viewlog ") = 8 ]; then
		eval $opt

	elif [ "$opt" = "zip-logs" ]; then
		clear
		sh compare-groups.js > text-logs/groups.txt 2>&1
		tar cvfz /tmp/tbmigrate-logs.tgz \
			data \
			logs \
			text-logs \
			`[ -d reports ] && echo reports` \
			`[ -f .version ] && echo .version`

		x="${yellow}*${reset}"
		echo
		echo "${yellow}*********************************************************************************"
		echo "*                                      NOTE                                     *"
		echo "*********************************************************************************${reset}"
		echo "${x}                                                                               ${x}"
		echo "${x} The file 'tbmigrate-logs.tgz' in the /tmp directory now contains the data and ${x}"
		echo "${x} log files needed by Turbonomic support to review your migration status.       ${x}"
		echo "${x}                                                                               ${x}"
		echo "${yellow}*********************************************************************************${reset}"
		echo

	else
		n=0
		while [ $n -le 9 ]; do
			if [ "$opt" = "alt-$n" ]; then
				waitAtEnd=false
				if [ -d "../tbmigrate-$n" ]; then
					cd ../tbmigrate-$n && exec sh menu.sh
				fi
			fi
			n=$(( n + 1 ))
		done

	fi

	if $waitAtEnd; then
		echo -n "Press <return>: "
		read cr || exit 0
	fi

done
