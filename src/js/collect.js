// jshint -W083, -W061
/* globals title, bar, colour, warning, error */

// Load up the needed libraries and plugins

var lib = require("./libmigrate.js");
var cm = require("./group-creation-map.js");
cm.set("lib", lib);

var F = require("@/functions");
var P = plugin("sqlite3-plugin");
var S = plugin("sys-plugin");

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
	println("   -check-discovery");
	println("");
	exit(2);
};

var args_ = F.extendedOptions("", "skip-passwords", "source-db:", "target-criteria:", "map-groups", "check-discovery");
if (args_.remaining.length !== 1) {
	usage();
}

var dbFileName = args_.remaining[0];
var sourceDbFileName = args_["source-db"];
var targetCriteria = args_["target-criteria"] ? loadJson(args_["target-criteria"]) : null;
var checkDiscoveryState = args_["check-discovery"];
var allGroupsCollected = false;


// check that the right kind of user is running me.

title("Checking user role");

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator" && userInfo.roleName.toLowerCase() !== "site_admin") {
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
var nameMap = { };

var myGroupsByUuid = { };


// ====================================================================================
// Helper functions
// ====================================================================================

// We need to get the group members for groups that...
// - are static
// - or are dynamic but use a criteria that XL doesnt support.
// - or are "system" groups that has no creator function.

function needMembers(g) {
	var rtn = false;

	// of course, we always need to know the members of static groups.

	if (g.isStatic) {
		return true;
	}

	// Dynamic custom group with no criteria

	if (g.isCustom && !g.isStatic && (!g.criteriaList || g.criteriaList.length === 0)) {
		return true;
	}

	// Classic groups that have a category parent, but have no dynamic group criteria to make the
	// equivalent in XL.

	var category = groupCategories[g.uuid];
	if (category) {
		var creator = cm.creatorMap[category.trimPrefix("GROUP-")];
		if (creator === null) { return true; }
		if (creator !== undefined && creator(g) === null) { return true; }
	}

	// Check to see whether or not we can support this group as dyanmic in XL (if a target criteria
	// file has been specified on the command line).

	if (targetCriteria) {
		(g.criteriaList || []).forEach(groupCritera => {
			var filterType = groupCritera.filterType;
			var matched = false;
			var c = ((targetCriteria[g.groupType] || {}).criteria || []).forEach(cr => {
				if (cr.filterType === filterType) {
					matched = true;
				}
			});
			if (!matched) {
				rtn = true;
			}
		});
	}

	// If we have to salt the name with the target to make it unique, then we cant use dynamic
	// filters (there is no entity-by-target filter).

	if (nameMap[g.uuid]) {
		return true;
	}

	// If this is a default group and the group-creation-map file's "defaultGroupsByName" section has a "null"
	// value, then we'll be creating this as a static group - so we need to know it's members in classic.

	if (rtn === false) {
		var iname = defaultGroupUuids[g.uuid];
		if (iname) {
			var fn = cm.defaultGroupsByName[iname.trimPrefix("GROUP-")];
			if (fn === null) {
				rtn = true;
			}
		}
	}

	return rtn;
}


function isDefaultGroupThatThrowsError(uuid) {
	var iname = defaultGroupUuids[uuid];
	if (iname === undefined) {
		return false;
	}
	var fn = cm.defaultGroupsByName[iname.trimPrefix("GROUP-")];
	if (fn === undefined || fn === null) {
		return false;
	}
	try {
		fn({json:"{}"});
		return false;
	} catch (ex) {
		return true;
	}
}


function mapGroupClass(cn) {
	return lib.nameMap.class_name_map[cn] || cn;
}


function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}


function saveGroup(db, g, order, reason) {
	lib.saveGroup(db, g, order, reason);
	lib.saveEntity(db, g);

	if (!client.isXL()) {
		var path0 = client.getParentGroups(g.uuid, { path: true });
		var path = path0.filter(g2 => { return g2.uuid !== g.uuid; });

		if (path.length > 0 && path.length === (path0.length - 1)) {
			var catUuid = path[path.length - 1].uuid;
			if (defaultGroupUuids[catUuid]) {
				groupCategories[g.uuid] = defaultGroupUuids[catUuid];
			}
		}
	}
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


function getFilterCategory(entType, filterType) {
	if (!entType || !filterType) {
		return "";
	}

	var rtnRow = null;

	db.query("select * from group_criteria where className = ? and filterType = ?", [entType, filterType]).forEach(row => {
		rtnRow = row;
	});

	if (rtnRow === null) {
		return "";
	}

	if (rtnRow.filterCriteria === "entity" && rtnRow.elements.hasSuffix(":uuid")) {
		rtnRow.filterCriteria = "uuid";
	}

	return rtnRow.filterCriteria;
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


if (checkDiscoveryState) {
	var n = 0;
	db.query(`select sum(count) n from supplychain where envtype = "hybrid"`).forEach(row => {
		if (row.n !== undefined) {
			n = parseInt(row.n);
		}
	});

	if (n === 0) {
		error("The supply-chain is empty - discovery is not complete.");
		println("(please wait a try again later)");
		exit(2);
	}
}


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

targets.filter(t => { return derivedTargets[t.uuid]; }).forEach(t => {
	lib.saveDerivedTarget(db, t);
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
	var warnings = { };
	var errors = { };

	if (!client.isXL() && (client.isLocal() || client.hasSshCredentials())) {
		var xmlFile = "/srv/tomcat/data/config/disc.config.topology";
		var data = client.ssh.loadXml(xmlFile);

		if (!_.isArray(data.DiscoveryManager.targets)) {
			data.DiscoveryManager.targets = [ data.DiscoveryManager.targets ];
		}

		(data.DiscoveryManager.targets || []).forEach(t => {
			print(".");
			lib.saveTargetExtra(db, t);
		});

		var dataFile = "/srv/tomcat/data/output/vmt_helper_data.out";
		var key64;

		if (getenv("force_remote_classic") === null && client.isLocal() && S.exists(dataFile)) {
			key64 = S.readFile(dataFile, "base64");
		} else {
			var data = client.ssh.loadText("base64 "+dataFile+" |");
			key64 = data.join("");
		}

		var cookie = "$_1_$VMT$$";
		if (key64.decodeBase64().hasPrefix(cookie)) {
			lib.saveMetaData(db, "vmt_helper_data", key64.decodeBase64());
			lib.saveMetaData(db, "vmt_helper_key_format", "raw");
		} else {
			var xlVersion = newClient("@xl").getVersionInfo();
			var m = xlVersion.version.match(new RegExp('^\\d+\\.\\d+\\.\\d'));
			if (m) {
				var v = m[0].split(".");
				v = parseInt(v[0]) * 10000 + parseInt(v[1]) * 100 + parseInt(v[2]);
				if (v < 72209) {
					println("\n");
					error("Error: Target password migration from this classic instance requires XL 8.0.0 or later");
					println("");
					println("Please upgrade your XL instance to 8.0.0 or later and then retry.");
					println("");
					println("Or (if you prefer): Re-start from step 1 and answer 'n' to the question about target password migration.");
					println("                    You will need to enter the passwords for each target by hand in this case.");
					println("");
					exit(2);
				}
			} else {
				warnings["Warning: Old-style VMT helper key detected. Migration of target passwords likely to fail"] = true;
			}
			lib.saveMetaData(db, "vmt_helper_data", key64);
			lib.saveMetaData(db, "vmt_helper_key_format", "base64");
		}
	} else {
		print("No SSH credentials configured - skipping\n");
	}

	println("");

	warnings = _.keys(warnings);
	warnings.sort();
	if (warnings.length > 0) { println(""); }
	warnings.forEach(w => {
		warning(w);
	});
	if (warnings.length > 0) { println(""); }
}


// ====================================================================================

if (checkDiscoveryState) {

	var quotedNames = _.keys(lib.nameMap.target_types_that_always_create_groups).map(t => { return '"' + t + '"'; });
	var groupPatterns = { };
	var n = 0;
	db.query("select type, count(*) n from targets where type in ("+quotedNames.join(",")+") group by type").forEach(row => {
		n += parseInt(row.n);
		(lib.nameMap.target_types_that_always_create_groups[row.type] || []).forEach(patn => {
			groupPatterns["(" + patn + ")"] = true;
		});
	});

	if (n > 0) {
		title("Checking expected discovered groups");

		lib.createGroupTables(db);

		var opts = { types: "Group", environment_type: "HYBRID", q: _.keys(groupPatterns).join("|") };
		client.paginate("getSearchResults", opts, g => {
			print(".");
//			println(g.displayName);
			lib.saveXlGroup(db, g);
		});
		println("");
		allGroupsCollected = true;

		title("Checking target discovery state");

		var groupsPerTarget = { };
		db.query(`select sourceUuid, count(*) n from xlGroups group by sourceUuid`).forEach(row => {
			groupsPerTarget[row.sourceUuid] = parseInt(row.n);
		});
		var warnings = 0;
		db.query(`select uuid, json from targets where type in (`+quotedNames.join(",")+`)`).forEach(row => {
			var t = JSON.parse(row.json);
			if (t.status === "Validated") {
				var n = groupsPerTarget[t.uuid];
				if (n === 0 || n === undefined) {
					var name = lib.getTargetName(t);
					warning("Warning: target '"+name+"' discovery appears incomplete");
					warnings += 1;
				}
			}
		});
		if (warnings > 0) {
			println("");
			println("Please wait for discovery to complete, then try this step again");
			while (true) {
				println("");
				println("If you wish to disregard this warning, please indicate that you understand that this");
				println("increases the chances that the migration will be incomplete by typing 'I understand'");
				println("below (otherwise just press <return>).");
				var ok = readLine("==> ");
				if (ok.toLowerCase().trimSpace() === "i understand") {
					break;
				}
				if (ok === "") {
					exit(2);
				}
			}
		}
	}
}

// ====================================================================================

title("Collecting settings policies");

lib.createSettingsPolicyTables(db);

var policyNameByUuid = { };
var policyUuidsByScopeUuid = { };
var policiesWithBrokenScope = [ ];

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
		var ok = true;
		(t.scopes || []).forEach(s => {
			if (s.displayName === "VMT_SETTINGS_POLICY_FAKE_GROUP") {
				ok = false;
			}
		});
		if (!ok) {
			policiesWithBrokenScope.push(t);
		}
	}
});

saveMapping("settings_types", lib.saveSettingsMapping, null);

println("");

policiesWithBrokenScope.sort((a, b) => {
	var aa = a.displayName.toLowerCase();
	var bb = b.displayName.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});

// ====================================================================================

title("Collecting placement policies");

lib.createPlacementPolicyTables(db);

try {
	client.getPoliciesByMarketUuid("Market").forEach(p => {
		if (p.commodityType === "DrsSegmentationCommodity") {
			// these should be automatically discovered, so we skip them
			return;
		}

		var include = true;

		lib.nameMap.excluded_placement_policy_name_res.forEach(re => {
			if ((p.displayName || "").match(re) ||( p.name || "").match(re)) {
				include = false;
			}
		});

		if (((p.providerGroup || {}).displayName || "").match(lib.nameMap.excluded_group_names_re)) {
			include = false;
		}

		if (((p.consumerGroup || {}).displayName || "").match(lib.nameMap.excluded_group_names_re)) {
			include = false;
		}

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
} catch (ex) {
	error("Error: unable to collect placement policies (API reported a failure)");
	println("Please confirm that you can see the expected placement policies in the UI and");
	println("fix them and re-run this script before attempting migration of policies.");
}


saveMapping("placement_policies", lib.savePlacementPolicyMapping, null);

println("");


// ====================================================================================

title("Collecting local and LDAP users");
lib.createUserTables(db);

var adList = client.getActiveDirectories();
lib.saveMetaData(db, "ldap", adList);


client.getUsers().forEach(u => {
	print(".");
	lib.saveUser(db, u);
	(u.scope || []).forEach(s => {
		neededGroups[s.uuid] = [ "ADUserScope", u.uuid ];
	});
});

println("");


title("Collecting LDAP user groups");

client.getActiveDirectoryGroups().forEach(g => {
	print(".");
	lib.saveUserGroup(db, g);
	(g.scope || []).forEach(s => {
		neededGroups[s.uuid] = [ "ADGroupScope", g.uuid ];
	});
});
println("");

// ====================================================================================
// Pull the policy and setting scope group UUIDs out to add to our in-memory list

if (!allGroupsCollected) {
	lib.createGroupTables(db);
}
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


title("Collecting group members");

if (!client.isXL()) {
	bar();
	var groups = _.deepClone(loadCsv("defaultGroups.csv"));
	groups.shift();

	groups.forEach(row => {
//		if (row[2].match(/^GROUP-[A-Za-z]*By[A-Za-z]*$/) || cm.defaultGroupsByName[row[2].trimPrefix("GROUP-")] !== undefined) {
		if (row[2].match(/^GROUP-[A-Za-z]*$/) || cm.defaultGroupsByName[row[2].trimPrefix("GROUP-")] !== undefined) {
			defaultGroupUuids[row[0]] = row[2];
		}
	});
}

try {
	client.getMembersByGroupUuid("GROUP-MyGroups", {include_aspects: false}).forEach(g => {
		var include = true;

		lib.nameMap.excluded_group_names_res.forEach(re => {
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

function getGroupByUuid(uuid) {
	if (allGroupsCollected) {
		var rtn = null;
		db.query("select json from xlGroups where uuid = ?", [uuid]).forEach(row => {
			rtn = JSON.parse(row.json);
		});
		return rtn;
	} else {
		return client.getGroupByUuid(uuid);
	}
}

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
		var g = myGroupsByUuid[uuid];
		try {
			if (g) {
				g.isCustom = true;
			} else {
				g = getGroupByUuid(uuid);
				g.isCustom = false;
			}

			saveGroup(db, g, order, neededGroups[uuid]);

			cachedGroups[uuid] = true;
			if (needMembers(g) && g.membersCount > 0 && !isDefaultGroupThatThrowsError(uuid)) {
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
			if (getenv("show_group_errors")) { // -- dev/debug aid
				println("");
				ex.g_uuid = uuid;
				printJson(ex);
			}
		}
	});

	if (n === 0) { break; }
}

if (client.isXL()) {
	hash();
	var opts = { types: "Group,Cluster" };
	client.paginate("getSearchResults", opts, g => {
		var n = parseInt(db.query("select count(*) n from groups where uuid = ?", [g.uuid])[0].n);
		if (n === 0) {
			print(".");
			saveGroup(db, g, -1, [""]);
		}
	});

	hash();
	// Some entities have different naming conventions in classic and XL so we need them all :)
	opts = { types: "ApplicationComponent,DatabaseServer" };
	var n = 0;
	client.paginate("getSearchResults", opts, e => {
		print(".");
		lib.saveEntity(db, e);
		n += 1;
	});
	// printf("<%d>\n", n);
	println("");
}

// add bad policies detected earlier to the list we're going to report on
policiesWithBrokenScope.forEach(p => {
	missingScopeUuids[p.uuid] = true;
});

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


// ====================================================================================

title("Collecting dynamic group filter entities");

var badFilters = { };
db.query("select json from groups where isStatic = 0").forEach(row => {
	var g = JSON.parse(row.json);
	(g.criteriaList || []).forEach(c => {
		var fType = getFilterCategory(g.groupType, c.filterType);
		if (fType === "" && c.filterType !== "") {
			badFilters[g.displayName] = true;
		} else if (c.expType === "EQ" && (c.expVal.hasPrefix("|") || c.expVal.hasSuffix("|"))) {
			badFilters[g.displayName] = true;
		}
		if (fType === "uuid") {
			var uuids = c.expVal.split("|");
			uuids.forEach(uuid => {
				var n = 0;
				db.query("select count(*) n from entities where uuid = ?", [uuid]).forEach(row2 => {
					n = parseInt(row2.n);
				});
				if (n > 0) {
					return;
				}
				try {
					var obj = client.getObjectByUuid(uuid);
					lib.saveEntity(db, obj);
					print(".");
				} catch (ex) {
					print("!");
					if (getenv("show_group_errors")) { // -- dev/debug aid
						println("");
						ex.g_uuid = uuid;
						printJson(ex);
					}
				}
			});
		}
	});
});

println("");

badFilters = _.keys(badFilters);

if (badFilters.length > 0) {
	warning("Warning: some dynamic groups employ redundant or broken filters - review, fix and then re-run this step.");
	badFilters.sort();
	badFilters.forEach(f => {
		warning(sprintf("    - \"%s\"", f));
	});
	println();
}


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
			var opts = {q: "^(" + qblock.join("|") + ")$", types: mapGroupClass(className)};
			client.paginate("getSearchResults", opts, e => {
				print(".");
				lib.saveEntity(db, e);
			});
		});
	});


	// Handle StorageController entities with different names (eg: Nutanix ones)
	var classicScs = { };
	sourceDb.query('select uuid, json from entities where className = "StorageController"').forEach(row => {
		classicScs[row.uuid] = JSON.parse(row.json);
	});
	var xlScs = { };
	db.query('select uuid, json from entities where className = "StorageController"').forEach(row => {
		xlScs[row.uuid] = JSON.parse(row.json);
	});
	if (_.keys(classicScs).length !== _.keys(xlScs).length) {
		bar();
		// mismatch - so get all of them from XL. A length mismatch is enough to check for because we've
		// already tried to find the XL ones by their names in classic. If all matched then the length
		// of the two lists would be the same.
		var opts = { types: "StorageController" };
		client.paginate("getSearchResults", opts, sc => {
			print(".");
			lib.saveEntity(db, sc);
		});
	}


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
					saveGroup(db, found, -1, ["in classic"]);
					foundUuid = found.uuid;
					how = "api";
				}
			}

			if (foundUuid !== null) {
				lib.saveGroupMapping(db, row.uuid, foundUuid, 0);
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
		select
			g.*,
			gc.category,
			(case when t.name is null then g.displayName else (g.displayName || " (" || lower(t.name) || ")") end) nameWithTarget
		from groups g
		left join group_category gc on g.uuid = gc.uuid
		left join targets t on t.uuid = g.discoveredBy

`);

// ====================================================================================

if (!client.isXL()) {
	title("Get mapped group members");

	nameMap = lib.getGroupNameMap(db);

	_.keys(nameMap).forEach(uuid => {
		bar();
		client.paginate("getMembersByGroupUuid", uuid, {}, m => {
			print(".");
			lib.saveGroupMembership(db, uuid, m.uuid);
			lib.saveEntity(db, m);
		});
	});

	println("");
}

// ====================================================================================

title("Cleanup");

// Delete groups consisting entirely of GuestLoad Application entities

var sql = `
	select * from (
		select g1.uuid,
			g1.displayName,
			g1.category,
			(
				select count(*)
				from group_members g2
				where g2.groupUuid = g1.uuid
			) n1,
			(
				select count(*)
				from group_members g3, entities e
				where g3.groupUuid = g1.uuid
				and e.uuid = g3.entityUuid
				and e.displayName like "GuestLoad%"
				and e.className = "Application"
			) n2
			from groups_plus g1
	) where n2 > 0 and n2 = n1
`;

var uuids = { };
db.query(sql).forEach(row => {
	uuids[row.uuid] = true;
});

_.keys(uuids).forEach(uuid => {
	db.exec(`delete from groups where uuid = ?`, [uuid]);
});


lib.saveMetaData(db, "endTime", "" + (new Date()));

db.exec("end");

db.close();
