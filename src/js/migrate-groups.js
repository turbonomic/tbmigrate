// TODO: consider whether there is a faster way to collect all entities than we are using now.

// Usage is: tbscript @xl migrate-static-groups.js {classicDbFile} {xlDbFile}

/* jshint -W119 */
/* globals warning, success, error, note */

var F = require("@/functions");

usage = function() {
	println("");
	println("Usage is:");
	println("");
	println("  tbscript {xl-credentials} migrate-groups.js [-i] {classic-db-file} {xl-db-file}");
	println("");
	exit(2);
};


var args_ = F.extendedOptions("", "i");
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


// =================================================================================

var copied = { };


function copyStaticGroup(g, warn) {
	g = _.deepClone(g);

	if (warn) {
		warning("   Warning: copying as a static group");
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

	var memberUuids = [ ];
	var numSkipped = 0;

	// Get the members of the group in classic.
	var sql = `
		select e.className, e.displayName, e.remoteId, e.parentDisplayName, e.uuid, count(*) n
		from group_members m, entities e
		where m.groupUuid = ?
		and e.uuid == m.entityUuid
		group by e.className, e.displayName, e.remoteId, e.parentDisplayName
	`;

	classicDb.query(sql, [ g.uuid ]).forEach(m => {
		var cn = m.className;
		var dn = m.displayName;

		if (groupClassRe.test(cn)) {
			dn = mapGroupName(dn);
		}

		// for AWS, AZURE and GCP: the remote Ids are differently formatted between classic and XL.
		// -- classic ones look like : azure::VM::d653a2fe-8a55-4796-a25a-a32dcfea4d43
		// -- XL ones look like      : d653a2fe-8a55-4796-a25a-a32dcfea4d43

		var rid1 = m.remoteId || "";
		var rid2 = m.remoteId || "";
		if (rid2.match(/^(aws|azure|gcp)::/)) {
			var r = rid2.split(/::/);
			rid2 = r[r.length-1];
		}

		var pn = m.parentDisplayName || "";

		var n = parseInt(m.n);
		if (parseInt(n) !== 1) {
			warning(sprintf("   Warning: duplicate rows for '%v::%v'%v", cn, dn, rid1 ? (" ("+rid1+")") : ""));
			numSkipped += 1;
		} else {
			// Find the matching member in XL
			var sql2 = `
				select uuid, json
				from entities
				where className = ?
				and displayName = ?
				and (? = "" or remoteId = ? or remoteId = ?)
				and (? = "" or parentDisplayName = ?)
			`;

			var uuids = [ ];
			var xlClassName = mapGroupClass(cn);
			xlDb.query(sql2, [ xlClassName, dn, rid1, rid1, rid2, pn, pn ]).filter(row => {
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

			if (uuids.length > 1) {
				warning(sprintf("   Warning: multiple entities '%v::%v'%v found", cn, dn, rid2 ? " ("+rid2+")" : ""));
				numSkipped += 1;
			} else if (uuids.length === 0) {
				warning(sprintf("   Warning: no entity '%v::%v'%v found", cn, dn, rid2 ? " ("+rid2+")" : ""));
				numSkipped += 1;
			} else {
				memberUuids.push(uuids[0]);
			}
		}
	});

	var saidEmpty = false;
	if (memberUuids.length === 0) {
		if (parseInt(g.entitiesCount) === 0) {
			success("   Success: Empty group created (also empty in classic)");
		} else {
			warning(sprintf("   Warning: Empty group created (but %v entit%s in classic).", g.entitiesCount, parseInt(g.entitiesCount) === 1 ? "y" : "ies"));
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
					warning(sprintf("   Warning: group already exists, is missing %d entit%s though the other %d match%s",
						numSkipped,
						numSkipped === 1 ? "y" : "ies",
						existing.entitiesCount,
						existing.entitiesCount === 1 ? "es" : ""
					));
				} else {
					success(sprintf("   Success: group already exists and contains the expected %v entit%s",
						existing.entitiesCount,
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
		newGroup = client.createGroup(groupDto);
	} else {
		groupDto.uuid = existing.uuid;
		newGroup = client.editGroup(existing.uuid, groupDto);
	}

	saveGroup(xlDb, newGroup);
	lib.saveGroupMapping(xlDb, g.uuid, newGroup.uuid);

	if (newGroup.entitiesCount > 0) {
		success(sprintf("   Success: group created and now contains %d entit%s (%d in classic)",
			newGroup.entitiesCount,
			parseInt(newGroup.entitiesCount) === 1 ? "y" : "ies",
			g.entitiesCount
		));
	}
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

	if (xl.filterCategory !== classic.filterCategory || xl.inputType !== classic.inputType /* || xl.loadOptions !== classic.loadOptions*/) {
//		println(JSON.stringify(xl));
//		println(JSON.stringify(classic));
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
				copyStaticGroup(g2, true);
				copiedAsStatic = true;
				return;
			} else {
				errors.push(ex.message);
			}
		}
	});

	if (newGroup.criteriaList.length === 0 && newGroup.displayName === "Virtual Machines by Hot Add CPU") {
		newGroup.criteriaList = [{
            "caseSensitive": false,
            "entityType": null,
            "expType": "EQ",
            "expVal": "true",
            "filterType": "vmsHotAddCPU",
            "singleLine": false
		}];
	}

	if (newGroup.criteriaList.length === 0 && newGroup.displayName === "Virtual Machines by Hot Add Memory") {
		newGroup.criteriaList = [{
            "caseSensitive": false,
            "entityType": null,
            "expType": "EQ",
            "expVal": "true",
            "filterType": "vmsHotAddMemory",
            "singleLine": false
		}];
	}

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
		if (createdGroup.entitiesCount === 0) {
			if (parseInt(g.entitiesCount) === 0) {
				success("   Success: Empty group created (also empty in classic)");
			} else {
				warning(sprintf("   Warning: Empty group (but %v entit%s in classic).",
					g.entitiesCount,
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		} else {
			success(sprintf("   Success: group created and now contains %v entit%s (%v in classic)",
				createdGroup.entitiesCount,
				parseInt(createdGroup.entitiesCount) === 1 ? "y" : "ies",
				g.entitiesCount
			));
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
	if (found.entitiesCount === 0) {
		if (parseInt(g.entitiesCount) === 0) {
			success("   Success: Empty group exists and is empty (also empty in classic)");
		} else {
			warning(sprintf("   Warning: Empty group exists (but %v entit%s in classic).",
				g.entitiesCount,
				parseInt(g.entitiesCount) === 1 ? "y" : "ies"
			));
		}
	} else {
		success(sprintf("   Success: group exists and contains %v entit%s (%v in classic)",
			found.entitiesCount,
			parseInt(found.entitiesCount) === 1 ? "y" : "ies",
			g.entitiesCount
		));
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

	var category = g.category.trimPrefix("GROUP-");
	var creator = cm.creatorMap[ category ];

	if (creator === undefined) {
		error(sprintf("   Error: group category %s not supported", category));
		return;
	}

	if (creator === null) {
		warning(sprintf("   Warning: %s group changed to be STATIC", category));
		return copyStaticGroup(g, true);
	}

	var defn = creator(g);

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
				warning(sprintf("   Warning: Empty group created (but %v entit%s in classic).",
					g.entitiesCount,
					parseInt(g.entitiesCount) === 1 ? "y" : "ies"
				));
			}
		} else {
			success(sprintf("   Success: group created and now contains %v entit%s (%v in classic)",
				newGroup.entitiesCount,
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
groups.forEach(g => {
	var name = mapGroupName(g.displayName);
	groupCountByName[name] = groupCountByName[name] || 0;
	groupCountByName[name] += 1;
});

var nErrors = 0;

var names  =_.keys(groupCountByName);
names.sort();
names.forEach(n => {
	if (groupCountByName[n] > 1) {
		nErrors += 1;
		error(sprintf("Error: group name '%s' is duplicated in Classic - Not migrated", n));
		var ng = parseInt(xlDb.query("select count(*) n from groups where displayName = ?", [ mapGroupName(n) ])[0].n);
		if (ng === 0) {
			error("       (and there are no existing groups in XL with that name)");
		} else {
			error(sprintf("       (but %d existing groups%s that name in XL)", ng, ng > 1 ? "s have" : " has"));
		}
		println("");
	}
});

groups = groups.filter(g => {
	var name = mapGroupName(g.displayName);
	return groupCountByName[name] === 1;
});

groups.sort((a, b) => {
	var aa = a.displayName.toLowerCase();
	var bb = b.displayName.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});

if (args_.i) {
	if (nErrors > 0) {
		while (true) {
			var yn = null;
			try {
				yn = readLine("Continue anyway (y/n)? ");
			} catch (ex) {
				if (ex.message !== "EOF") {
					throw ex;
				}
			}
			println("");
			if (yn === null || yn.toLowerCase().hasPrefix("n")) {
				exit(1);
			}
			if (yn.toLowerCase().hasPrefix("y")) {
				break;
			}
			println("Retry.. please enter 'y' or 'n'");
		}
	}

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
	
	
	var rows = _.deepClone(groups);
	rows.forEach(row => {
			var dn = row.displayName;
			if (dn.length < 60) {
				dn = (dn + "                                                              ").left(60);
			}
			var prompt = sprintf(
				"%s - %v[-] - [yellow]%d entities[-]",
				dn,
				parseInt(row.isStatic) ? "[green]Static " : "[purple]Dynamic",
				parseInt(row.entitiesCount)
			);

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
	
			selection.choices.push({
				key: row.uuid,
				value: prompt,
				selected: preSelectedFound === false || preSelected[row.uuid],
				forced: forced,
				message: message
			});
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
		preSelected[c.key] = c.selected;
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

groups.forEach(g => {
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
