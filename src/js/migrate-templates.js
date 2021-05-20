// Usage is: tbscript @xl migrate-templates.js {classicDbFile} {xlDbFile}

/* jshint -W119 */
/* globals title, warning, success, error */

if (args.length !== 2) {
	println("Usage is:");
	println("");
	println("   ../bin/tbscript @xl migrate-templates.js {classic-db-file} {xl-db-file}");
	println("");
	exit(2);
}

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args[0]+"?mode=rw");
var xlDb = P.open("file:"+args[1]+"?mode=rw");
var lib = require("./libmigrate");

// The file read in here needs to be re-created by running dev-tools/get-template-specs.sh when new versions
// of Turbonomic are released.
var templateSpecs = loadJson("./template-specs.json");

var nameMap = lib.nameMap;

lib.disableAllActions(client, xlDb);


// get the version of this XL
var xlVersion = null;
xlDb.query(`select json from metadata where name = "version"`).forEach(row => {
	xlVersion = JSON.parse(row.json).branch;
});


// Get, and sort, all the versions listed in the templateSpecs file
var versions = _.keys(templateSpecs.ver2sum);
versions.push("999.999.999");

function sortableVersion(ver) {
	var f = ver.split(".");
	return sprintf("%03d%03d%03d", f[0], f[1], f[2]);
}
versions.sort((a, b) => {
	var aa = sortableVersion(a);
	var bb = sortableVersion(b);
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});


// Identity the templateSpec version that best fits THIS XL. We do this by chosing the
// known version just earlier than the target one.
var bestFitVersion = null;
if (versions.contains(xlVersion)) {
	bestFitVersion = xlVersion;
} else {
	for (var i=1; i<versions.length; i+=1) {
		if (sortableVersion(versions[i]) < sortableVersion(xlVersion) && sortableVersion(versions[i+1]) > sortableVersion(xlVersion)) {
			bestFitVersion = versions[i];
			break;
		}
	}
}

var sum = templateSpecs.ver2sum[bestFitVersion];
var spec = templateSpecs.sum2spec[sum];


// Given a template object from the CLASSIC instance, massage it to be compatible with XL.

function cleanupTemplate(t, verbose) {
	var dn = t.displayName;
	var cn = t.className.trimSuffix("Profile");

	// Map the template displayName using the `template_name_map` field of the configuration file.

	if (nameMap.template_name_map[cn]) {
		var mapped = nameMap.template_name_map[cn][dn];
		if (mapped) {
			dn = mapped;
		}
	}

	// Delete fields that we should not copy over.

	delete t.uuid;
	delete t.links;

	// map the classname in the template DTO to that used in the spec file
	var typeMap = {
		"HCIPhysicalMachine": "HCI_PHYSICAL_MACHINE",
		"PhysicalMachine": "PHYSICAL_MACHINE",
		"VirtualMachine": "VIRTUAL_MACHINE",
		"Storage": "STORAGE"
	};

	var x = spec[typeMap[cn]];

	// Delete any template resource blocks that XL doesnt handle. Use the `excluded_template_resources`
	// substructure of the configuration file for this.

	_.keys(t).filter(k => ( k.hasSuffix("Resources") )).forEach(r => {
		var supported = x[r.trimSuffix("Resources")];
		t[r].forEach(rr => {
			var filteredStats = (rr.stats || []).filter(s => ( supported.contains(s.name) ));
			var removedStats = (rr.stats || []).filter(s => ( !supported.contains(s.name) ));
			rr.stats = filteredStats;
			if (removedStats.length > 0 && verbose) {
				var r = removedStats.map(s => ( s.name ));
				r.sort();
				warning(sprintf("    Warning: stripped unsupported field(s): %s", _.uniq(r).join(", ")));
			}
		});
	});

//	(_.keys(nameMap.excluded_template_resources || {})).forEach(resGroup => {
//		if (t[resGroup] && t[resGroup].length === 1 && t[resGroup][0].stats) {
//			var statList = { };
//			var filtered = t[resGroup][0].stats.filter(r => {
//				var rtn = nameMap.excluded_template_resources[resGroup].indexOf(r.name) === -1;
//				statList[resGroup+"::"+r.name] = rtn;
//				return rtn;
//			});
//			var removed = [ ];
//			_.keys(statList).forEach(k => {
//				if (!statList[k]) {
//					removed.push(k);
//				}
//			});
//			if (removed.length > 0 && verbose) {
//				removed.sort();
//				warning(sprintf("    Warning: stripped unsupported field(s): %v", removed.join(", ")));
//			}
//			t[resGroup][0].stats = filtered;
//		}
//	});

	t.displayName = dn;
}


// Copy the template from classic to XL. The template is identified by it's UUID in the
// classic instance.

function copyTemplate(uuid, displayName, xlUuid) {
	var numRows = 0;
	var className = "";
	var json = "";

	classicDb.query("select className, displayName, json from templates where uuid = ?", [ uuid ]).forEach(row => {
		numRows += 1;
		className = row.className;
		json = row.json;
	});

	if (numRows !== 1) {
		eprintf("    UNEXPECTED: numRows for template with %v = %v\n", uuid, numRows);
		return;
	}

	var t = JSON.parse(json);
	t.displayName = displayName;

	cleanupTemplate(t, true);

	var t2 = null;

	try {
		if (xlUuid) {
			t2 = client.editTemplate(xlUuid, t);
			success("    Updated existing template");
		} else {
			t2 = client.addTemplate(t);
			success("    Created new template");
		}
		lib.saveTemplate(xlDb, t2);
		lib.saveTemplateMapping(xlDb, uuid, t2.uuid);
	} catch (ex) {
		error("    Error: "+ex.message);
	}
}


// Read the list of classic instance templates, applying the configured REGEXP filter to
// the list as we go.

var excludedClasses = nameMap.excluded_template_classes.map(c => { return '"' + c + 'Profile"'; }).join(", ");

var getTemplatesSql = `
	select className, displayName, count(*) n, uuid, json
	from templates
	where discovered = 0
	and displayName not regexp ?
	and className not in (${excludedClasses})
	group by className, displayName
`;

var templates = [ ];
var countByXlName = { };

classicDb.query(getTemplatesSql, [nameMap.excluded_template_names_re]).forEach(row => {
	templates.push([row.className, row.displayName, parseInt(row.n), row.uuid, row.json]);

	var dn = row.displayName;
	var cn = row.className.trimSuffix("Profile");

	dn = (nameMap.template_name_map[cn] || {})[dn] || dn;

	countByXlName[dn] = countByXlName[dn] || 0;
	countByXlName[dn] += parseInt(row.n);
});


// Iterate over the list of discovered classic templates and copy them over, if....
// - The tempate does not already exist in the XL instance.
// - And: there is only one copy in the classic (the uniqueness key is className and displayName).

templates.forEach(t => {
	var className = t[0];
	var displayName = t[1];
	var n = t[2];
	var uuid = t[3];
	var json = t[4];
	println("");

	title(sprintf("Copying %s template '%s'", className.trimSuffix("Profile"), displayName));

	var t0 = JSON.parse(json);

	cleanupTemplate(t0, false);

	var count = countByXlName[t0.displayName];
	if (count > 1) {
		error("    Error: unresolvable template name duplication - skipped");
		return;
	}

	var copied = false;

	var name = t0.displayName;

	var xlUuid = null;

	xlDb.query("select uuid from templates where displayName = ?", [ name ]).forEach(row => {
		xlUuid = row.uuid;
	});

	copyTemplate(uuid, name, xlUuid);

});

lib.saveMetaData(xlDb, "migrate_templates_end_time", "" + (new Date()));
