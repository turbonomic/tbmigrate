// TODO: consider whether there is a faster way to collect all entities than we are using now.

// Usage is: tbscript @xl migrate-static-groups.js {classicDbFile} {xlDbFile}

/* jshint -W014, -W119, -W083, -W080 */
/* globals warning, warning2, success, error, note */

var F = require("@/functions");

usage = function() {
	println("");
	println("Usage is:");
	println("");
	println("  tbscript {xl-credentials} migrate-groups.js [options] {classic-db-file} {xl-db-file}");
	println("");
	println("  -i:                   Use interactive selector");
	println("  -skip-scoped-targets: Skip groups that are discovered by scoped targets on classic");
	println("");
	exit(2);
};


var args_ = F.extendedOptions("", "i", "skip-scoped-targets");
if (args_.remaining.length !== 2) {
	usage();
}

if (!client.isXL()) {
	woops("This isnt an XL instance");
}

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator" && userInfo.roleName.toLowerCase() !== "site_admin") {
	woops("Must be run by a user with Turbonomic administrator rights");
}

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args_.remaining[0]+"?mode=rw");
var xlDb = P.open("file:"+args_.remaining[1]+"?mode=rw");

var lib = require("./libmigrate.js");
var cm = require("./group-creation-map.js");
cm.set("lib", lib);

var dg = loadCsv("./defaultGroups.csv");

var groupClassRe = new RegExp(lib.nameMap.group_class_re);

lib.disableAllActions(client, xlDb);

var numGroups = 0;	// number of groups to be migrated
var groupNum = 0;	// the number of the group being pushed.

var nameMap = lib.getGroupNameMap(classicDb);

var screenWidth = parseInt(getenv("width") || "100");

// List of dynamic and system groups that need to be create static
var deferredStaticGroups = [ ];

// =================================================================================

function getXlGroupName(g) {
	var dn = nameMap[g.uuid] || g.displayName;
	return lib.mapGroupName(dn);
}

function saveGroup(db, group) {
	var g = _.deepClone(group);
	g.isCustom = true;
	lib.saveGroup(db, g, -1, ["migrated"]);
	lib.saveEntity(db, g);
	(group.memberUuidList || []).forEach(m => {
		lib.saveGroupMembership(db, g.uuid, m);
	});
}

// is the specified entity from a missing target?
function isFromMissingTarget(e) {
	if (!e.discoveredBy) {
		return false;
	}

	return !lib.targetExists(xlDb, e.discoveredBy.name, e.discoveredBy.type);
}

// is the group discovered by a scoped target?
function isFromScopedTarget(g) {
	var disco = g.discoveredBy || g.source;
	if (!disco) { return false; } // not a discovered target

	return lib.targetIsScopedByUuid(classicDb, disco.uuid);
}

// are all group members from scoped targets?
function areAllMembersFromScopedTargets(groupUuid) {
	var targetUuids = { };
	var allDiscovered = true;
	classicDb.query(`select e.json from group_members m, entities e where groupUuid = ? and e.uuid = m.entityUuid`, [groupUuid]).forEach(row => {
		var obj = JSON.parse(row.json);
		var disco = obj.discoveredBy || obj.source;
		if (disco) {
			targetUuids[disco.uuid] = true;
		} else {
			allDiscovered = false;
		}
	});
	if (!allDiscovered) {
		return false;
	}
	var numScoped = 0;
	var numTargets = 0;
	_.keys(targetUuids).forEach(uuid => {
		classicDb.query("select isScoped from targets where uuid = ?", [uuid]).forEach(row => {
			numTargets += 1;
			if (parseInt(row.isScoped) === 1) {
				numScoped += 1;
			}
		});
	});
	return numScoped === numTargets && numTargets > 0;
}

function checkGroupTarget(g) {
	if (g.discoveredBy !== "") {
		var targetName = null;
		var targetRow = null;

		classicDb.query("select name from targets where uuid = ?", [g.discoveredBy]).forEach(row => {
			targetName = row.name;
		});

		if (targetName === null) {
			classicDb.query("select name from derived_targets where uuid = ?", [g.discoveredBy]).forEach(row => {
				targetName = row.name;
			});
		}

		if (targetName !== null) {
			xlDb.query("select * from targets where name = ?", [targetName]).forEach(row => {
				targetRow = row;
			});
			if (targetRow === null) {
				xlDb.query("select * from derived_targets where name = ?", [targetName]).forEach(row => {
					targetRow = row;
				});
			}
		}

		if (targetRow === null) {
			error(sprintf("   Error: skipped - source target (%s) not migrated", targetName));
			return false;
		}

		var obj = JSON.parse(targetRow.json);
		if (obj.status !== "Validated") {
			warning(sprintf("   Warning: source target '%s' not validated - group may be incomplete", targetName));
		}
	}
	return true;
}


// =================================================================================

var internalHostsGroupUuid = undefined;
var internalZonesGroupUuid = undefined;
var hotAddMemoryGroupUuid = undefined;
var hotAddCpuGroupUuid = undefined;

function getInternalGroupUuid(name, dto) {
	var uuid = null;
	xlDb.query("select uuid from groups where displayName = ?", [name]).forEach(row => {
		uuid = row.uuid;
	});
	if (uuid !== null) {
		return uuid;
	}

	try {
		var newGroup = client.createGroup(dto);
		lib.saveGroup(xlDb, newGroup, -1, [""]);
		return newGroup.uuid;
	} catch (ex) {
		try {
			var newGroup = client.findByName("Group", name);
			if (newGroup) {
				lib.saveGroup(xlDb, newGroup, -1, [""]);
				return newGroup.uuid;
			} else {
				return null;
			}
		} catch (ex2) {
			return null;
		}
	}
}


cm.set("internalHostsGroupUuid", function() {
	if (internalHostsGroupUuid !== undefined) { return internalHostsGroupUuid; }

	var dto = {
	    "className": "Group",
	    "criteriaList": [
	        {
	            "caseSensitive": false,
	            "expType": "RXEQ",
	            "expVal": ".*",
	            "filterType": "pmsByName",
	            "singleLine": false
	        }
	    ],
	    "displayName": "INTERNAL-AllHosts",
	    "groupType": "PhysicalMachine",
	    "isStatic": false,
	    "logicalOperator": "AND"
	};
	internalHostsGroupUuid = getInternalGroupUuid("INTERNAL-AllHosts", dto);
	return internalHostsGroupUuid;
});


cm.set("internalZonesGroupUuid", function() {
	if (internalZonesGroupUuid !== undefined) { return internalZonesGroupUuid; }

	var dto = {
	    "className": "Group",
	    "criteriaList": [
	        {
	            "caseSensitive": false,
	            "expType": "RXEQ",
	            "expVal": ".*",
	            "filterType": "zonsByName",
	            "singleLine": false
	        }
	    ],
	    "displayName": "INTERNAL-AllZones",
	    "groupType": "AvailabilityZone",
	    "isStatic": false,
	    "logicalOperator": "AND",
	};

	internalZonesGroupUuid = getInternalGroupUuid("INTERNAL-AllZones", dto);
	return internalZonesGroupUuid;
});

cm.set("hotAddMemoryGroupUuid", function() {
	var name = "Virtual Machines by Hot Add Memory";
	if (hotAddMemoryGroupUuid !== undefined) { return hotAddMemoryGroupUuid; }

	var dto = cm.defaultGroupsByName.VimVMHotAddMem({ displayName: name });
	hotAddMemoryGroupUuid = getInternalGroupUuid(name, dto);
	return hotAddMemoryGroupUuid;
});

cm.set("hotAddCpuGroupUuid", function() {
	var name = "Virtual Machines by Hot Add CPU";
	if (hotAddCpuGroupUuid !== undefined) { return hotAddCpuGroupUuid; }

	var dto = cm.defaultGroupsByName.VimVMHotAddCPU({ displayName: name });
	hotAddCpuGroupUuid = getInternalGroupUuid(name, dto);
	return hotAddCpuGroupUuid;
});

// =================================================================================

function createGroup(newGroup) {
	var createdGroup = null;
	try {
		createdGroup = client.createGroup(newGroup);
	} catch(ex) {
		if (ex.message.contains("- ALREADY_EXISTS: ")) {
			var m = ex.message.match(/ids?:? \[([0-9]+)\]/);
			if (m) {
				try {
					createdGroup = client.editGroup(m[1], newGroup);
				} catch (ex2) {
					error("   Error: failed to update group (REST API returned an error)");
					printJson(ex2);
				}
			}
		} else if (ex.message.contains("- NOT_FOUND: ")) {
			var m2 = ex.message.match(/ids?:? \[([0-9]+)\]/);
			if (m2) {
				try {
					createdGroup = client.getGroupByUuid(m2[1]);
				} catch (ex3) {
					error("   Error: failed to fetch group details (REST API returned an error)");
					printJson(ex3);
				}
			}
		}
		if (createdGroup === null) {
			error("   Error: failed to create group (REST API returned an error)");
			printJson(ex);
			return null;
		}
	}
	return createdGroup;
}


// =================================================================================

var copied = { };

function copyStaticGroup(g, allowDefer) {
	g = _.deepClone(g);

	var orgDisplayName = g.displayName;
	var xlName = getXlGroupName(g);

	var countMembers = lib.shouldCountMembers(g);

	printf("\n[%d of %d] Copy %v static group '%v' (%v)\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", g.displayName, g.groupType);
	if (copied[g.uuid]) {
		success("   Already copied once - skipping");
		return;
	}
	copied[g.uuid] = true;

	if (parseInt(g.isCustom) === 0 && g.discoveredBy) {
		try {
			var xlGroup = lib.findEntityInXl(classicDb, xlDb, nameMap, g);
			if ((xlGroup.source || {}).uuid) {
				success("   Success: system group already discovered by target probe[s]");
				lib.saveGroupMapping(xlDb, g.uuid, xlGroup.uuid);
				return;
			}
		} catch (ex) {
			//
		}
	}

	if (xlName !== lib.mapGroupName(orgDisplayName)) {
		warning(sprintf("   Warning: renamed as '%s'", xlName));
	}

	// get the leaf types
	var types = lib.getMemberTypes(classicDb, g.uuid);

	if (types.length === 0) {
			types = [ g.groupType ];
	}

	if (types.length === 2 && types[0] === "Group") {
		types = [ types[1] ];
	} else if (types.length === 2 && types[1] === "Group") {
		types = [ types[10] ];
	}

	if (types.length > 1) {
		error(sprintf("   Error: group holds multiple member types (%s) - skipping", types.join(", ")));
		return;
	}

	g.actualGroupType = types[0];
	var xlGroupType = lib.mapGroupClass(g.actualGroupType);

	var memberUuids = [ ];	// The UUIDs of member entities, in XL.

	// Get the members of the group in classic.
	var sql = `
		-- select e.className, e.displayName, e.remoteId, e.parentDisplayName, e.uuid, count(*) n, e.json
		select e.className, e.displayName, e.remoteId, e.parentDisplayName, e.uuid, 1 n, e.json
		from group_members m, entities e
		where m.groupUuid = ?
		and e.uuid == m.entityUuid
		-- group by e.className, e.displayName, e.remoteId, e.parentDisplayName
	`;

	var numNoTargets = 0;		// num members skipped because the target hasnt been migrated
	var numUnsupported = 0;		// num members skipped because they are not supported in XL
	var numSkipped = 0;			// num members skipped - for any reason

	var members = classicDb.query(sql, [ g.uuid ]);

	var warnings = [ ];
	var defer = false;

	members.forEach(m => {
		if (allowDefer && deferredStaticGroups.map(x => { return x.uuid; }).contains(m.uuid)) {
			defer = true;
			return;
		}

		var cn = m.className;
		var dn = m.displayName;
		var obj = JSON.parse(m.json);

		try {
			var m2 = lib.findEntityInXl(classicDb, xlDb, nameMap, m);
			memberUuids.push(m2.uuid);
		} catch (ex) {
			numSkipped += 1;
			warnings.push(sprintf("   Warning: %s", ex.message));
			if (ex.noTarget) {
				numNoTargets += 1;
			}
			if (ex.unsupported) {
				numUnsupported += 1;
			}
		}
	});

	if (defer) {
		deferredStaticGroups.push(g);
		warning2(sprintf("   Deferred: depends on one or more deferred subgroups"));
		return;
	}

	warnings.sort();
	warnings.forEach(w => { warning(w); });

	var n = countMembers ? parseInt(g.membersCount) : parseInt(g.entitiesCount);
	if (n > 0 && (numNoTargets +  numUnsupported) >= n) {
		if (n === numNoTargets) {
			error("   Skipped: ALL expected members depend on targets that have not been discovered - group skipped.");
		} else if (n === numUnsupported) {
			error("   Skipped: ALL expected members are unsupported types in XL - group skipped.");
		} else {
			error("   Skipped: Group skipped");
		}
		return;
	}

	var saidEmpty = false;

	if (memberUuids.length === 0) {
		if (parseInt(g.entitiesCount) === 0) {
			success("   Success: Empty group created (also empty in classic)");
		} else {
			if (countMembers) {
				warning(sprintf("   Warning: Empty group created (but %d member%s in classic).",
					parseInt(g.membersCount),
					parseInt(g.membersCount) === 1 ? "" : "s"
				));
			} else {
				warning(sprintf("   Warning: Empty group created (but %d entit%s in classic).",
					parseInt(g.entitiesCount),
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		}
		saidEmpty = true;
	}

	var existing = lib.readGroup(xlDb, getXlGroupName(g), xlGroupType);
	if (existing !== null) {
		var m1 = memberUuids || [];
		m1.sort();
		var m2 = existing.memberUuidList || [];
		m2.sort();
		if (m1.join("\n") === m2.join("\n")) {
			if (existing.entitiesCount !== 0 || !saidEmpty) {
				if (numSkipped > 0) {
					if (existing.entitiesCount === 0) {
						success(sprintf("   Success: group already exists but is missing %d entit%s",
							numSkipped,
							numSkipped === 1 ? "y" : "ies"
						));
					} else {
						success(sprintf("   Success: group already exists, is missing %d entit%s though the other %d match%s",
							numSkipped,
							numSkipped === 1 ? "y" : "ies",
							existing.entitiesCount,
							existing.entitiesCount > 1 ? "" : "es"
						));
					}
				} else {
					var n2 = countMembers ? parseInt(g.membersCount) : parseInt(g.entitiesCount);
					success(sprintf("   Success: group already exists and contains the expected %d entit%s",
						n2,
						n2 === 1 ? "y" : "ies"
					));
				}
			}
			lib.saveGroupMapping(xlDb, g.uuid, existing.uuid);
			return;
		}
	}

//	var flag = existing === null ? "-create" : "-edit";
	var name = g.displayName.replace(/\\/g, "/");
	var groupDto = {
	    "displayName": xlName,
	    "groupType": xlGroupType,
	    "isStatic": true,
	    "memberUuidList": memberUuids
	};

	var newGroup = null;
	if (existing === null) {
		newGroup = createGroup(groupDto);
	} else {
		groupDto.uuid = existing.uuid;
		try {
			newGroup = client.editGroup(existing.uuid, groupDto);
		} catch (ex2) {
			error("   Error: failed to update group info (REST API returned an error)");
			printJson(ex2);
			return;
		}
	}

	if (newGroup === null) {
		error("   Error: group creation failed");
		return;
	}

	saveGroup(xlDb, newGroup);
	lib.saveGroupMapping(xlDb, g.uuid, newGroup.uuid);

	if (newGroup.entitiesCount > 0) {
		if (countMembers) {
			success(sprintf("   Success: group created and now contains %d member%s (%d in classic)",
				newGroup.membersCount,
				parseInt(newGroup.membersCount) === 1 ? "y" : "ies",
				g.membersCount
			));
		} else {
			success(sprintf("   Success: group created and now contains %d entit%s (%d in classic)",
				newGroup.entitiesCount,
				parseInt(newGroup.entitiesCount) === 1 ? "y" : "ies",
				g.entitiesCount
			));
		}
	}
}


function filtersMatch(xl ,classic) {
	if (xl.filterCategory === classic.filterCategory && xl.inputType === classic.inputType) {
		return true;
	}

	if (
		xl.className === classic.className &&
		xl.filterType === classic.filterType &&
		xl.filterType.hasSuffix("ByName") &&
		xl.filterCategory === "property" &&
		classic.filterCategory === "entity" &&
		classic.elements === "RefEntity:" + xl.className + ":" + xl.elements
	) {
		return true;
	}

	if (
		xl.className === "BusinessAccount" &&
		classic.className === "BusinessAccount" &&
		xl.filterType === "businessAccountCloudProvider" &&
		classic.filterType === "businessAccountCloudProvider"
	) {
		return true;
	}

	return false;
}


function mapCriteria(groupType, criteria) {
	if (!criteria.filterType) {
		throw new Error("Group has a null filter criteria - cant migrate");
	}

	// first : does XL have the same criteria definition as Classic?
	var classic = null;
	var xlGroupType = lib.mapGroupClass(groupType);

	classicDb.query("select * from group_criteria where className = ? and filterType = ?", [groupType, criteria.filterType]).forEach(row => {
		classic = row;
	});
	if (classic === null) {
		woops(sprintf("Internal error: group citeria '%s:%s' not found in classic", groupType, criteria.filterType));
	}

	var xl = null;
	xlDb.query("select * from group_criteria where className = ? and filterType = ?", [xlGroupType, criteria.filterType]).forEach(row => {
		xl = row;
	});

	if (xl === null) {
		var e = new Error(sprintf("Group criteria '%s:%s' not implemented in XL", xlGroupType, criteria.filterType));
		e.createAsStatic = true;
		throw e;
	}

// NB: loadOptions is a boolean in the XL code.

	if (!filtersMatch(xl, classic)) {
		var e2 = new Error(sprintf("Group criteria '%s:%s' dont match in classic and XL", groupType, criteria.filterType));
		e2.createAsStatic = true;
		throw e2;
	}

	if (classic.filterCategory === "entity" && classic.elements.hasSuffix(":uuid")) {
		var uuids = criteria.expVal.split("|");
		var mappedUuids = [ ];
		uuids.forEach(uuid => {
			var classicEntity = null;
			var xlEntities = [ ];
			classicDb.query("select json from entities where uuid = ?", [uuid]).forEach(row => {
				classicEntity = JSON.parse(row.json);
			});
			if (classicEntity === null) {
				var e = new Error(sprintf("Cant find filter entity with uuid '%v' in classic", uuid));
				e.createAsStatic = false;
				throw e;
			}
			try {
				var xlEntity = lib.findEntityInXl(classicDb, xlDb, nameMap, classicEntity);
				mappedUuids.push(xlEntity.uuid);
			} catch (ex) {
				ex.createAsStatic = false;
				throw ex;
			}
		});
		criteria.expVal = mappedUuids.join("|");
	}

	return criteria;
}


function copyDynamicGroup(g, warn) {
	printf("\n[%d of %d] Copy %v dynamic group '%v' (%v)\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", g.displayName, g.groupType);
	if (copied[g.uuid]) {
		success("   Already copied once - skipping");
		return;
	}

	if (parseInt(g.isCustom) === 0 && g.discoveredBy) {
		try {
			var xlGroup = lib.findEntityInXl(classicDb, xlDb, nameMap, g);
			if ((xlGroup.source || {}).uuid) {
				success("   Success: system group already discovered by target probe[s]");
				lib.saveGroupMapping(xlDb, g.uuid, xlGroup.uuid);
				return;
			}
		} catch (ex) {
			//
		}
	}

	var found = false;
	classicDb.query("select json from groups where uuid = ?", [ g.uuid ]).forEach(row => {
		g = JSON.parse(row.json);
		found = true;
	});

	if (!found) {
		error("   Error: group data not found in classicDb.");
		return;
	}

	var countMembers = lib.shouldCountMembers(g);

	copied[g.uuid] = true;

	var orgDisplayName = g.displayName;
	var xlName = getXlGroupName(g);

	if (xlName !== lib.mapGroupName(orgDisplayName)) {
		warning(sprintf("   Warning: renamed as '%s'", xlName));
	}

	var newGroup = {
		"className": g.className,
		"displayName": xlName,
		"groupType": lib.mapGroupClass(g.groupType),
		"isStatic": g.isStatic,
		"isCustom": true,
		"logicalOperator": g.logicalOperator,
		"criteriaList": [ ]
	};

	var errors = [ ];

	var doCopyAsStatic = function(mesg) {
		var ex = new Error(mesg);
		ex.createAsStatic = true;
		var g2 = {
			className: g.className,
			cloudType: g.cloudType,
			displayName: g.displayName,
			isStatic: true,
			groupType: g.groupType,
			uuid: g.uuid,
			entitiesCount: parseInt(g.entitiesCount),
			membersCount: parseInt(g.membersCount),
			reason: ex
		};
		warning2(sprintf("   Deferred: change to static group (%s)", ex.message));
		deferredStaticGroups.push(g2);
	};

	if (g.isCustom && !g.isStatic && (!g.criteriaList || g.criteriaList.length === 0)) {
		doCopyAsStatic("Custom dynamic group with no criteria defined");
		return;
	}

	var stop = false;

	(g.criteriaList || []).forEach(c => {
		try {
			var mapped = mapCriteria(g.groupType, c);
			newGroup.criteriaList.push(mapped);
		} catch (ex) {
			if (ex.createAsStatic) {
				doCopyAsStatic(ex.message);
				stop = true;
				return;
			} else {
				errors.push(ex.message);
			}
		}
	});

	if (stop) {
		return;
	}

	errors.sort();
	errors.forEach(e => {
		error("   Error: "+e);
	});
	if (errors.length > 0) {
		return;
	}

	var createdGroup = createGroup(newGroup);
	if (createdGroup === null) { return; }

	saveGroup(xlDb, createdGroup);
	lib.saveGroupMapping(xlDb, g.uuid, createdGroup.uuid);
	if (createdGroup.membersCount === 0) {
		if (parseInt(g.membersCount) === 0) {
			success("   Success: Empty group created (also empty in classic)");
		} else {
			if (countMembers) {
				warning(sprintf("   Warning: Empty group (but %d member%s in classic).",
					parseInt(g.membersCount),
					parseInt(g.membersCount) === 1 ? "" : "s"
				));
			} else {
				warning(sprintf("   Warning: Empty group (but %d entit%s in classic).",
					parseInt(g.entitiesCount),
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		}
	} else {
		if (countMembers) {
			success(sprintf("   Success: group created and now contains %d member%s (%v in classic)",
				parseInt(createdGroup.membersCount),
				parseInt(createdGroup.membersCount) === 1 ? "" : "s",
				g.membersCount
			));
		} else {
			success(sprintf("   Success: group created and now contains %d entit%s (%v in classic)",
				parseInt(createdGroup.entitiesCount),
				parseInt(createdGroup.entitiesCount) === 1 ? "y" : "ies",
				g.entitiesCount
			));
		}
	}
}


var showNote1 = false;

function checkStaticGroupExists(g) {
	var orgDisplayName = g.displayName;
	var xlName = getXlGroupName(g);
	var xlType = lib.mapGroupClass(g.groupType);

	var countMembers = lib.shouldCountMembers(g);

	printf("\n[%d of %d] Check %v group '%v' (%v) exists\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", orgDisplayName, g.groupType);

	if (parseInt(g.isCustom) === 0 && g.discoveredBy) {
		try {
			var xlGroup = lib.findEntityInXl(classicDb, xlDb, nameMap, g);
			if ((xlGroup.source || {}).uuid) {
				success("   Success: system group already discovered by target probe[s]");
				lib.saveGroupMapping(xlDb, g.uuid, xlGroup.uuid);
				return;
			}
		} catch (ex) {
			//
		}
	}

	if (!checkGroupTarget(g)) {
		return;
	}

	if (xlName !== lib.mapGroupName(orgDisplayName)) {
		warning(sprintf("   Warning: renamed as '%s'", xlName));
	}

	var found = null;

	try {
		found = lib.findEntityInXl(classicDb, xlDb, nameMap, g);
		if (lib.mapGroupName(g.displayName) !== lib.mapGroupName(found.displayName)) {
			warning(sprintf("   Warning: Renamed to '%s'", found.displayName));
		}
	} catch (ex) {
		error("   Error: "+ex.message);
		return;
	}

	lib.saveGroupMapping(xlDb, g.uuid, found.uuid);


	// Tell the user what's just happened.

	var xlCount = parseInt(countMembers ? found.membersCount : found.entitiesCount);
	var classicCount = parseInt(countMembers ? g.membersCount : g.entitiesCount);

	var xlText = (xlCount === 0)
		? "Empty group exists"
		: countMembers
			? sprintf("Group exists and contains %d member%s", xlCount, xlCount === 1 ? "" : "s")
			: sprintf("Group exists and contains %d entit%s", xlCount, xlCount === 1 ? "y" : "ies");

	var classicText = (classicCount === 0)
		? "empty in classic"
		: countMembers
			? sprintf("%d member%s in classic", classicCount, classicCount === 1 ? "" : "s")
			: sprintf("%d entit%s in classic", classicCount, classicCount === 1 ? "y" : "ies");

	if (xlCount === 0 && classicCount > 0) {
		warning("   Warning: "+xlText+" ("+classicText+")");
	} else {
		success("   Success: "+xlText+" ("+classicText+")");
	}

}


function criteriaMatch(g1, g2) {
	if ((g1.criteriaList || []).length !== (g2.criteriaList ||[]).length) {
		return false;
	}

	for (var i=0; i < (g1.criteriaList || []).length; i += 1) {
		var c1 = g1.criteriaList[i];
		var c2 = g2.criteriaList[i];

		if (
			c1.caseSensitive !== c2.caseSensitive ||
			c1.expType !== c2.expType ||
			c1.expVal !== c2.expVal ||
			c1.filterType !== c2.filterType ||
			c1.singleLine !== c2.singleLine
		) {
			return false;
		}
	}

	return true;
}


function defaultGroupName(uuid) {
	var found = dg.filter(row => { return row[0] === uuid; });
	return found.length === 0 ? null : found[0][2];
}


function copyRelationalGroup(g) {
	g = _.deepClone(g);

	var countMembers = lib.shouldCountMembers(g);

	var orgDisplayName = g.displayName;

	var cat = (g.category || "").trimPrefix("GROUP-");
	printf("\n[%d of %d] Migrate %v group '%v' (%v)\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", g.displayName, cat || g.groupType);
	if (copied[g.uuid]) {
		success("   Already copied once - skipping");
		return;
	}

	if (parseInt(g.isCustom) === 0 && g.discoveredBy) {
		try {
			var xlGroup = lib.findEntityInXl(classicDb, xlDb, nameMap, g);
			if ((xlGroup.source || {}).uuid) {
				success("   Success: system group already discovered by target probe[s]");
				lib.saveGroupMapping(xlDb, g.uuid, xlGroup.uuid);
				return;
			}
		} catch (ex) {
			//
		}
	}

	if (!checkGroupTarget(g)) {
		return;
	}

	copied[g.uuid] = true;

	if (g.category === "") {
		error("   Error: category should not be empty");
		return;
	}

	var creator = null;
	var name = defaultGroupName(g.uuid);
	if (name !== null) {
		creator = cm.defaultGroupsByName[ name.trimPrefix("GROUP-") ];
	}

	if (!creator) {
		creator = cm.creatorMap[ cat ];
	}

	if (creator === null || creator === undefined) {
		warning2("   Deferred: change to static group (no suitable dynamic group filter exists)");
		deferredStaticGroups.push(g);
		return;
	}

	if (nameMap[g.uuid]) {
		warning2("   Deferred: change to as static group (duplicate name in classic)");
		deferredStaticGroups.push(g);
		return;
	}

	var defn = null;
	try {
		defn = creator(g);
		if (defn === null) {
			warning2("   Deferred: change to static group (no suitable dynamic group filter exists)");
			deferredStaticGroups.push(g);
			return;
		}
		defn.displayName = getXlGroupName(g);
	} catch (ex) {
		if (_.isString(ex)) {
			error("    Error: "+ex);
			return;
		}
	}

	if (lib.mapGroupName(defn.displayName) !== lib.mapGroupName(orgDisplayName)) {
		warning(sprintf("   Warning: renamed as '%s'", defn.displayName));
	}

	var foundGroup = null;
	xlDb.query("select g.json from group_uuid_mapping m, groups g where m.classicUuid = ? and g.uuid = m.xlUuid", [ g.uuid ]).forEach(g2 => {
		foundGroup = JSON.parse(g2.json);
	});

	if (
		foundGroup !== null &&
		foundGroup.displayName === defn.displayName &&
		foundGroup.className === defn.className &&
		foundGroup.groupType === defn.groupType &&
		foundGroup.isStatic === defn.isStatic &&
		criteriaMatch(foundGroup, defn)
	) {
		success("   Success: Group already exists and has the expected settings");
		return;
	}

	var newGroup = createGroup(defn);
	if (newGroup === null) { return; }

	saveGroup(xlDb, newGroup);
	lib.saveGroupMapping(xlDb, g.uuid, newGroup.uuid);
	if (newGroup.entitiesCount === 0) {
		if (parseInt(g.entitiesCount) === 0) {
			success("   Success: Empty group created (also empty in classic)");
		} else {
			if (countMembers) {
				warning(sprintf("   Warning: Empty group created (but %d member%s in classic).",
					parseInt(g.membersCount),
					parseInt(g.membersCount) === 1 ? "" : "s"
				));
			} else {
				warning(sprintf("   Warning: Empty group created (but %d entit%s in classic).",
					parseInt(g.entitiesCount),
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		}
	} else {
		if (countMembers) {
			success(sprintf("   Success: group created and now contains %d member%s (%v in classic)",
				parseInt(newGroup.membersCount),
				parseInt(newGroup.membersCount) === 1 ? "" : "s",
				g.membersCount
			));
		} else {
			success(sprintf("   Success: group created and now contains %d entit%s (%v in classic)",
				parseInt(newGroup.entitiesCount),
				parseInt(newGroup.entitiesCount) === 1 ? "y" : "ies",
				g.entitiesCount
			));
		}
	}
}

var sql = `select * from groups_plus where displayName not regexp ? order by order_ desc`;

var groups = classicDb.query(sql, [ lib.nameMap.excluded_group_names_re ]);

//==============================================================================================================

var errorsAtStart = [ ];
var cantMigrate = { };
var duplicates = { };

groups.sort((a, b) => {
	var aa = a.displayName.toLowerCase();
	var bb = b.displayName.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});


if (args_.i) {
	// Uuids of groups that are used as scopes.
	var scopeGroups = { };
	classicDb.query(`
		select groupUuid from policy_scopes
		union select groupUuid from settings_scopes
		union select groupUuid from target_scopes
		union select groupUuid from user_group_scopes
		union select groupUuid from user_scopes
	`).forEach(row => {
		scopeGroups[row.groupUuid] = true;
	});

	while (true) {
		var uuids = _.keys(scopeGroups).map(u => { return "'" + u + "'" }).join(",");
		var newUuids = 0;
		classicDb.query(`
			select m.entityUuid uuid
			from group_members m, groups g
			where g.uuid = m.entityUuid
			and m.groupUuid in (`+uuids+`)
		`).forEach(row => {
			if (!scopeGroups[row.uuid]) {
				newUuids += 1;
				scopeGroups[row.uuid] = true;
			}
		});
		if (newUuids === 0) {
			break;
		}
	}

	var selection = {
		choices: [ ],
		title: "Select the optional groups to migrate"
	};
	
	var preSelected = { };
	var preSelectedFound = false;
	classicDb.query(`select json from metadata where name = "selected_groups"`).forEach(row => {
		preSelected = JSON.parse(row.json);
		preSelectedFound = true;
	});

	// -- dev/test aid only
	if (getenv("group_regexp")) {
		var re = new RegExp(getenv("group_regexp"));
		groups = groups.filter(g => {
			return g.displayName.match(re);
		});
	}

	var rows = _.deepClone(groups);
	var promptWidth = screenWidth - 40;

	var pad = "";
	for (var i=0; i<promptWidth; i+=1) { pad = pad + " "; }

	var maxDnLen = 0;
	rows.forEach(row => {
		var dn = (nameMap[row.uuid] || row.displayName);
		if (dn.length > maxDnLen) { maxDnLen = dn.length; }
	});

	if (maxDnLen < promptWidth) {
		promptWidth = maxDnLen;
	}

	rows.forEach(row => {
		var obj = JSON.parse(row.json);
		var dn = (nameMap[row.uuid] || row.displayName).limitLength(promptWidth);
		dn = (dn + pad).left(promptWidth);
		var prompt = "";
		if (row.groupType === "BusinessAccount") {
			prompt = sprintf(
				"%s - %v[-] - [white]%d members[-]",
				dn,
				parseInt(row.isStatic) ? "[green]Static " : "[purple]Dynamic",
				parseInt(row.membersCount)
			);
		} else {
			prompt = sprintf(
				"%s - %v[-] - [yellow]%d entities[-]",
				dn,
				parseInt(row.isStatic) ? "[green]Static " : "[purple]Dynamic",
				parseInt(row.entitiesCount)
			);
		}

		var message = "Optional group, can be de-selected";
		var forced = false;

		var n = parseInt(xlDb.query("select count(*) n from group_uuid_mapping where classicUuid = ?", [ row.uuid ])[0].n);
		if (n > 0) {
			forced = true;
			message = "Group already exists";
		} else if (scopeGroups[row.uuid]) {
			forced = true;
			message = "Mandatory group - scopes a policy, setting, target or user";
		}

		// Is the group a member of another?
		var neededBy = [ ];
		classicDb.query("select g.uuid from group_members m, groups_plus g where m.entityUuid = ? and g.uuid = m.groupUuid", [row.uuid]).forEach(row2 => {
			neededBy.push(row2.uuid);
		});

		var failed = false;
		var later = false;

		if (args_["skip-scoped-targets"]) {
			var obj = JSON.parse(row.json);
			if (isFromScopedTarget(obj) || (obj.groupType === "Application" && areAllMembersFromScopedTargets(row.uuid))) {
				message = "[orange::b]MIGRATE LATER[-::-] - Group depends entirely on scoped targets";
				later = true;
				forced = false;
			}
		}

		selection.choices.push({
			key: row.uuid,
			value: prompt,
			selected: (preSelectedFound === false || preSelected[row.uuid]) && !later && !failed,
			forced: forced,
			later: later,
			message: message,
			failed: failed,
			neededBy: neededBy
		});
	});

	_.keys(duplicates).forEach(dn => {
		if (dn.length < 60) {
			dn = (dn + "                                                              ").left(60);
		}
		var prompt = sprintf(
			"%s - %v[-]",
			dn,
			"[red]Error  "
		);
		selection.choices.push({
			key: "-",
			value: prompt,
			selected: false,
			message: "[red]Duplicate group name in classic - Cant migrate[-]",
			failed: true
		});
	});

	selection.choices.sort((a, b) => {
		var aa = a.value.toLowerCase();
		var bb = b.value.toLowerCase();
		if (aa > bb) { return 1; }
		if (aa < bb) { return -1; }
		return 0;
	});

	if (selection.choices.length === 0) {
		println("No groups require migration");
		lib.saveMetaData(xlDb, "migrate_groups_end_time", "" + (new Date()));
		exit(0);
	}

	var f = tempFile(JSON.stringify(selection));
	try {
		print("<SELECTOR_START>\r                     \r");
		commandPipe("./select", ["-s", f.path()]);
		print("<SELECTOR_END>\r                      \r");
		selection = loadJson(f.path());
		f.clean();
	} catch (ex) {
		print("<SELECTOR_END>\r                    \r");
		f.clean();
		if (ex.message.hasSuffix("exit status 1")) {
			println("Migration cancelled by user");
			exit(1);
		}
		throw ex;
	}

	preSelected = { };
	selection.choices.forEach(c => {
		preSelected[c.key] = c.selected || c.forced || c.later;
	});
	classicDb.exec("replace into metadata values (?, ?)", [ "selected_groups", JSON.stringify(preSelected)]);

	groups = groups.filter(g => {
		return preSelected[g.uuid] ? true : false;
	});
}

numGroups = groups.length;
groupNum = 0;

if (numGroups === 0) {
	println("\nNo groups selected for migration");
	lib.saveMetaData(xlDb, "migrate_groups_end_time", "" + (new Date()));
	exit(0);
}

printf("\n%d groups selected for migration\n", numGroups);

errorsAtStart.forEach(err => {
	error(err);
});


groups.sort((a, b) => {
	var aa = sprintf("%04d %s", a.order_ ? parseInt(a.order) : 1000, a.displayName.toLowerCase());
	var bb = sprintf("%04d %s", b.order_ ? parseInt(b.order) : 1000, b.displayName.toLowerCase());
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});


groups.forEach(g => {
	var name = defaultGroupName(g.uuid);

	if (name !== null) {
		if (cm.defaultGroupsByName[name] !== null) {
			g.category = name;
		}
	}

	if (g.category) {
		groupNum += 1;
		copyRelationalGroup(g);
	}
});


groups.forEach(g => {
	if (parseInt(g.isCustom) !== 0 && parseInt(g.isStatic) === 1 && !g.category) {
		groupNum += 1;
		copyStaticGroup(g, true);
	} else if (parseInt(g.isCustom) === 0 && parseInt(g.isStatic) === 1 && !g.category) {
		groupNum += 1;
		checkStaticGroupExists(g);
	} else if (g.category) {
		// we did it earlier  :)
	} else if (g.isStatic !== "1") {
		groupNum += 1;
		copyDynamicGroup(g, false);
	} else {
		groupNum += 1;
		error(sprintf("\nError: %s group '%s' not migrated", parseInt(g.isStatic) === 1 ? "static" : "dynamic", g.displayName));
	}
});


if (deferredStaticGroups.length > 0) {
	println("");
	println("=============================== Processing Deferred Groups ===============================");
	printf(" %d dynamic or system groups need to be created as static\n", deferredStaticGroups.length);
	println("==========================================================================================");
	copied = { };
	groupNum = 0;
	numGroups = deferredStaticGroups.length;
	deferredStaticGroups.forEach(g => {
		groupNum += 1;
		copyStaticGroup(g, false);
	});
}

lib.saveMetaData(xlDb, "migrate_groups_end_time", "" + (new Date()));

if (showNote1) {
	note("");
	note("Note #1 - One or more groups that should be discovered by target probes in XL do not exist.");
	note("          Possible reasons for this include:");
	note("          - You've run this step too soon, and discovery is not actually yet complete. Wait and retry this step.");
	note("          - The group should be discovered by a target that you have selected not to migrate.");
	note("          - The group should be discovered by a scoped target but you have not yet run the second 'migrate-targets.sh' step");
	note("            (in that case; this is not a problem. The group should appear later in the process.)");
	note("          - The target that should discover this group has failed.");
}
