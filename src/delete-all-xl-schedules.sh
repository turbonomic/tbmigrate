for s in `bin/tbutil @xl get /schedules | jq -r '.[].uuid'`; do
	bin/tbutil @xl delete /schedules/$s < /dev/null
done