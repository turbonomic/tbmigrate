// jshint -W083
/* globals title, bar, colour, warning */

// Load up the needed libraries and plugins

var lib = require("./libmigrate.js");
var cm = require("./group-creation-map.js");
var F = require("@/functions");
var P = plugin("sqlite3-plugin");


// handle command line options and arguments

usage = function() {
	println("");
	println("Usage: tbscript [@credentialKey] collect.js [options] {db_filename}");
	println("");
	println("Options:");
	println("");
	println("   -skip-passwords");
	println("   -source-db {source_db_filename}");
	println("   -map-groups");
	println("   -target-criteria {critera_json_filename}");
	println("");
	exit(2);
};

var args_ = F.extendedOptions("", "skip-passwords", "source-db:", "target-criteria:", "map-groups");
if (args_.remaining.length !== 1) {
	usage();
}

var dbFileName = args_.remaining[0];
var sourceDbFileName = args_["source-db"];
var targetCriteria = args_["target-criteria"] ? loadJson(args_["target-criteria"]) : null;


// check that the right kind of user is running me.

title("Checking user role");

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator") {
	woops("Must be run by a user with Turbonomic administrator rights");
}


// init the connection to the DB file[s]

var db = P.open(dbFileName);
var sourceDb = sourceDbFileName ? P.open(sourceDbFileName) : null;

db.exec("begin");


// ====================================================================================
// Global lists and maps
// ====================================================================================

var neededGroups = { };		// UUIDs Groups we need to migrate
var cachedGroups = { };		// UUIDs of Groups we've written to the DB
var defaultGroupUuids = { }; // UUID->Name of GROUP-aaaBybbb groups we found in the static CSV file
var groupCategories = { };	// UUID->Category mapping for groups who are direct members of defaultGroups


// ====================================================================================
// Helper functions
// ====================================================================================

// We need to get the group members for groups that...
// - are static
// - or are dynamic but use a criteria that XL doesnt support.
// - or are "system" groups that has no creator function.

function needMembers(g) {
	// of course, we always need to know the members of static groups.

	if (g.isStatic) { return true; }


	// Classic groups that have a category parent, but have no dynamic group criteria to make the
	// equivalent in XL.

	var category = groupCategories[g.uuid];
	if (category && !cm.creatorMap[category.trimPrefix("GROUP-")]) {
		return true;
	}

	// if no targetCriteria file specified on the command - pretend we dont need them since
	// we cant tell otherwise.

	if (!targetCriteria) { return false; }


	// Check to see whether or not we can support this group as dyanmic in XL.

	var rtn = false;

	(g.criteriaList || []).forEach(groupCritera => {
		var filterType = groupCritera.filterType;
		var matched = false;
		var c = ((targetCriteria[g.groupType] || {}).criteria || []).forEach(c => {
			if (c.filterType === filterType) {
				matched = true;
			}
		});
		if (!matched) {
			rtn = true;
		}
	});

	return rtn;
}


function mapGroupClass(cn) {
	return lib.nameMap.class_name_map[cn] || cn;
}


function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}


function saveMapping(tableName, saveFunc, dnMappingFunc) {
	if (sourceDb) {

		var dnToUuid = { };
		var counts = { };
		db.query(`select * from ${tableName}`).forEach(row => {
			var dn = dnMappingFunc ? dnMappingFunc("tgt", row) : row.displayName;
			if (dn) {
				counts[dn] = counts[dn] ? counts[dn] + 1 : 1;
				dnToUuid[dn] = row.uuid;
			}
		});

		var showDups = function(inst) {
			var dups = _.keys(counts).filter(dn => { return counts[dn] > 1; });
			if (dups.length> 0) {
				print("\n\n");
				warning("Warning: Duplicate entries in "+inst+":");
				dups.sort();
				dups.forEach(dn => {
					warning("    - '"+dn+"'");
					delete dnToUuid[dn];
				});
				println("\n(we recommend that you fix the issue and then re-run this step)");
			}
		};

		showDups("XL");

		var sDnToUuid = { };
		counts = { };
		sourceDb.query(`select * from ${tableName}`).forEach(row => {
			var dn = dnMappingFunc ? dnMappingFunc("src", row) : row.displayName;
			if (dn) {
				counts[dn] = counts[dn] ? counts[dn] + 1 : 1;
				sDnToUuid[row.displayName] = row.uuid;
			}
		});

		showDups("Classic");

		_.keys(dnToUuid).forEach(dn => {
			var uuid = dnToUuid[dn];
			var sUuid = sDnToUuid[dn];
			if (uuid && sUuid) {
				saveFunc(db, sUuid, uuid);
			}
		});

	}
}

// ====================================================================================

title("Collecting meta data");

lib.createMetaDataTable(db);

lib.saveMetaData(db, "startTime", "" + (new Date()));
lib.saveMetaData(db, "version", client.getVersionInfo());
lib.saveMetaData(db, "license", client.getLicenseSummary());
lib.saveMetaData(db, "isXL", client.isXL());
lib.saveMetaData(db, "isLocal", client.isLocal());
lib.saveMetaData(db, "hasSshCreds", client.hasSshCredentials());
lib.saveMetaData(db, "host", client.getHost());
lib.saveMetaData(db, "credKey", client.getCredentialKey());
lib.saveMetaData(db, "user", userInfo);
lib.saveMetaData(db, "skip-passwords", args_["skip-passwords"] ? true : false);
lib.saveMetaData(db, "settings-specs", client.getSettingsSpecs({}));

// ====================================================================================

title("Collecting target specs");

lib.dropProbeTables(db);
lib.createProbeTables(db);

client.getProbes().forEach(p => {
	print(".");
	lib.saveProbe(db, p);

});

println("");


// ====================================================================================

title("Collecting group criteria");

lib.createGroupCriteriaTable(db);

var criteria = client.getGroupBuilderUsecases();
_.keys(criteria).forEach(className => {
	criteria[className].criteria.forEach(c => {
		print(".");
		lib.saveGroupCriteria(db, className, c);
	});
});
println("");


// ====================================================================================

title("Collecting supplychain");

lib.createSupplyChainTable(db);

["hybrid", "onprem", "cloud"].forEach(env => {
	var rtn = client.tbutil("list "+env+" supplychain", true, [ "-x", "@.csv" ]);
	if (rtn.status === 0) {
		var lines = rtn.out.split("\n");
		lines.shift();
		lines.forEach(line => {
			if (line === "") { return; }
			var f = line.split(",");
			lib.saveSupplyChain(db, env, f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
		});
	}
});


// ====================================================================================

title("Collecting targets");

lib.createTargetTables(db);
var targetUuidsByScopeUuid = { };
var targetNameByUuid = { };

var targets = client.getTargets({environment_type: "HYBRID"});

var derivedTargets = { };
targets.forEach(t => {
	(t.derivedTargets || []).forEach(t => {
		derivedTargets[t.uuid] = true;
	});
});

targets.filter(t => { return !derivedTargets[t.uuid]; }).forEach(t => {
	print(".");
	lib.saveTarget(db, t);
	targetNameByUuid[t.uuid] = lib.getTargetName(t);

	(t.inputFields || []).forEach( field => {
		if (field.valueType === "GROUP_SCOPE") {
			neededGroups[field.value] = [ "targetScope", field.value];

			targetUuidsByScopeUuid[field.value] = targetUuidsByScopeUuid[field.value] || {};
			targetUuidsByScopeUuid[field.value][t.uuid] = true;

			lib.saveTargetScope(db, t.uuid, field.name, field.value, null);
		}
	});

	(t.derivedTargets || []).forEach(t => {
		derivedTargets[t.uuid] = true;
	});
});

println("");


// ====================================================================================

lib.createTargetExtraTable(db);

if ( !args_["skip-passwords"]) {
	title("Collecting augmented target info");

	if (!client.isXL() && (client.isLocal() || client.hasSshCredentials())) {
		var xmlFile = "/srv/tomcat/data/config/disc.config.topology";
		var data = client.ssh.loadXml(xmlFile);

		(data.DiscoveryManager.targets || []).forEach(t => {
			print(".");
			lib.saveTargetExtra(db, t);
		});

		var key = client.ssh.loadText("/srv/tomcat/data/output/vmt_helper_data.out");
		lib.saveMetaData(db, "vmt_helper_data", key);
	} else {
		print("No SSH credentials configured - skipping\n");
	}

	println("");
}


// ====================================================================================

title("Collecting settings policies");

lib.createSettingsPolicyTables(db);

var policyNameByUuid = { };
var policyUuidsByScopeUuid = { };

client.getSettingsPolicies().forEach(t => {
	if (t.readOnly === true) {
		return;
	}

	var include = true;
	lib.nameMap.excluded_settings_policy_name_res.forEach(re => {
		if (t.displayName.match(re)) {
			include = false;
		}
	});	

	if (include) {
		bar();
		lib.saveSettingsPolicy(db, t, true);
		policyNameByUuid[t.uuid] = t.displayName;
	}
});

saveMapping("settings_types", lib.saveSettingsMapping, null);

println("");


// ====================================================================================

title("Collecting placement policies");

lib.createPlacementPolicyTables(db);

try {
	client.getPoliciesByMarketUuid("Market").forEach(p => {
		if (p.commodityType === "DrsSegmentationCommodity") {
			return;
		}
		var include = true;
		lib.nameMap.excluded_placement_policy_name_res.forEach(re => {
			if (p.displayName.match(re)) {
				include = false;
			}
		});
		if (include) {
			bar();
			if (p.type === "BIND_TO_COMPLEMENTARY_GROUP" && p.providerGroup.displayName.hasPrefix("Complement group of -")) {
				var g = client.findByName("Group", p.providerGroup.displayName.trimPrefix("Complement group of -"));
				if (g) {
					p.baseProviderGroup = g;
				}
			}
			policyNameByUuid[p.uuid] = p.displayName;
			lib.savePlacementPolicy(db, p, true);
		}
	});
} catch (ex) { printJson(ex); }


saveMapping("placement_policies", lib.savePlacementPolicyMapping, null);

println("");


// ====================================================================================
// Pull the policy and setting scope group UUIDs out to add to our in-memory list

lib.createGroupTables(db);
lib.createEntityTable(db);
lib.createGroupMembersTable(db);

db.query(`
		select typeUuid u, groupUuid from settings_scopes
	union
		select policyUuid u, groupUuid from policy_scopes
`).forEach(row => {
	neededGroups[row.groupUuid] = [ "policyScope", row.u ];
	policyUuidsByScopeUuid[row.groupUuid] = policyUuidsByScopeUuid[row.groupUuid] || {};
	policyUuidsByScopeUuid[row.groupUuid][row.u] = true;
});


title("Collecting groups and members");

if (!client.isXL()) {
	bar();
	var groups = _.deepClone(loadCsv("defaultGroups.csv"));
	groups.shift();

	groups.forEach(row => {
		if (row[2].match(/^GROUP-[A-Za-z]*By[A-Za-z]*$/)) {
			defaultGroupUuids[row[0]] = row[2];
		}
	});
}

var myGroupsByUuid = { };

try {
	client.getMembersByGroupUuid("GROUP-MyGroups", {include_aspects: false}).forEach(g => {
		var include = true;

		lib.nameMap.excluded_user_group_name_res.forEach(re => {
			if (g.displayName.match(re)) {
				include = false;
			}
		});

		if (g.groupType === "ServiceEntity") {
			include = false;
		}

		if (include) {
			print(".");
			neededGroups[g.uuid] = [ "memberOfMyGroups" ];
			myGroupsByUuid[g.uuid] = g;
		}
	});
} catch(ex) { }


var missingScopeUuids = { };

var order = 0;
while (true) {
	var n = 0;
	order += 1;

	_.keys(neededGroups).forEach(uuid => {
		if (cachedGroups[uuid]) {
			return;
		}
		n += 1;
		bar();
		try {
			var g = myGroupsByUuid[uuid];
			if (g) {
				g.isCustom = true;
			} else {
				g = client.getGroupByUuid(uuid);
				g.isCustom = false;
			}

			// printf("[%v|%v|%v]", g.displayName, g.isStatic, g.membersCount);
			lib.saveGroup(db, g, order);
			lib.saveEntity(db, g);

			if (!client.isXL()) {
				client.getParentGroups(uuid, { }).forEach(pg => {
					if (defaultGroupUuids[pg.uuid]) {
						groupCategories[uuid] = defaultGroupUuids[pg.uuid];
					}
				});
			}

			cachedGroups[uuid] = true;

			if (needMembers(g) && g.membersCount > 0) {
				try {
					client.paginate("getMembersByGroupUuid", uuid, {}, function(m) {
						print(".");
						lib.saveGroupMembership(db, uuid, m.uuid);
						lib.saveEntity(db, m);
						if (lib.isAGroup(m)) {
							neededGroups[m.uuid] = [ "memberOfParent", uuid ];
						}
					});
				} catch (ex) {
					// If the getMembersByGroupByUuid failed and the number of entities is low enough,
					// then try an alternative approach.
					if (g.entitiesCount <= 500 && ex.message.hasSuffix("java.lang.NullPointerException")) {
						client.getEntitiesByGroupUuid(uuid).forEach(m => {
							print(".");
							lib.saveGroupMembership(db, uuid, m.uuid);
							lib.saveEntity(db, m);
							if (lib.isAGroup(m)) {
								neededGroups[m.uuid] = [ "entityOfParent", uuid ];
							}
						});
					} else {
						throw ex;
					}
				}
			}
		} catch (ex) {
			cachedGroups[uuid] = true;
			if (client.lastException().isNotFound) {
				missingScopeUuids[uuid] = true;
			}
			print("!");
		}
	});

	if (n === 0) { break; }
}


missingScopeUuids = _.keys(missingScopeUuids);
if (missingScopeUuids.length > 0) {
	var badPolicies = { };
	var badTargets = { };
	missingScopeUuids.forEach(u => {
		_.keys(targetUuidsByScopeUuid[u] || []).forEach(p => {
			badTargets[targetNameByUuid[p]] = true;
		});
		_.keys(policyUuidsByScopeUuid[u] || []).forEach(p => {
			badPolicies[policyNameByUuid[p]] = true;
		});
	});
	badPolicies = _.keys(badPolicies);
	badPolicies.sort();
	badTargets = _.keys(badTargets);
	badTargets.sort();
	var fixNeeded = false;
	if (badPolicies.length > 0) {
		println(""); println("");
		colour("hiyellow");
		println("Warning: The following policies are scoped to missing groups..");
		badPolicies.forEach(p => { printf("   - '%v'\n", p); });
		colour();
		fixNeeded = true;
	}
	if (badTargets.length > 0) {
		if (!fixNeeded) { println(""); }
		println("");
		colour("hiyellow");
		println("Warning: The following targets are scoped to missing groups..");
		badTargets.forEach(p => { printf("   - '%v'\n", p); });
		colour();
		fixNeeded = true;
	}

	if (fixNeeded) {
		println("\n(we recommend that you fix the issue(s) and then re-run this step)");
	}
}

println("");



/*


missingScopeUuids = _.keys(missingScopeUuids);
if (missingScopeUuids.length > 0) {
	var badPolicies = { };
	missingScopeUuids.forEach(u => {
		_.keys(policyUuidsByScopeUuid[u] || []).forEach(p => {
			badPolicies[policyNameByUuid[p]] = true;
		});
	});
	badPolicies = _.keys(badPolicies);
	badPolicies.sort();

	if (badPolicies.length > 0) {
		println(""); println("");
		colour("hiyellow");
		println("Warning: The following policies are scoped to missing groups..");
		badPolicies.forEach(p => { printf("   - '%v'\n", p); });
		colour();
		println("\n(we recommend that you fix the issue and then re-run this step)");
	}
}

println("");

*/

// ====================================================================================

if (sourceDb !== null) {
	var pattern = { };

	title("Collecting required entities");
	var count = 0;
	sourceDb.query(`select className, displayName from entities`).forEach(row => {

// HMM - "ResourceGroup" is a group, so is excluded from the patterns struct

		var mappedClassName = lib.nameMap.class_name_map[row.className] || row.className;

		if (!lib.isAGroup({className: mappedClassName})) {
			if (!pattern[mappedClassName]) {
				pattern[mappedClassName] = [ ];
			}
			pattern[mappedClassName].push(row.displayName.quoteRegexpMeta(false));
			count += 1;
		}
	});


	_.keys(pattern).forEach(className => {
		bar();
		var q = [ ];
		var qlen = 0;
		var qblocks = [ ];
		pattern[className].forEach(patn => {
			q.push(patn);
			qlen += patn.length + 1;
			if (qlen > 1800) {
				qblocks.push(q);
				q = [ ];
				qlen = 0;
			}
		});
		if (q.length > 0) {
			qblocks.push(q);
		}
		qblocks.forEach(qblock => {
			client.getSearchResults( {q: "^(" + qblock.join("|") + ")$", types: mapGroupClass(className)}).forEach(e => {
				print(".");
				lib.saveEntity(db, e);
			});
		});
	});


	if (args_["map-groups"]) {
		sourceDb.query("select className, displayName, uuid from groups").forEach(row => {
			bar();

			var mappedName = mapGroupName(row.displayName);
			var foundUuid = null;
			var how = "";

			db.query("select uuid from groups where displayName = ?", [mappedName]).forEach(row2 => {
				foundUuid = row2.uuid;
				how = "db";
			});

			if (foundUuid === null) {
				var found = client.findByName(row.className, mappedName);
				if (found) {
					lib.saveGroup(db, found, -1);
					foundUuid = found.uuid;
					how = "api";
				}
			}

			if (foundUuid !== null) {
				lib.saveGroupMapping(db, row.uuid, foundUuid);
			}
		});
	}

	println("");
}


// ====================================================================================

title("Collecting schedules");

lib.createScheduleTable(db);

try {
	client.getSchedules().forEach(s => {
		print(".");
		lib.saveSchedule(db, s);
	});
} catch (ex) {
	lib.saveMetaData(db, "schedule-collection-error", ex.message);
}

println("");


// ====================================================================================

title("Collecting templates");

lib.createTemplateTable(db);

var re = new RegExp(lib.nameMap.excluded_template_names_re);

client.getTemplates().forEach(t => {
	print(".");

	var include = true;
	var dn = t.displayName;
	var cn = t.className.trimSuffix("Profile");
	if (re.test(dn) || lib.nameMap.excluded_template_classes.indexOf(cn) !== -1) {
		include = false;
	}

	if (include) {
		lib.saveTemplate(db, t);
	}
});

function mapTemplateDn(srcOrTgt, row) {
	var dn = row.displayName;
	var cn = row.className.trimSuffix("Profile");

	if (srcOrTgt !== "src") {
		return row.displayName;
	}

	return (lib.nameMap.template_name_map[cn] || {})[dn] || dn;
}

saveMapping("templates", lib.saveTemplateMapping, mapTemplateDn);

println("");


// ====================================================================================

title("Creating utility views");

_.keys(groupCategories).forEach(uuid => {
	lib.saveGroupCategory(db, uuid, groupCategories[uuid]);
});

// Set the "found" flag in target_scopes table - to indicate whether the scope is really an existing UUID.
db.exec(`update target_scopes set found = (select count(*) from groups g where g.uuid = groupUuid) > 0`);

// an extended version of the "groups" table that includes the group category (eg: "GROUP-VirtualMachineByCluster")
db.exec(`
	create view groups_plus as
		select g.*, gc.category
		from groups g
		left join group_category gc on g.uuid = gc.uuid
`);

lib.saveMetaData(db, "endTime", "" + (new Date()));

db.exec("end");

db.close();
