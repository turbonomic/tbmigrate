roll_logs()
{
	name=$1
	n=50
	while [ $n -gt 0 ]; do
		n1=$(printf "%03d" $n)
		if [ -f logs/$name.log.$n1 ]; then
			n2=$(printf "%03d" $(( n + 1 )))
			mv logs/$name.log.$n1 logs/$name.log.$n2
		fi
		n=$(( n - 1 ))
	done
	mv logs/$name.log logs/$name.log.001 2> /dev/null
}
