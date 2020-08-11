var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args[0]+"?mode=rw");
var xlDb = P.open("file:"+args[1]+"?mode=rw");

var lib = require("./libmigrate.js");
var cm = require("./group-creation-map.js");
var fn = require("@/functions");

var sql1 = `select * from groups_plus where displayName not regexp ? order by order_ desc`;
var sql2 = `select * from groups g, group_uuid_mapping m where m.classicUuid = ? and m.xlUuid = g.uuid`;

var headers = [ "Name", "Category", ">Size: Classic", ">XL", ">Diff", "Type" ];
var rows = [ ];

classicDb.query(sql1, [ lib.nameMap.excluded_group_names_re ]).forEach(classicGroup => {
	if (parseInt(classicGroup.isCustom) === 0 && parseInt(classicGroup.isStatic) === 1 && !classicGroup.category) {
		// these are groups that we dont create but check the existance of in "migrate_groups.js"
		return;
	}
	var xlGroup = null;
	xlDb.query(sql2, [ classicGroup.uuid ]).forEach(g => { xlGroup = g; });

	var t1 = classicGroup.isStatic === "1" ? "static" : "dynamic";
	var type = t1;
	if (xlGroup !== null) {
		var t2 = xlGroup.isStatic === "1" ? "static" : "dynamic";
		type = (t1 === t2) ? t1 : t1 + " ("+t2+" in XL)";
		if (classicGroup.category) {
			type = t2;
		}
	}

	var category = null;

	if (classicGroup.category) {
		category = classicGroup.category.trimPrefix("GROUP-").
			replace(/^(VirtualMachine|VMs)By/, "VMBy").
			replace(/^(PhysicalMachine|PMs)By/, "PMBy").
			replace("By", " By ");
	}

	if (classicGroup.category && type === "static") {
		type = "[red]static[-]";
	}

	var diff = null;
	if (xlGroup !== null) {
		diff = parseInt(xlGroup.entitiesCount) - parseInt(classicGroup.entitiesCount);
	}

	rows.push([
		classicGroup.displayName.limitLength(65),
		classicGroup.category ? category : classicGroup.groupType,
		classicGroup.entitiesCount,
		xlGroup === null ? "-" : xlGroup.entitiesCount,
		xlGroup === null ? "-" : diff,
		type
	]);
});

fn.printSortedTable(headers, rows, 0);
