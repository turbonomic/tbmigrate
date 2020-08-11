for p in `bin/tbutil @xl list group settings policies -jsfilter '($.readOnly === false)'`; do
	bin/tbutil @xl delete settings policy $p
done
