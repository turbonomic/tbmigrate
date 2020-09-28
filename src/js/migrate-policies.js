/* global colour, title, subtitle, warning, success, note, error */

var F = require("@/functions");
var lib = require("./libmigrate.js");

usage = function() {
	println("");
	println("Usage is:");
	println("");
	println("  tbscript {xl-credentials} migrate-policies.js [options] {classic-db-file} {xl-db-file}");
	println("");
	println("  where options is any combination of:");
	println("     -copy-all : copy all values from default policies (even those that havent changed in classic)");
	println("");
	exit(2);
};

var args_ = F.extendedOptions("", "copy-all");
if (args_.remaining.length !== 2) {
	usage();
}

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args_.remaining[0]+"?mode=rw");
var xlDb = P.open("file:"+args_.remaining[1]+"?mode=rw");
var nameMap = lib.nameMap;

var policyMap_csv = _.deepClone(loadCsv("policy-mapping.csv"));
// Strip the two head lines.
policyMap_csv.shift();
policyMap_csv.shift();

var policyMap = { };
policyMap_csv.forEach(row => {
	var r5 = row[5].trimSpace();
	if (r5 !== "" && !r5.hasPrefix("#")) {
		var key = row[0]+"|"+row[1]+"|"+row[3];
		policyMap[key] = {
			type: row[0],
			manager: r5,
			setting: row[7]
		};
	}
});

lib.nameMap.class_name_reverse_map = { };
_.keys(lib.nameMap.class_name_map).forEach(t => {
	var mapped = lib.nameMap.class_name_map[t];
	lib.nameMap.class_name_reverse_map[mapped] = lib.nameMap.class_name_reverse_map[mapped] || [];
	lib.nameMap.class_name_reverse_map[mapped].push(t);
});


title("Checking user role");

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator" && userInfo.roleName.toLowerCase() !== "site_admin") {
	woops("Must be run by a user with Turbonomic administrator rights");
}


lib.disableAllActions(client, xlDb);


function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}

// has the setting been changed from it's default value in classic?

function isChanged(s) {
	switch (s.valueType) {
		case "NUMERIC": return parseFloat(s.value) !== parseFloat(s.defaultValue);
		case "BOOLEAN": return s.value !== s.defaultValue;
		case "STRING": return s.value !== s.defaultValue;
		case "LIST": return s.value !== (s.defaultValue || "");
		default:
			printf("*** Bad type: %s\n", s.valueType);
			return false;
	}
}


function convertTypeListToMap(list) {
	var rtn = { };
	list.forEach(row => {
		var type = JSON.parse(row.json);
		if (type.default) {
			type.uuid = row.uuid;
			rtn[type.entityType] = type;
		}
	});
	return rtn;
}


function classicToXlType(typeName) {
	var t = typeName.split(" ");
	if (t.length < 1) {
		return typeName;
	}
	var mapped = lib.nameMap.class_name_map[t[0]];
	if (mapped) {
		t[0] = mapped;
	}
	return t.join(" ");
}


function getValue(typeMap, type, manager, name) {
	try {
		return typeMap[type].
			settingsManagers.
			filter(m => { return m.uuid === manager; })[0].
			settings.
			filter(s => { return s.uuid === name; })[0].
			value;
	} catch (ex) {
		return undefined;
	}
}


var xlTypes = convertTypeListToMap(xlDb.query("select * from settings_types where isDefault order by displayName"));
var classicTypes = convertTypeListToMap(classicDb.query("select * from settings_types where isDefault order by displayName"));

//=============================================================================================
// Default policies

function processDefaultPolicies() {
	title("Processing default policies");

	var changes = { };

	// set a default setting value using the classic manager and setting names.
	// Return false if no mapping is known.
	var setDefault = function(type, managerUuid, settingUuid, value) {
		var key = type + "|" + managerUuid + "|" + settingUuid;
		var mapped = policyMap[key];

		if (!mapped || !mapped.manager || !mapped.setting || !mapped.type) {
			return false;
		}

		var xlType = classicToXlType(type);

		mapped.setting.split(/\s*,\s*/).forEach(setting => {
			var current = getValue(xlTypes, xlType, mapped.manager, setting);
			if (current === undefined) {
				return false;
			}
			if (value === current) { return true; }

			changes[xlType] = changes[xlType] || {};
			changes[xlType][mapped.manager] = changes[xlType][mapped.manager] || {};
			changes[xlType][mapped.manager][setting] = value;
		});

		return true;
	};


	println("");
	subtitle("Checking classic vs XL default setting class equivalence");

	_.keys(classicTypes).sort().forEach(type => {
		var xlType = classicToXlType(type);
		if (!xlTypes[xlType]) {
			warning("    Warning: Policy '"+type+" defaults' exists in classic but has no equivalent in XL - not migrated");
		}
	});

/*
	println("");
	subtitle("Checking XL vs classic default setting class equivalence");

	_.keys(xlTypes).sort().forEach(type => {
		var classicType = xlToClassicType(type);
		if (!classicTypes[classicType]) {
			warning("    Warning: Policy '"+type+" defaults' exists in XL but has no equivalent in classic - nothing to migrate");
		}
	});
*/

	println("");
	subtitle("Checking individual default setting equivalence");
		
	_.keys(classicTypes).forEach(type => {
		classicTypes[type].settingsManagers.forEach(sm => {
			if (sm.uuid === "actionscriptmanager") { return; }
			sm.settings.forEach(s => {
				if (args_["copy-all"] || isChanged(s)) {
					if (!setDefault(type, sm.uuid, s.uuid, s.value)) {
						warning(sprintf("    Warning: No setting for '%v defaults::%v::%v' (%v)", type, sm.displayName, s.displayName, s.value));
					}
				}
			});
		});
	});

	println("");
	subtitle("Applying changes to default policies");

	var count = 0;

	_.keys(xlTypes).forEach(type => {
		if (!changes[type]) { return; }

		println("");
		colour("cyan", "bold"); println("    "+type+" defaults"); colour();

		xlTypes[type].settingsManagers.forEach(sm => {
			if (!changes[type][sm.uuid]) { return; }
			println("      "+sm.displayName);

			sm.settings.forEach(s => {
				if (changes[type][sm.uuid][s.uuid] !== undefined) {
					s.value = changes[type][sm.uuid][s.uuid];
					success(sprintf("        %v = %v", s.displayName, s.value));
					if (s.valueType === "NUMERIC") {
						var value = parseFloat(s.value);
						if (value > s.max) {
							warning(sprintf("        Warning: classic's value is larger than XL's allowed maximum - reducing to %v", s.max));
							s.value = "" + s.max;
						} else if (value < s.min) {
							warning(sprintf("        Warning: classic's value is less than XL's allowed minimum - raising to %v", s.min));
							s.value = "" + s.min;
						}
					}
					count += 1;
				}
			});
		});

		var dto = _.deepClone(xlTypes[type]);
		try {
			var newSetting = client.editSettingsPolicy(dto.uuid, {}, dto);
			lib.saveSettingsPolicy(xlDb, newSetting, false);
		} catch (ex) {
			error("Error: "+ex.message);
		}
	});
}


//=============================================================================================
// Scoped policies

function findOrCreateSchedule(sh) {
	var newSh = null;

	xlDb.query("select json from schedules where displayName = ?", [sh.displayName]).forEach(row => {
		newSh = JSON.parse(row.json);
	});

	if (newSh === null) {
		newSh = client.addSchedule(sh);
		lib.saveSchedule(xlDb, newSh, false);
	}

	return newSh;
}


function getManagerDisplayName(type, uuid) {
	var rtn = null;

	xlTypes[type].settingsManagers.forEach(sm => {
		if (sm.uuid === uuid) {
			rtn = sm.displayName;
		}
	});

	return rtn;
}

function getSettingDisplayName(type, smUuid, uuid) {
	var rtn = null;

	xlTypes[type].settingsManagers.forEach(sm => {
		if (sm.uuid === smUuid) {
			sm.settings.forEach(s => {
				if (s.uuid === uuid) {
					rtn = s.displayName;
				}
			});
		}
	});

	return rtn;
}


function mapScope(scope) {
	var rtn = { };

	var category = null;
	classicDb.query(`select category from group_category where uuid = ?`, [scope.uuid]).forEach(row => {
		category = row.category.trimPrefix("GROUP-");
	});

	var sql = `select * from group_uuid_mapping m, groups g where classicUuid = ? and m.xlUuid = g.uuid`;
	var numMappings = 0;
	xlDb.query(sql, [scope.uuid]).forEach(row => {
		rtn.uuid = row.uuid;
		rtn.displayName = row.displayName;
		rtn.groupType = row.groupType;
//		rtn.isStatic = parseInt(row.isStatic) ? "true" : "false";
		numMappings += 1;
	});

	if (numMappings === 0) {
		if (scope.displayName === undefined) {
			error(sprintf("      Error: Policy scoped to a non-existent group (uuid: %s)", scope.uuid));
		} else {
			error(sprintf("      Error: Cant find scope group '%s' in XL", mapGroupName(scope.displayName)));
		}
		scope.$NOT_FOUND_IN_XL = true;
		rtn = null;
	}

	if (numMappings > 1) {
		error(sprintf("      Error: Multiple groups called '%s' found", mapGroupName(scope.displayName)));
		scope.$NOT_FOUND_IN_XL = true;
		rtn = null;
	}

	// Nasty special-case hack
	if (rtn && category === "PhysicalMachineByChassisOrDataCenter" && rtn.displayName.hasPrefix("PMs_")) {
		var dcName = rtn.displayName.trimPrefix("PMs_");
		var rtn2 = lib.readEntity(xlDb, "DataCenter", dcName);
		if (rtn2 === null) {
			rtn2 = client.findInstance("DataCenter", dcName);
			if (rtn2 === null) {
				error(sprintf("      Error: Cant find DC '%s' in XL", mapGroupName(dcName)));
				scope.$NOT_FOUND_IN_XL = true;
				rtn = null;
			} else {
				lib.saveEntity(xlDb, rtn2);
				rtn = {
					uuid: rtn2.uuid,
					displayName: rtn2.displayName,
					groupType: rtn2.groupType
				};
			}
		} else {
			rtn = {
				uuid: rtn2.uuid,
				displayName: rtn2.displayName,
				groupType: rtn2.groupType
			};
		}
	}

	return rtn;
}


function cleanSchedule(policy) {
	delete policy.schedule.nextOccurrence;
	delete policy.schedule.nextOccurrenceTimestamp;
	delete policy.schedule.uuid;

	var cleanTime = function(key) {
		if (policy.schedule[key]) {
			var re = /^(\d\d\d\d-\d\d-\d\dT\d\d:\d\d):\d\d/;
			var m = policy.schedule[key].match(re);
			if (m.length === 2) {
				policy.schedule[key] = m[1];
			}
		}
	};

	var cleanDate = function(key) {
		if (policy.schedule[key]) {
			var re = /^(\d\d\d\d-\d\d-\d\d)/;
			var m = policy.schedule[key].match(re);
			if (m.length === 2) {
				policy.schedule[key] = m[1];
			}
		}
	};

	cleanTime("startTime");
	cleanDate("startDate");
	cleanTime("endTime");
	cleanDate("endDate");
}


function processCustomPolicies() {
	title("Processing custom policies");

	classicDb.query("select * from settings_types where not isDefault").forEach(row => {
		var hasActionScriptSetting = false;
		var numSettings = 0;
		var unMappedSettings = 0;
		var numScopes = 0;
		var numFailedScopes = 0;

		var policy = JSON.parse(row.json);

		// Check whether or not to include this policy.
		if (
			policy.entityType === "VirtualMachine" &&
			policy.scopes.length === 1 &&
			policy.displayName === (policy.scopes[0].displayName + "::Policy") &&
			policy.settingsManagers.length === 1 &&
			policy.settingsManagers[0].settings.length === 1 &&
			policy.settingsManagers[0].settings[0].uuid === "excludedVMTemplatesUuids"
		) {
			return;
		}


		println("");
		colour("cyan", "bold"); printf("    Migrating '%v'\n", row.displayName); colour();

		// Map the scopes

		var failed = false;
		(policy.scopes || []).forEach(scope => {
			numScopes += 1;
			var found = mapScope(scope);
			if (found !== null) {
				scope.uuid = found.uuid;
				scope.displayName = found.displayName;
				scope.groupType = found.groupType;
			} else {
				numFailedScopes += 1;
				failed = true;
			}
		});

		// Map the settings

		var xlSettings = { };

		(policy.settingsManagers || []).forEach(sm => {
			if (sm.uuid === "actionscriptmanager") {
				hasActionScriptSetting = true;
				return;
			}
			((sm || {}).settings || []).forEach(s => {
				var key = policy.entityType+"|"+sm.uuid+"|"+s.uuid;
				var mapped = policyMap[key];
				if (mapped === undefined) {
					unMappedSettings += 1;
					warning(sprintf("      Warning: No mapping found for '%v'", key.replace(/\|/g, "::")));
					failed = true;
				} else {
// TODO: check that the type the same (classic vs xl)
					xlSettings[mapped.manager] = xlSettings[mapped.manager] || {};
					mapped.setting.split(/\s*,\s*/).forEach(setting => {
						xlSettings[mapped.manager][setting] = s.value;
					});
				}
			});
		});

		if (failed) {
			error("      Policy not migrated");
			return;
		}

		failed = false;
		_.keys(xlSettings).forEach(manager => {
			printf("      %v\n", getManagerDisplayName(row.entityType, manager));
			_.keys(xlSettings[manager]).forEach(setting => {
				var dn = getSettingDisplayName(row.entityType, manager, setting);
				if (!dn) {
					error(sprintf("      Error: Setting '%v::%v::%v' is unknown to XL", row.entityType, manager, setting));
					failed = true;
				} else {
					success(sprintf("        %v = %v", dn, xlSettings[manager][setting]));
				}
			});
			if (policy.schedule) {
				print("      Schedule\n");
				success(sprintf("        Name = %v", policy.schedule.displayName));
			}
		});
		if (failed) {
			return;
		}

		// Squirel up the fields needed for the new DTO to be sent to XL.

		var newSmList = [ ];
		_.keys(xlSettings).forEach(smName => {
			var newSm = {
				uuid: smName,
				settings: [ ]
			};
			_.keys(xlSettings[smName]).forEach(s => {
				numSettings += 1;
				newSm.settings.push({
					uuid: s,
					value: xlSettings[smName][s]
				});
			});
			newSmList.push(newSm);
		});

		if (hasActionScriptSetting) {
			warning("      Warning: Includes 'Action Orchestration' settings which wont be migrated.");
		}

		if (numSettings === 0) {
			warning("      Warning: Policy would make no changes");
		}


		if (numSettings === 0 /* || hasActionScriptSetting*/) {
			error("      Policy not migrated");
			return;
		}

		policy.settingsManagers = newSmList;
		delete policy.uuid;

		if (policy.schedule) {
			cleanSchedule(policy);

			try {
				var sh = findOrCreateSchedule(policy.schedule);
				policy.schedule = sh;
			} catch (ex) {
				var mesg = ex.message.replace(/^HTTP Status: \d+ - /, "").trimSpace();
				warning(sprintf("      Warning: Unable to migrate schedule (%v)", mesg));
				error("      Policy not migrated");
				return;
			}
		}

// TODO - refer to the UUID mapping table instead of this ....
// TODO - populate the mapping in "collect-data.js"

		var foundUuid = null;
		xlDb.query("select uuid from settings_types where displayName = ?", [policy.displayName]).forEach(row => {
			foundUuid = row.uuid;
		});


		if (foundUuid === null) {
			try {
				var rtn = client.createSettingsPolicy(policy);
				lib.saveSettingsPolicy(xlDb, rtn, false);
				lib.saveSettingsMapping(xlDb, row.uuid, rtn.uuid);
			} catch (ex) {
				throw ex;
			}
		} else {
			policy.uuid = foundUuid;
			var rtn2 = client.editSettingsPolicy(foundUuid, {reset_defaults: false}, policy);
			lib.saveSettingsPolicy(xlDb, rtn2, false);
			lib.saveSettingsMapping(xlDb, row.uuid, rtn2.uuid);
		}
	});
}

//=============================================================================================
// Placement policies

function processPlacementPolicies() {
	title("Processing placement policies");	

	classicDb.query("select * from placement_policies").forEach(row => {
		println("");
		colour("cyan", "bold"); printf("    Migrating '%v'\n", row.displayName); colour();

		var policy = JSON.parse(row.json);
		var failed = false;

		// map the scopes

		if (policy.consumerGroup) {
			var cgrp = mapScope(policy.consumerGroup);
			if (cgrp === null) {
				failed = true;
			} else {
				policy.consumerGroup = cgrp;
			}
		}

		// baseProviderGroup is faked by collect.js when a complementary group is listed.

		if (policy.baseProviderGroup) {
			var pgrp = mapScope(policy.baseProviderGroup);
			if (pgrp === null) {
				failed = true;
			} else {
				policy.providerGroup = pgrp;
			}
		} else if (policy.providerGroup) {
			var pgrp2 = mapScope(policy.providerGroup);
			if (pgrp2 === null) {
				failed = true;
			} else {
				policy.providerGroup = pgrp2;
			}
		}

		for (var i=0; i<(policy.mergeGroups ||[]).length; i+=1) {
			var mgrp = mapScope(policy.mergeGroups[i]);
			if (mgrp === null) {
				failed = true;
			} else {
				policy.mergeGroups[i] = mgrp;
			}
		}

		if (failed) {
			error("      Policy not migrated");
			return;
		}

		if (policy.mergeGroups) {
			policy.mergeGroups = policy.mergeGroups.filter(x => { return !x.$NOT_FOUND_IN_XL; });
		}

		delete policy.uuid;
		delete policy.links;
		delete policy.commodityType;

		var xlUuid = null;
		xlDb.query(`select xlUuid from policy_uuid_mapping where classicUuid = ?`, [row.uuid]).forEach(row2 => {
			xlUuid = row2.xlUuid;
		});

		var policyDto = {
			buyerUuid: policy.consumerGroup ? policy.consumerGroup.uuid : undefined,
			capacity: policy.capacity,
			enabled: policy.enabled,
			mergeType: policy.mergeType,
			mergeUuids: policy.mergeGroups ? policy.mergeGroups.map(g => { return g.uuid; }) : undefined,
			policyName: policy.name,
			sellerUuid: policy.providerGroup ? policy.providerGroup.uuid : undefined,
			type: policy.type
		};

		// Note: merge type must be one of: Cluster, DataCenter, DesktopPool, StorageCluster

		try {
			var rtn = null;
			if (xlUuid) {
				policyDto.uuid = xlUuid;
				rtn = client.editPolicy("Market", xlUuid, policyDto);
				success("      Success: policy updated");
			} else {
				rtn = client.addMarketPolicy("Marker", policyDto);
				success("      Success: policy created");
			}
			lib.savePlacementPolicy(xlDb, rtn, false);
			lib.savePlacementPolicyMapping(xlDb, row.uuid, rtn.uuid);
		} catch (ex) {
			error("      Error from API: "+ex.message);
			error("      Policy not migrated");
		}
	});
}

processDefaultPolicies();

println("");
processCustomPolicies();

println("");
processPlacementPolicies();

lib.saveMetaData(xlDb, "migrate_policies_end_time", "" + (new Date()));
