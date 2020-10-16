// TODO: consider whether there is a faster way to collect all entities than we are using now.

// Usage is: tbscript @xl migrate-static-groups.js {classicDbFile} {xlDbFile}

/* jshint -W014, -W119, -W083 */
/* globals warning, success, error, note */

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
var dg = loadCsv("./defaultGroups.csv");

var groupClassRe = new RegExp(lib.nameMap.group_class_re);

lib.disableAllActions(client, xlDb);

var numGroups = 0;	// number of groups to be migrated
var groupNum = 0;	// the number of the group being pushed.

// =================================================================================

function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}

function mapGroupClass(cn) {
	return lib.nameMap.class_name_map[cn] || cn;
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
	if (!g.source) { return false; } // not a discovered target

	return lib.targetIsScopedByUuid(classicDb, g.source.uuid);
}

// are all group members from scoped targets?
function areAllMembersFromScopedTargets(groupUuid) {
	var targetUuids = { };
	var allDiscovered = true;
	classicDb.query(`select e.json from group_members m, entities e where groupUuid = ? and e.uuid = m.entityUuid`, [groupUuid]).forEach(row => {
		var obj = JSON.parse(row.json);
		if (obj.discoveredBy) {
			targetUuids[obj.discoveredBy.uuid] = true;
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

// =================================================================================

var copied = { };

function copyStaticGroup(g, warn, ex) {
	g = _.deepClone(g);

	var countMembers = g.groupType === "BusinessAccount";

	if (warn) {
		warning("   Warning: copying as a static group");
		if (ex) {
			println("            ("+ex.message+")");
		}
	} else {
		printf("\n[%d of %d] Copy %v static group '%v' (%v)\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", g.displayName, g.groupType);
		if (copied[g.uuid]) {
			success("   Already copied once - skipping");
			return;
		}

		copied[g.uuid] = true;
	}

	// get the leaf types
	var types = lib.getMemberTypes(classicDb, g.uuid);

	if (types.length === 0) {
//		if (parseInt(g.entitiesCount) === 0) {
			types = [ g.groupType ];
//		} else {
//			error("   Error: cant determine member types - skipping");
//			return;
//		}
	}

	if (types.length > 1) {
		error(sprintf("   Error: group holds multiple member types (%s) - skipping", types.join(", ")));
		return;
	}

	g.actualGroupType = types[0];
	var xlGroupType = mapGroupClass(g.actualGroupType);

	var memberUuids = [ ];	// The UUIDs of member entities, in XL.
	var numSkipped = 0;		// The number we skipped because they were not found or unresolvably duplicated.

	// Get the members of the group in classic.
	var sql = `
		select e.className, e.displayName, e.remoteId, e.parentDisplayName, e.uuid, count(*) n, e.json
		from group_members m, entities e
		where m.groupUuid = ?
		and e.uuid == m.entityUuid
		group by e.className, e.displayName, e.remoteId, e.parentDisplayName
	`;

	var numSkippedGuestLoads = 0;
	var numNoTargets = 0;

	classicDb.query(sql, [ g.uuid ]).forEach(m => {
		var cn = m.className;
		var dn = m.displayName;
		var obj = JSON.parse(m.json);

		if (groupClassRe.test(cn)) {
			dn = mapGroupName(dn);
		}

		// for AWS, AZURE and GCP: the remote Ids are differently formatted between classic and XL.
		// -- classic ones look like : azure::VM::d653a2fe-8a55-4796-a25a-a32dcfea4d43
		// -- XL ones look like      : d653a2fe-8a55-4796-a25a-a32dcfea4d43

		var rid1 = m.remoteId || "";	// orignal, undoctored remote ID
		var rid2 = m.remoteId || "";	// potentially cleaned up remote ID

		if (rid2.match(/^(aws|azure|gcp)::/)) {
			var r = rid2.split(/::/);
			rid2 = r[r.length-1];
		}

		var pn = m.parentDisplayName || "";

		var n = parseInt(m.n);
		if (parseInt(n) !== 1) {
			if (cn === "Application" && dn.match(/^GuestLoad *\[.*?\]$/)) {
				numSkippedGuestLoads += 1;
			} else {
				warning(sprintf("   Warning: duplicate rows for '%v::%v'%v", cn, dn, rid1 ? (" ("+rid1+")") : ""));
			}
			numSkipped += 1;
		} else {
			var uuids = [ ];
			var xlClassName = mapGroupClass(cn);

			// WMI applications have no key in common between XL and classic so we need to resort to parsing out the display name.
			if (cn === "Application" && (obj.discoveredBy || {}).type === "WMI" && obj.displayName.hasSuffix("["+obj.discoveredBy.name+"]")) {
				var vmName = obj.discoveredBy.name;
				var appName = obj.displayName.trimSuffix("["+obj.discoveredBy.name+"]").trimSpace();
				xlDb.query("select uuid, json from entities where displayName like (? || ' ' || ? || ' [%]')", [appName, vmName]).forEach(row => {
					var obj2 = JSON.parse(row.json);
					if (
						(obj2.discoveredBy || {}).type === "WMI" &&
						obj2.discoveredBy.name === vmName &&
						obj2.className === "ApplicationComponent" &&
						(obj2.providers || []).length === 1 &&
						obj2.providers[0].displayName === vmName
					) {
						uuids.push(obj2.uuid);
					}
				});
			} else {
				// Find the matching member in XL
				var sql2 = `
					select uuid, json
					from entities
					where className = ?
					and (displayName = ? or className in ("ApplicationComponent", "DatabaseServer"))
					and (? = "" or parentDisplayName = ?)
				`;

				xlDb.query(sql2, [ xlClassName, dn, pn, pn ]).filter(row => {
					if (!rid1) { return true; }
					var rec = JSON.parse(row.json);

					if (rec.remoteId === rid1 || rec.remoteId === rid2) { return true; }

					var accepted = false;
					_.keys(rec.vendorIds || {}).forEach(k => {
						if (rec.vendorIds[k] === rid1 || rec.vendorIds[k] === rid2) {
							accepted = true;
						}
					});
					return accepted;
				}).forEach(row => {
					uuids.push(row.uuid);
				});
			}

			// Not found? Try another way - this works with Nutanix StorageControllers (maybe more)
			// We look for an XL record with:
			//	remoteId = classic.uuid
			//	displayName is a substring of the classic displayName
			if (uuids.length === 0) {
				xlDb.query(`
					select uuid
					from entities
					where className = ?
					and ? like ('%'||displayName||'%') and remoteId = ?
					and remoteId <> ""
				`, [m.className, m.displayName, m.uuid]).forEach(row2 => {
					uuids.push(row2.uuid);
				});
			}

			if (uuids.length > 1) {
				warning(sprintf("   Warning: multiple entities '%v::%v'%v found", cn, dn, rid2 ? " ("+rid2+")" : ""));
				numSkipped += 1;
			} else if (uuids.length === 0) {
				if (cn === "Application" && dn.match(/^GuestLoad *\[.*?\]$/)) {
					numSkippedGuestLoads += 1;
				} else {
					if (isFromMissingTarget(obj)) {
						warning(sprintf("   Warning: Entity '%v::%v' not discovered (target not migrated)", cn, dn));
						numNoTargets += 1;
					} else {
						warning(sprintf("   Warning: no entity '%v::%v'%v found", cn, dn, rid2 ? " ("+rid2+")" : ""));
					}
				}
				numSkipped += 1;
			} else {
				memberUuids.push(uuids[0]);
			}
		}
	});

	if (numSkippedGuestLoads > 0) {
		warning(sprintf("   Warning: %d 'GuestLoad' dummy application entities skipped (not exposed in XL)", numSkippedGuestLoads));
	}

	var n = countMembers ? parseInt(g.membersCount) : parseInt(g.entitiesCount);
	if (n > 0 && (numNoTargets + numSkippedGuestLoads) >= n) {
		if (n === numNoTargets) {
			warning("   Warning: ALL expected members depend on targets that have not been discovered - group skipped.");
		} else if (n === numSkippedGuestLoads) {
			warning("   Warning: ALL expected members are 'GuestLoads' (not supported in XL) - group skipped.");
		} else {
			warning("   Warning: Group skipped");
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

	var existing = lib.readGroup(xlDb, mapGroupName(g.displayName), xlGroupType);
	if (existing !== null) {
		var m1 = memberUuids || [];
		m1.sort();
		var m2 = existing.memberUuidList || [];
		m2.sort();
		if (m1.join("\n") === m2.join("\n")) {
			if (existing.entitiesCount !== 0 || !saidEmpty) {
				if (numSkipped > 0) {
					if (existing.entitiesCount === 0) {
						warning(sprintf("   Warning: group already exists but is missing %d entit%s",
							numSkipped,
							numSkipped === 1 ? "y" : "ies"
						));
					} else {
						warning(sprintf("   Warning: group already exists, is missing %d entit%s though the other %d match%s",
							numSkipped,
							numSkipped === 1 ? "y" : "ies",
							existing.entitiesCount,
							existing.entitiesCount > 1 ? "" : "es"
						));
					}
				} else {
					success(sprintf("   Success: group already exists and contains the expected %d entit%s",
						parseInt(existing.entitiesCount),
						existing.entitiesCount === 1 ? "y" : "ies"
					));
				}
			}
			lib.saveGroupMapping(xlDb, g.uuid, existing.uuid);
			return;
		}
	}

	var flag = existing === null ? "-create" : "-edit";
	var name = g.displayName.replace(/\\/g, "/");
	var groupDto = {
	    "displayName": name,
	    "groupType": xlGroupType,
	    "isStatic": true,
	    "memberUuidList": memberUuids
	};

	var newGroup = null;
	if (existing === null) {
		try {
			newGroup = client.createGroup(groupDto);
		} catch (ex2) {
			error("   Error: "+(ex2.message.replace(/^HTTP Status: [0-9]+ - (ALREADY_EXISTS: )?/, "")));
			return;
		}
	} else {
		groupDto.uuid = existing.uuid;
		newGroup = client.editGroup(existing.uuid, groupDto);
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
	var xlGroupType = mapGroupClass(groupType);

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
				var e = new Error(sprintf("Cant find entity in classic with uuid '%v'", uuid));
				e.createAsStatic = true;
				throw e;
			}
			xlDb.query("select json from entities where className = ? and displayName = ?", [classicEntity.className, classicEntity.displayName]).forEach(row => {
				xlEntities.push(JSON.parse(row.json));
			});
			if (xlEntities.length < 1) {
				var e2 = new Error(sprintf("Cant find entity '%v::%v' in XL", classicEntity.className, classicEntity.displayName));
				e2.createAsStatic = true;
				throw e2;
			}
			if (xlEntities.length > 1) {
				var e3 = new Error(sprintf("Multiple entities '%v::%v' in XL", classicEntity.className, classicEntity.displayName));
				e3.createAsStatic = true;
				throw e3;
			}
			mappedUuids.push(xlEntities[0].uuid);
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

	var found = false;
	classicDb.query("select json from groups where uuid = ?", [ g.uuid ]).forEach(row => {
		g = JSON.parse(row.json);
		found = true;
	});

	if (!found) {
		error("   Error: group data not found in classicDb.");
		return;
	}

	var countMembers = g.groupType === "BusinessAccount";

	copied[g.uuid] = true;

	var newGroup = {
		"className": g.className,
		"displayName": g.displayName,
		"groupType": mapGroupClass(g.groupType),
		"isStatic": g.isStatic,
		"isCustom": true,
		"logicalOperator": g.logicalOperator,
		"criteriaList": [ ]
	};

	var errors = [ ];
	var copiedAsStatic = false;

	(g.criteriaList || []).forEach(c => {
		try {
			var mapped = mapCriteria(g.groupType, c);
			newGroup.criteriaList.push(mapped);
		} catch (ex) {
			if (ex.createAsStatic) {
				var g2 = {
					className: g.className,
					cloudType: g.cloudType,
					displayName: g.displayName,
					isStatic: true,
					groupType: g.groupType,
					uuid: g.uuid,
					entitiesCount: parseInt(g.entitiesCount),
					membersCount: parseInt(g.membersCount)
				};
				copyStaticGroup(g2, true, ex);
				copiedAsStatic = true;
				return;
			} else {
				errors.push(ex.message);
			}
		}
	});

	if (copiedAsStatic) {
		return;
	}

	errors.sort();
	errors.forEach(e => {
		error("   Error: "+e);
	});
	if (errors.length > 0) {
		return;
	}


	var rtn = client.tbutil("import dynamic group", true, [ "-j", JSON.stringify(newGroup) ]);
	if (rtn.status === 0) {
		var createdGroup = null;
		try {
			createdGroup = JSON.parse(rtn.out);
		} catch(ex) {
			error(sprintf("   Error: failed to create group (%v)", ex.message));
			print(rtn.out); print(rtn.err);
			return;
		}

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
	} else {
		error("   Error: failed to create group");
		print(rtn.out); print(rtn.err);
		return;
	}
}


var showNote1 = false;

function checkStaticGroupExists(g) {
	var xlName = mapGroupName(g.displayName);
	var xlType = mapGroupClass(g.groupType);

	var countMembers = g.groupType === "BusinessAccount";

	printf("\n[%d of %d] Check %v group '%v' (%v) exists\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", xlName, g.groupType);

	var found = lib.readGroup(xlDb, xlName, xlType);
	var entitiesCount = null;
	if (!found) {
		found = client.findByName(g.className, xlName, true);
		if (found.length === 0) {
			warning("   Warning: Group not present in XL (see note #1 at end).");
			showNote1 = true;
			return;
		}
		if (found.length > 1) {
			warning("   Warning: Group name is duplicated in XL.");
			return;
		}
		found = found[0];
		saveGroup(xlDb, found);
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

	var cat = (g.category || "").trimPrefix("GROUP-");
	printf("\n[%d of %d] Migrate %v group '%v' (%v)\n", groupNum, numGroups, parseInt(g.isCustom) ? "custom" : "system", g.displayName, cat || g.groupType);
	if (copied[g.uuid]) {
		success("   Already copied once - skipping");
		return;
	}

	copied[g.uuid] = true;

	if (g.category === "") {
		error("   Error: category should not be empty");
		return;
	}

	var creator = cm.creatorMap[ cat ];

	// if no creator found but this is one of the groups in defaultGroups.csv and it has a creator
	// defined in the group-creation-map file - then apply it now.
	if (creator === undefined) {
		var name = defaultGroupName(g.uuid);
		if (name !== null) {
			creator = cm.defaultGroupsByName[ name.trimPrefix("GROUP-") ];
		}
	}

//	if (creator === undefined) {
//		error(sprintf("   Error: group category %s not supported", cat));
//		println(        "            (unsupported category)");
//		return;
//	}

	if (creator === null || creator === undefined) {
		warning(sprintf("   Warning: %s group changed to be STATIC", cat));
		println(        "            (no dynamic group creator for this category)");
		return copyStaticGroup(g, true);
	}

	var defn = null;
	try {
		defn = creator(g);
	} catch (ex) {
		if (_.isString(ex)) {
			error("    Error: "+ex);
			return;
		}
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
		success("    Success: Group already exists and has expected settings");
		return;
	}

	var rtn = client.tbutil("import dynamic group", true, [ "-j", JSON.stringify(defn) ]);
	if (rtn.status === 0) {
		var newGroup = null;
		try {
			newGroup = JSON.parse(rtn.out);
		} catch (ex) {
			error(sprintf("   Error: failed to create group (%v)", ex.message));
			print(rtn.out); print(rtn.err);
			return;
		}

		saveGroup(xlDb, newGroup);
		lib.saveGroupMapping(xlDb, g.uuid, newGroup.uuid);
		if (newGroup.entitiesCount === 0) {
			if (parseInt(g.entitiesCount) === 0) {
				success("   Success: Empty group created (also empty in classic)");
			} else {
				warning(sprintf("   Warning: Empty group created (but %d entit%s in classic).",
					parseInt(g.entitiesCount),
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		} else {
			success(sprintf("   Success: group created and now contains %d entit%s (%v in classic)",
				parseInt(newGroup.entitiesCount),
				parseInt(newGroup.entitiesCount) === 1 ? "y" : "ies",
				g.entitiesCount
			));
		}
	} else {
		error("   Error: failed to create group");
		print(rtn.out); print(rtn.err);
		return;
	}
}


var sql = `select * from groups_plus where displayName not regexp ? order by order_ desc`;

var groups = classicDb.query(sql, [ lib.nameMap.excluded_group_names_re ]);

var groupCountByName = { };
var duplicates = { };

groups.forEach(g => {
	var name = mapGroupName(g.displayName);
	groupCountByName[name] = groupCountByName[name] || 0;
	groupCountByName[name] += 1;
	if (groupCountByName[name] > 1) {
		duplicates[g.displayName] = true;
	}
});

var errorsAtStart = [ ];
var cantMigrate = { };

var names  = _.keys(groupCountByName);
var groupCountByNames = { };
names.forEach(name => {
	var n = groupCountByName[name];
	groupCountByNames[name.toLowerCase()] = groupCountByNames[name.toLowerCase()] || { };
	groupCountByNames[name.toLowerCase()][name] = n;
});

names = _.keys(groupCountByNames);
names.sort();
var duplicatedGroupNames = { };

names.forEach(name => {
	var num = 0;
	var counts = groupCountByNames[name];
	_.keys(counts).forEach(name2 => { num += counts[name2]; });
	if (num > 1) {
		var shownName = _.keys(counts);
		shownName.sort();
		shownName = shownName[0];
		errorsAtStart.push("");
		errorsAtStart.push(sprintf("Error: group name '%s' is duplicated in Classic - Cant migrate", shownName));
		var ng = parseInt(xlDb.query("select count(*) n from groups where lower(displayName) = lower(?)", [ mapGroupName(shownName) ])[0].n);
		if (ng === 0) {
			errorsAtStart.push("       (and there are no existing groups in XL with that name)");
		} else {
			errorsAtStart.push(sprintf("       (but %d existing groups%s that name in XL)", ng, ng > 1 ? "s have" : " has"));
		}
		_.keys(counts).forEach(name3 => { duplicatedGroupNames[name3] = true; });
	}
});

groups = groups.filter(g => {
	var name = mapGroupName(g.displayName);
	return !duplicatedGroupNames[name];
});

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
	rows.forEach(row => {
		var dn = row.displayName;
		if (dn.length < 60) {
			dn = (dn + "                                                              ").left(60);
		}
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
			failed: failed
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
		preSelected[c.key] = c.selected || c.forced;
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
		copyStaticGroup(g, false);
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
