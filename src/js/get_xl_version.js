// :credentials: not_required

try {
	var p = plugin("sqlite3-plugin");

	var db = p.open(getenv("xl1_db"));
	db.query("select json from metadata where name = 'version'").forEach(row => {
		var v = JSON.parse(row.json).version.split(".");
		if (v.length >= 3) {
			printf("V%v.%v\n", v[0], v[1])
		} else {
			println("XL");
		}
	});
} catch (ex) {
	println("XL");
}
