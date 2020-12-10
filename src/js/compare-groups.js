var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args[0]+"?mode=rw");
var xlDb = P.open("file:"+args[1]+"?mode=rw");

var lib = require("./libmigrate.js");
var cm = require("./group-creation-map.js");
cm.set("lib", lib);

var fn = require("@/functions");

var sql1 = `select * from groups_plus where displayName not regexp ? order by order_ desc`;
var sql2 = `select * from groups g, group_uuid_mapping m where m.classicUuid = ? and m.xlUuid = g.uuid`;
var sql3 = `select * from groups where displayName = ?`;

var headers = [ "Name", "Category", ">Size: Classic", ">XL", ">Diff", "Type" ];
var rows = [ ];

var inViewer = getenv("IN_VIEWER") === "true";
var red = inViewer ? "[red]" : "";
var sgr0 = inViewer ? "[-]" : "";

var nameMap = lib.getGroupNameMap(classicDb);

function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}

classicDb.query(sql1, [ lib.nameMap.excluded_group_names_re ]).forEach(classicGroup => {
	if (parseInt(classicGroup.isCustom) === 0 && parseInt(classicGroup.isStatic) === 1 && !classicGroup.category) {
		// these are groups that we dont create but check the existance of in "migrate_groups.js"
//		return;
	}

	var xlName = mapGroupName(nameMap[classicGroup.uuid] || classicGroup.displayName);

	var xlGroup = null;
	var n = 0;
	xlDb.query(sql2, [ classicGroup.uuid ]).forEach(g => { xlGroup = g; n += 1; });

	var t1 = classicGroup.isStatic === "1" ? "static" : "dynamic";
	var type = t1;
	if (xlGroup === null) {
		xlDb.query(sql3, [xlName]).forEach(g => {
			n += 1;
			xlGroup = g;
		});
	}

	if (n !== 1) {
		xlGroup = null;
	}

	if (xlGroup !== null) {
		var t2 = xlGroup.isStatic === "1" ? "static" : "dynamic";
		type = (t1 === t2) ? t1 : t1 + " ("+red+t2+" in XL"+sgr0+")";
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
		if (xlGroup !== null) {
			if (type === "static") {
				type = "system ("+red+"static in XL"+sgr0+")";
			} else if (type === "dynamic") {
				type = "system (dynamic in XL)";
			}
		} else {
			type = "system";
		}
	}

	if (xlGroup) {
		xlGroup.count = xlGroup.entitiesCount;
	}
	classicGroup.count = classicGroup.entitiesCount;

	// Some groups should be compared via the direct members rather than leaf entities
	if (lib.shouldCountMembers(classicGroup)) {
		if (xlGroup) {
			xlGroup.count = xlGroup.membersCount;
		}
		classicGroup.count = classicGroup.membersCount;
	}

	var diff = null;
	if (xlGroup !== null) {
		diff = parseInt(xlGroup.count) - parseInt(classicGroup.count);
	}

	rows.push([
		xlName.limitLength(65),
		classicGroup.category ? category : classicGroup.groupType,
		classicGroup.count,
		xlGroup === null ? "-" : xlGroup.count,
		xlGroup === null ? "-" : diff,
		type
	]);
});

fn.printSortedTable(headers, rows, 0);
