#! /bin/bash

yellow=`setterm -foreground yellow -bold on`
green=`setterm -foreground green -bold on`
blue=`setterm -foreground blue -bold on`
red=`setterm -foreground red -bold on`
bold=`setterm -bold on`
reset=`setterm -default`

if [ -f /srv/tomcat/webapps/vmturbo.war ] && [ -f /var/log/tomcat/catalina.out ]; then
	:
else
	export local_classic=${local_classic:-false}
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

confirm() {
	product=`productName`

	while :; do
		clear
		date
		echo "+--------------------------------------------------------------------------+"
		echo "|                          Supplychain Comparison                          |"
		echo "+--------------------------------------------------------------------------+"
		setterm -foreground cyan -bold on
		/bin/echo -ne "... Wait ...\r"
		(
			cd js
			../bin/tbscript @xl supplychain.js
		)
		setterm -default
		echo "----------------------------------------------------------------------------"
		echo
		echo "Please open the $product UI or refer to the listing above and wait until"
		echo "topology discovery is complete. Note that at this time, no actions will be"
		echo "reported so the supply-chain will be all-green in the UI".
		echo
		echo "Depending on the number of targets and the size of your managed estate, "
		echo "this could take 20 minutes or more."
		echo
		echo "You can now:"
		echo "- Press ${yellow}<return>${reset} to refresh the listing above."
		echo "- Type '${yellow}ready${reset}' then press ${yellow}<return>${reset} when you are happy that discovery is complete."
		echo "- Type '${yellow}menu${reset}' then press ${yellow}<return>${reset} to return to the main menu."
		echo "- Press ${yellow}Control-C${reset} to exit the migration tool."
		echo -n "==> "
		while :; do
			read x
			if [ "$x" = "" ]; then
				break
			elif [ "$x" = "ready" ]; then
				sqlite3 $1 'replace into metadata values ("targets_1_confirmed", "true")'
				return 0
			elif [ "$x" = "menu" ]; then
				return 1
			else
				echo -n "Unrecognised input: try again: "
			fi
		done
	done
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

while : ; do
	clear
	opt=$(bin/menu)
	clear
	waitAtEnd=true

	if [ "$opt" = "" ]; then
		exit 0
	fi

	if [ "$opt" = creds ]; then
		run sh setup.sh

	elif [ "$opt" = "collect-1" ]; then
		run sh collect-data.sh 1

	elif [ "$opt" = "targets-1" ]; then
		run sh migrate-targets.sh 1
		if [ $? != 1 ]; then
			echo
			x="${yellow}*${reset}"
			echo "$yellow***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************$reset"
			echo "$x You should wait until discovery of the new targets is 100% complete $x"
			echo "$x before progressing to the next step. You can monitor progress using $x"
			echo "$x the UI, and waiting until you see that the supply chain etc are     $x"
			echo "$x fully populated.                                                    $x"
			echo "$yellow***********************************************************************$reset"
			echo
		fi

	elif [ "$opt" = "confirm-1" ]; then
		confirm data/xl1.db
		waitAtEnd=false

	elif [ "$opt" = "collect-2" ]; then
		x="${yellow}*${reset}"
		echo "$yellow***********************************************************************"
		echo "*                             PLEASE CONFIRM                          *"
		echo "***********************************************************************$reset"
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
		run sh migrate-groups.sh 1

	elif [ "$opt" = "review-groups-1" ]; then
		run sh compare-groups.sh
#		waitAtEnd=false

	elif [ "$opt" = "targets-2" ]; then
		run sh migrate-targets.sh 2
		if [ $? != 1 ]; then
			x="${yellow}*${reset}"
			echo
			echo "$yellow***********************************************************************"
			echo "*                                 NOTE                                *"
			echo "***********************************************************************$reset"
			echo "$x You should wait until discovery of the new targets is 100% complete $x"
			echo "$x before progressing to the next step. You can monitor progress using $x"
			echo "$x the UI, and waiting until you see that the supply chain is fully    $x"
			echo "$x populated.                                                          $x"
			echo "$yellow***********************************************************************$reset"
			echo
		fi

	elif [ "$opt" = "confirm-2" ]; then
		confirm data/xl2.db
		waitAtEnd=false

	elif [ "$opt" = "collect-3" ]; then
		x="${yellow}*${reset}"
		echo "$yellow***********************************************************************"
		echo "*                                CONFIRM                              *"
		echo "***********************************************************************$reset"
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
		run sh migrate-groups.sh 2

	elif [ "$opt" = "templates" ]; then
		run sh migrate-templates.sh

	elif [ "$opt" = "policies" ]; then
		run sh migrate-policies.sh

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

	elif [ $(expr "$opt" : "viewlog ") = 8 ]; then
		eval $opt

	fi

	if $waitAtEnd; then
		echo -n "Press <return>: "
		read cr || exit 0
	fi

done
