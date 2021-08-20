exports.nameMap = JSON.parse(
	loadText("name-map.json").
		filter( line => { return line.match(/^\s*\/\//) ? "" : line; }).
		join(" ").
		replace(/\/\*.*?\*\//g, "")
	);


exports.nameMap.excluded_group_names_re = exports.nameMap.excluded_group_names_res.join("|");
exports.nameMap.target_cooker_script_lib = { };
_.keys(exports.nameMap.target_cooker_script_map).forEach(typ => {
	exports.nameMap.target_cooker_script_lib[typ] = require("./" + exports.nameMap.target_cooker_script_map[typ]);
});

var groupClassRe = new RegExp(exports.nameMap.group_class_re);

// =====================================================================================
// Strings for the names of the two instances (for branding).

exports._classic = getenv("branding_classic") || "Classic";
exports._xl      = getenv("branding_xl") || "XL";
exports._vendor  = getenv("branding_vendor") || "Turbonomic";

exports.cookString = function(str) {
	var map = {
		xl: exports._xl,
		classic: exports._classic,
		vendor: exports._vendor
	};
	return str.template(map, {});
};

// =====================================================================================

exports.isAGroup = function(e) {
	return groupClassRe.test(e.className);
};

// =====================================================================================

exports.createMetaDataTable = function(db) {
	db.exec("create table metadata (name, json)");
	db.exec("create unique index name on metadata ( name )");
};


exports.saveMetaData = function(db, name, json) {
	db.exec("replace into metadata values (?, ?)", [
		name,
		JSON.stringify(json)
	]);
};

// =====================================================================================

exports.createSupplyChainTable = function(db) {
	db.exec("create table supplychain (envType, type, count, active, normal, minor, major, critical)");
	db.exec("create unique index type on supplychain ( envType, type )");
};

exports.saveSupplyChain = function(db, envType, type, count, active, normal, minor, major, critical) {
	db.exec("replace into supplychain values (?,?,?,?,?,?,?,?)", [ envType, type, count, active, normal, minor, major, critical ]);
};

// =====================================================================================

exports.createEntityTable = function(db) {
	db.exec("create table entities (className, uuid, displayName, remoteId, parentDisplayName, environmentType, json)");
	db.exec("create unique index entity_uuid on entities ( uuid )");
};

exports.saveEntity = function(db, e) {
	if (!e.remoteId) {
		var id = (e.vendorIds || {})[(e.discoveredBy || {}).displayName || "==="];
		if (id) {
			e.remoteId = id;
		} else if (e.vendorIds) {
			var ids = { };
			_.keys(e.vendorIds || {}).forEach(k => {
				ids[e.vendorIds[k]] = true;
			});
			ids = _.keys(ids);
			if (ids.length === 1) {
				e.remoteId = ids[0];
			}
		}
	}

	if (e.discoveredBy) {
		db.query("select name from targets where uuid = ?", [ e.discoveredBy.uuid ]).forEach(row => {
			e.discoveredBy.name = row.name;
		});
	}

	db.exec("replace into entities values (?, ?, ?, ?, ?, ?, ?)", [
		e.className,
		e.uuid,
		e.displayName,
		e.remoteId || "",
		e.parentDisplayName || "",
		e.environmentType,
		JSON.stringify(e)
	]);
};

exports.readEntity = function(db, className, displayName) {
	var n = 0;
	var rtn = null;

	db.query(`select json from entities where className = ? and displayName = ?`, [className, displayName]).forEach(row => {
		n += 1;
		rtn = JSON.parse(row.json);
	});

	if (n !== 1) {
		return null;
	}

	return rtn;
};

// =====================================================================================

exports.createGroupCriteriaTable = function(db) {
	db.exec(`
		create table group_criteria (className, elements, filterCategory, filterType, inputType, loadOptions)
	`);
};


exports.saveGroupCriteria = function(db, className, criteria) {
	db.exec(`replace into group_criteria values (?, ?, ?, ?, ?, ?)`,[
		className,
		criteria.elements,
		criteria.filterCategory,
		criteria.filterType,
		criteria.inputType,
		criteria.loadOptions || ""
	]);
};

// =====================================================================================

exports.createGroupTables = function(db) {
	db.exec(`
		create table groups (
			className, uuid, displayName, groupType, environmentType,
			isStatic, isCustom, isDiscovered, entitiesCount, membersCount, order_, why,
			discoveredBy,
			json
		)
	`);
	db.exec("create unique index group_uuid on groups ( uuid )");

	db.exec(`create table xlGroups (uuid, sourceUuid, json)`);
	db.exec("create unique index all_group_uuid on xlGroups ( uuid )");


//	db.exec(`create table v1groups (uuid, className, name, displayName)`);
//	db.exec(`create unique index v1group_uuid on v1groups ( uuid )`);

	db.exec(`create table group_uuid_mapping (classicUuid, xlUuid, step)`);
	db.exec("create unique index group_uuid_mapping_idx on group_uuid_mapping (classicUuid)");

	db.exec(`create table group_category (uuid, category)`);
	db.exec(`create unique index group_category_uuid on group_category ( uuid )`);
};

exports.saveGroup = function(db, g, order, why) {
	var rtn = db.exec("replace into groups values (?, ?, ?, ?, ?, ?, ?, ?, cast(? as int), cast(? as int), cast(? as int), ?, ?, ?)",[
		g.className,
		g.uuid,
		g.displayName,
		g.groupType,
		g.environmentType,
		g.isStatic,
		g.isCustom,
		(g.discoveredBy || g.source )? true : false,
		g.entitiesCount,
		g.membersCount,
		order,
		why.join(", "),
		(((g.discoveredBy || {}).uuid) || ((g.source || {}).uuid)) || "",
		JSON.stringify(g)
	]);
};

// We have to get ALL groups from XL so that we can validate whether discovery is complete or not. We save them
// in a separate table to avoid tangling the logic with the main selected groups table.
exports.saveXlGroup = function(db, g) {
	var rtn = db.exec("replace into xlGroups values (?, ?, ?)",[
		g.uuid,
		g.source ? g.source.uuid : (g.discoveredBy ? g.discoveredBy.uuid : null),
		JSON.stringify(g)
	]);
};

/*
exports.saveApiV1Group = function(db, g) {
	db.exec("replace into v1groups values (?, ?, ?, ?)", [
		g.uuid, g.creationClassName, g.name, g.displayName
	]);
};
*/

exports.saveGroupMapping = function(db, classicUuid, xlUuid, step) {
	db.exec("replace into group_uuid_mapping values(?, ?, ?)", [ classicUuid, xlUuid, step ]);
};

exports.saveGroupCategory = function(db, uuid, category) {
	db.exec("replace into group_category values(?, ?)", [ uuid, category ]);
};


//==============================================================================================================
// For groups we need to create, but salt the name to de-duplicate, this maps the classic UUID to the
// needed XL name. This excludes groups that we expect to pre-exist.

exports.getGroupNameMap = function(db) {
	var nameMap = { };

	var sql = `
		select uuid, displayName, count(*)n
		from groups_plus
		where not (isCustom = 0 and isStatic = 1 and category is null)
		group by displayName
	`;

	db.query(sql).forEach(row => {
		var n = parseInt(row.n);
		if (n === 1) {
			// nameMap[row.uuid] = row.displayName;
		} else if (n > 1) {
			var sql2 = `
				select uuid, nameWithTarget, count(*)n
				from groups_plus
				where displayName = ? and nameWithTarget <> displayName
				group by nameWithTarget
			`;
			db.query(sql2, [row.displayName]). forEach(row2 => {
				var n2 = parseInt(row2.n);
				if (n2 === 1) {
					nameMap[row2.uuid] = row2.nameWithTarget;
				}
			});
		}
	});
	return nameMap;
};


// =====================================================================================

exports.createGroupMembersTable = function(db) {
	db.exec("create table group_members (groupUuid, entityUuid)");
	db.exec("create index group_member_group_uuid on group_members (groupUuid)");
	db.exec("create index group_member_entity_uuid on group_members (entityUuid)");
	db.exec("create unique index group_member_index on group_members (groupUuid, entityUuid)");
};

exports.saveGroupMembership = function(db, groupUuid, memberUuid) {
	db.exec("replace into group_members values (?, ?)", [ groupUuid, memberUuid ]);
};

// =====================================================================================

exports.dropProbeTables = function(db) {
	db.exec("drop table if exists target_specs");
	db.exec("drop table if exists target_spec_fields");
};

exports.createProbeTables = function(db) {
	db.exec("create table target_specs (category, type, json)");
	db.exec("create unique index target_specs_index on target_specs (category, type)");

	db.exec("create table target_spec_fields (category, type, fieldName, isSecret, isMandatory, valueType, n, json)");
	db.exec("create unique index target_spec_fields_index on target_spec_fields (category, type, fieldName)");
};

exports.saveProbe = function(db, p) {
	db.exec("replace into target_specs values (?, ?, ?)", [
		p.category,
		p.type,
		JSON.stringify(p)
	]);

	var n = 0;
	p.inputFields.forEach(f => {
		n += 1;
		db.exec("replace into target_spec_fields values (?, ?, ?, ?, ?, ?, ?, ?)", [
			p.category,
			p.type,
			f.name,
			f.isSecret,
			f.isMandatory,
			f.valueType,
			n,
			JSON.stringify(f)
		]);
	});
};


// Does the target exist?
exports.probeExists = function(db, name, type) {
	db.query("select count(*) n from targets where lower(name) = lower(?) and type = ?", [name, type]).forEach(row => {
		got = parseInt(row.n);
	});
	return got > 0;
};


// =====================================================================================

exports.createTargetTables = function(db) {
	db.exec("create table targets (category, type, uuid, displayName, name, isScoped, json)");
	db.exec("create unique index target_uuid on targets ( uuid )");

	db.exec("create table derived_targets (category, type, uuid, displayName, name, isScoped, json)");
	db.exec("create unique index derived_target_uuid on derived_targets ( uuid )");

	db.exec("create table target_scopes (targetUuid, fieldName, groupUuid, found)");

	// This is used when migrating to IWO
	db.exec("create table target_uuid_mapping (classicUuid, xlUuid)");
};


exports.getTargetName = function(t) {
	var names = [ ];
	var fields = { };

	(t.inputFields || []).forEach(f => {
		if (f.isTargetDisplayName) {
			names.push(f.value);
		}
		fields[f.name] = f.value;
	});

	names.sort();

	var name = names.join(", ");
	// Check IWO options
	try { if (!name) { name = t.iwoInfo.Name; } } catch(ex) { }
	try { if (!name) { name = t.iwoInfo.Connections[0].ManagementAddress; } } catch(ex) { }

	// Standard options
	if (!name) { name = fields.address; }
	if (!name) { name = fields.nameOrAddress; }
	if (!name) { name = fields.targetId; }
	if (!name) { name = fields.targetIdentifier; }
	if (!name && t.displayName) { name = t.displayName; }

	// Some more IWO options
	if (!name) { name = fields.name; }
	if (!name) { name = fields.enrollmentNumber; }

	// last resort - use the UUID
	if (!name) { name = t.uuid; }

	return name;
};


exports.isTargetScoped = function(t) {
	var isScoped = false;

	(t.inputFields || []).forEach( field => {
		if (field.valueType === "GROUP_SCOPE") {
			isScoped = true;
		}
	});

	return isScoped;
};

// Is the target scoped (for given target uuid)?
exports.targetIsScopedByUuid = function(db, uuid) {
	var isScoped = null;
	var name = null;
	db.query("select isScoped, name from targets where uuid = ?", [uuid]).forEach(row => {
		isScoped = parseInt(row.isScoped) !== 0;
		name = row.name;
	});
	return isScoped;
};

exports.saveTarget = function(db, t) {
	db.exec("replace into targets values (?, ?, ?, ?, ?, ?, ?)", [
		t.category,
		t.type,
		t.uuid,
		t.displayName,
		this.getTargetName(t),
		this.isTargetScoped(t),
		JSON.stringify(t)
	]);
};


exports.saveDerivedTarget = function(db, t) {
	db.exec("replace into derived_targets values (?, ?, ?, ?, ?, ?, ?)", [
		t.category,
		t.type,
		t.uuid,
		t.displayName,
		this.getTargetName(t),
		this.isTargetScoped(t),
		JSON.stringify(t)
	]);
};


exports.saveTargetScope = function(db, targetUuid, fieldName, groupUuid, found) {
	db.exec("insert into target_scopes values (?, ?, ?, ?)", [
		targetUuid,
		fieldName,
		groupUuid,
		found
	]);
};



// Does the target exist?
exports.targetExists = function(db, name, type) {
	db.query("select count(*) n from targets where lower(name) = lower(?) and type = ?", [name, type]).forEach(row => {
		got = parseInt(row.n);
	});
	return got > 0;
};


// These is used when migrating to IWO
exports.clearTargetMapping = function(db) {
	db.exec("delete from target_uuid_mapping");
};

exports.saveTargetMapping = function(db, classicUuid, xlUuid) {
	db.exec("replace into target_uuid_mapping values(?, ?)", [ classicUuid, xlUuid ]);
};


// =====================================================================================

exports.createTargetExtraTable = function(db) {
	db.exec("create table targets_extra (uuid, displayName, validationStatus, discoveryOk, hidden, derived, dependsOn, accountValues, json)");
	db.exec("create unique index target_extra_uuid on targets_extra ( uuid )");
};

exports.saveTargetExtra = function(db, t) {
	var values = { };
	(t.targetAccountValues || []).forEach(v => {
		values[v["-field"]] = v["-value"];
	});

	if (values.password === undefined && (t.credentials || {})["-password"] !== undefined) {
		values.password = t.credentials["-password"];
	}

	db.exec("replace into targets_extra values (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
		t["-uuid"],
		t["-displayName"] || t["-name"] || t["-nameOrAddress"],
		t["-lastValidationStatus"],
		t["-discoverySucceeded"],
		t["-hidden"],
		t["-derived"],
		t["-dependsOn"] || "",
		JSON.stringify(values),
		JSON.stringify(t)
	]);
};


// =====================================================================================

exports.createSettingsPolicyTables = function(db) {
	db.exec("create table settings_types (isDefault, entityType, uuid, displayName, json)");
	db.exec("create unique index settings_type_uuid on settings_types ( uuid )");

	db.exec("create table settings_scopes (typeUuid, groupUuid)");
	db.exec("create unique index settings_scopes_uuid on settings_scopes (typeUuid, groupUuid)");

    db.exec("create table settings_managers (typeUuid, uuid, category, displayName, json)");
    db.exec("create unique index settings_manager_uuid on settings_managers ( typeUuid, uuid )");

    db.exec("create table settings (typeUuid, managerUuid, uuid, displayName, value, valueType, json)");
    db.exec("create unique index settings_uuid on settings ( typeUuid, managerUuid, uuid )");

	db.exec(`create table settings_uuid_mapping (classicUuid, xlUuid)`);
	db.exec("create unique index settings_uuid_mapping_idx on settings_uuid_mapping (classicUuid)");
};

exports.saveSettingsPolicy = function(db, t, verbose) {
	db.exec("replace into settings_types values (?, ?, ?, ?, ?)", [
		t.default,
		t.entityType,
		t.uuid,
		t.displayName,
		JSON.stringify(t)
	]);

	db.exec("delete from settings_scopes where typeUuid = ?", [t.uuid]);
	db.exec("delete from settings_managers where typeUuid = ?", [t.uuid]);
	db.exec("delete from settings where typeUuid = ?", [t.uuid]);

	(t.scopes || []).forEach(s => {
		if (verbose) { print("."); }
		db.exec("replace into settings_scopes values (?, ?)", [
			t.uuid,
			s.uuid
		]);
	});

    (t.settingsManagers || []).forEach(m => {
        var mm = _.deepClone(m);
        delete mm.settings;
        if (verbose) { print("*"); }
        db.exec("replace into settings_managers values (?, ?, ?, ?, ?)", [
                t.uuid,
                m.uuid,
                m.category,
                m.displayName,
                JSON.stringify(mm)
        ]);
        (m.settings || []).forEach(s => {
                if (verbose) { print("."); }
                db.exec("replace into settings values (?, ?, ?, ?, ?, ?, ?)", [
                        t.uuid,
                        m.uuid,
                        s.uuid,
                        s.displayName,
                        s.value,
                        s.valueType,
                        JSON.stringify(s)
                ]);
        });
    });
};


exports.saveSettingsMapping = function(db, classicUuid, xlUuid) {
	db.exec("replace into settings_uuid_mapping values(?, ?)", [ classicUuid, xlUuid ]);
};


exports.disableAllActions = function(client_, db) {
	var ok = false;
	db.query(`select json from settings_types where entityType = "ServiceEntity" and isDefault = 1`).forEach(row => {
		var s = JSON.parse(row.json);
		s.settingsManagers.
			filter(m => { return m.uuid === "automationmanager"; })[0].
			settings.
			forEach(s => { 
				if (s.uuid === "disableAllActions") {
					s.value = "true";
					ok = true;
				}
			});
		if (ok) {
			client_.editSettingsPolicy(s.uuid, {}, s);
			exports.saveSettingsPolicy(db, s, false);
		}
	});
};

// =====================================================================================

exports.createPlacementPolicyTables = function(db) {
	db.exec("create table placement_policies (commodityType, uuid, name, displayName, type, json)");
	db.exec("create unique index placement_policy_uuid on placement_policies ( uuid )");

	db.exec("create table policy_scopes (policyUuid, groupUuid, scopeType)");
	db.exec("create unique index policy_scopes_uuid on policy_scopes (policyUuid, groupUuid)");

	db.exec(`create table policy_uuid_mapping (classicUuid, xlUuid)`);
	db.exec("create unique index policy_uuid_mapping_idx on policy_uuid_mapping (classicUuid)");
};

exports.savePlacementPolicy = function(db, p, verbose) {
	var cachePolicyScope = function(policyUuid, groupUuid, type) {
		if (verbose) { print("."); }
		db.exec("replace into policy_scopes values (?, ?, ?)", [ policyUuid, groupUuid, type ]);
	};

	db.exec("replace into placement_policies values (?, ?, ?, ?, ?, ?)", [
		p.commodityType,
		p.uuid,
		p.name,
		p.displayName,
		p.type,
		JSON.stringify(p)
	]);

	(p.mergeGroups || []).forEach(g => {
		cachePolicyScope(p.uuid, g.uuid, "merge");
	});
	if (p.consumerGroup) {
		cachePolicyScope(p.uuid, p.consumerGroup.uuid, "consumer");
	}
	if (p.baseProviderGroup) {
		cachePolicyScope(p.uuid, p.baseProviderGroup.uuid, "provider");
	} else if (p.providerGroup) {
		cachePolicyScope(p.uuid, p.providerGroup.uuid, "provider");
	}
};

exports.savePlacementPolicyMapping = function(db, classicUuid, xlUuid) {
	db.exec("replace into policy_uuid_mapping values(?, ?)", [ classicUuid, xlUuid ]);
};

// =====================================================================================

exports.createPolicyGroupUuidsView = function(db) {
	db.exec(`
		create view policy_group_uuids as select distinct * from (
			select groupUuid from policy_scopes
			union select groupUuid from settings_scopes
			union select uuid from groups where isCustom = 1 and isStatic = 1
		)
	`);
};

// =====================================================================================

exports.createTemplateTable = function(db) {
	db.exec("create table templates (className, uuid, displayName, discovered, json)");
	db.exec("create unique index template_uuid on templates (uuid)");

	db.exec(`create table template_uuid_mapping (classicUuid, xlUuid)`);
	db.exec("create unique index template_uuid_mapping_idx on template_uuid_mapping (classicUuid)");
};

exports.saveTemplate = function(db, t) {
	db.exec("replace into templates values (?, ?, ?, ?, ?)", [
		t.className,
		t.uuid,
		t.displayName,
		t.discovered,
		JSON.stringify(t)
	]);
};

exports.saveTemplateMapping = function(db, classicUuid, xlUuid) {
	db.exec("replace into template_uuid_mapping values(?, ?)", [ classicUuid, xlUuid ]);
};

// =====================================================================================

exports.createScheduleTable = function(db) {
	db.exec("create table schedules (className, uuid, displayName, json)");
	db.exec("create unique index schedule_uuid on schedules (uuid)");
};

exports.saveSchedule = function(db, s) {
	db.exec("replace into schedules values (?, ?, ?, ?)", [
		s.className,
		s.uuid,
		s.displayName,
		JSON.stringify(s)
	]);
};

// =====================================================================================

exports.createUserTables = function(db) {
	db.exec("create table users (uuid, name, displayName, provider, role, type, passwordHash, json)");
	db.exec("create unique index user_uuid on users (uuid)");

	db.exec("create table user_groups (uuid, displayName, role, type, json)");
	db.exec("create unique index user_group_uuid on user_groups (uuid)");

	db.exec("create table user_scopes (userUuid, groupUuid)");
	db.exec("create unique index user_scopes_uuid on user_scopes (userUuid, groupUuid)");

	db.exec("create table user_group_scopes (userGroupUuid, groupUuid)");
	db.exec("create unique index user_group_scopes_uuid on user_group_scopes (userGroupUuid, groupUuid)");
};

exports.saveUser = function(db, u) {
	db.exec("replace into users values (?, ?, ?, ?, ?, ?, ?, ?)", [
		u.uuid,
		u.username,
		u.displayName,
		u.loginProvider,
		u.roleName,
		u.type,
		u.passwordHash,
		JSON.stringify(u)
	]);

	db.exec("delete from user_scopes where userUuid = ?", [u.uuid]);

	(u.scope || []).forEach(s => {
		db.exec("replace into user_scopes values (?, ?)", [u.uuid, s.uuid]);
	});
};

exports.saveUserGroup = function(db, g) {
	db.exec("replace into user_groups values (?, ?, ?, ?, ?)", [
		g.uuid,
		g.displayName,
		g.roleName,
		g.type,
		JSON.stringify(g)
	]);

	(g.scope || []).forEach(s => {
		db.exec("replace into user_group_scopes values (?, ?)", [g.uuid, s.uuid]);
	});
};

// =====================================================================================

exports.readGroup = function(db, displayName, groupType) {
	var rows = db.query(`select json from groups where displayName = ? and groupType = ?`, [ displayName, groupType]);
	if (!rows || rows.length === 0) {
		rows = db.query(`select json from groups where displayName = ? and groupType = "Unknown" and membersCount = 0`, [ displayName]);
	}
	if (!rows || rows.length !== 1) {
		return null;
	}
	return JSON.parse(rows[0].json);
};

// does the group exist? If so -- return the uuid[s]
exports.groupExists = function(db, displayName, groupType) {
	var rtn = { };
	db.query(`select uuid from groups where displayName = ? and groupType = ?`, [ displayName, groupType]).forEach(row => {
		rtn[row.uuid] = true;
	});
	rtn = _.keys(rtn);
	rtn.sort();
	return rtn.length === 0 ? null : rtn;
};

exports.getMemberTypes = function(db, groupUuid) {
	var sql = `
		select distinct e.uuid, e.className
		from group_members m, entities e
		where m.groupUuid = ? and e.uuid = m.entityUuid
	`;
	var classes = { };
	var children = [ ];
	db.query(sql, [ groupUuid ]).forEach(row => {
		classes[row.className] = true;
	});
	return _.keys(classes);
};

exports.getEntityTypes = function(db, groupUuid) {
	var sql = `
		select distinct e.uuid, e.className
		from group_members m, entities e
		where m.groupUuid = ? and e.uuid = m.entityUuid
	`;
	var classes = { };
	var children = [ ];
	db.query(sql, [ groupUuid ]).forEach(row => {
		if (groupClassRe.test(row.className)) {
			exports.getEntityTypes(db, row.uuid).forEach(t => {
				classes[t] = true;
			});
		} else {
			classes[row.className] = true;
		}
	});
	return _.keys(classes);
};

// =====================================================================================

exports.shouldCountMembers = function(g) {
	return [ "BusinessAccount", "ResourceGroup", "DataCenter" ].contains(g.groupType);
};


exports.mapGroupClass = function(cn) {
	return exports.nameMap.class_name_map[cn] || cn;
};


exports.mapGroupName = function(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
};


exports.isPhysicalMachine = function(db, name) {
	var classes = db.query("select distinct className from entities where name = ?", [name]).map(row => { return row.className; });
	return classes.length === 1 &&  classes[0] === "PhysicalMachine";
};


// given a classic entity object, find the matching one in XL ..
exports.findEntityInXl = function(classicDb, xlDb, nameMap, e) {
	if (e.json) {
		e = JSON.parse(e.json);
	}

	// WMI applications have no key in common between XL and classic so we need to resort to parsing out the display name.
	if (e.className === "Application" && (e.discoveredBy || {}).type === "WMI") {
		var m = e.displayName.match(/^(.*?)\[(.*?)\]$/);
		if (m && m.length === 3) {
			var vmName = m[2];
			var appName = m[1];
			var wmiFound = [ ];
			xlDb.query("select uuid, json from entities where displayName like (? || ' ' || ? || ' [%]')", [appName, vmName]).forEach(row => {
				var obj2 = JSON.parse(row.json);
				if (
					(obj2.discoveredBy || {}).type === "WMI" &&
					obj2.className === "ApplicationComponent" &&
					(obj2.providers || []).length === 1 &&
					obj2.providers[0].className === "VirtualMachine" &&
					obj2.providers[0].displayName === vmName
				) {
					wmiFound.push(obj2);
				}
			});
			if (wmiFound.length === 1) {
				return wmiFound[0];
			}
		}
	}

	// for AWS, AZURE and GCP: the remote Ids are differently formatted between classic and XL.
	// -- classic ones look like : azure::VM::d653a2fe-8a55-4796-a25a-a32dcfea4d43
	// -- XL ones look like      : d653a2fe-8a55-4796-a25a-a32dcfea4d43

	var rid1 = e.remoteId || "";	// orignal, undoctored remote ID
	var rid2 = e.remoteId || "";	// potentially cleaned up remote ID

	if (rid2.match(/^(aws|azure|gcp)::/)) {
		var r = rid2.split(/::/);
		rid2 = r[r.length-1];
	}

	var xlDispName = nameMap[e.uuid] || e.displayName;
	var xlClass = exports.mapGroupClass(e.className);

	if (exports.isAGroup(e)) {
		xlDispName = exports.mapGroupName(xlDispName);
	}

	// basic match - by class, displayName and remoteId
	var sql = "select * from entities where className = ? and displayName = ? and (remoteId in (?, ?) or className = 'Cluster')";
	var found = xlDb.query(sql, [xlClass, xlDispName, rid1 || "", rid2 || ""]);
	if (found.length === 1) {
		return JSON.parse(found[0].json);
	}

	// Maybe there are multiple remoteIds
	if (found.length === 0 && _.keys(e.vendorIds || {}).length > 0) {
		// Naive match: if ANY of the remoteId values listed for classic are found in XL's list then that's good enough.
		// we dont expect the target names to match (because they dont, often enough to cause trouble).

		var remoteIdMatch = function(row) {
			var rtn = false;
			var obj = JSON.parse(row.json);
			var xlIds = _.values(obj.remoteId || {});
			var classicIds = _.values(e.remoteId || {});
			classicIds.forEach(id => { rtn = rtn | xlIds.contains(id); });
			return rtn;
		};

		var found3 = xlDb.query("select json from entities where className = ? and displayName = ?", [xlClass, xlDispName]).filter(remoteIdMatch);
		if (found3.length === 1) {
			return JSON.parse(found3[0].json);
		}
	}

	// Disambiguate ResourceGroups using the parent name
	if (found.length > 1 && e.className === "ResourceGroup" && e.parentDisplayName) {
		var found4 = found.filter(f => {
			var obj = JSON.parse(f.json);
			return obj.parentDisplayName && obj.parentDisplayName === e.parentDisplayName;
		});
		if (found4.length === 1) {
			return found4[0];
		}
	}

	// Get the targetUuid and name in classic

	var classicTargetUuid = (e.discoveredBy || e.source || {}).uuid;

	// "special case" logic for Azure accounts..

	if (!classicTargetUuid && e.className === "BusinessAccount" && e.cloudType === "AZURE" && (e.targets || []).length === 1 && e.targets[0].type === "Azure") {
		classicTargetUuid = e.targets[0].uuid;
	}

	// Find the target name in classic

	var classicTargetName = null;
	var xlTargetName = null;
	var xlTargetUuid = null;
	var xlTargetStatus = null;

	if (classicTargetUuid) {
		// determine the target name in classic

		classicDb.query("select name from targets where uuid = ?", [classicTargetUuid]).forEach(row => {
			classicTargetName = row.name;
		});
		if (!classicTargetName) {
			classicDb.query("select name from derived_targets where uuid = ?", [classicTargetUuid]).forEach(row => {
				classicTargetName = row.name;
			});
		}

		// if XL is IWO, then we could have the manually editted mapping table to try first..
		xlDb.query("select xlUuid from target_uuid_mapping where classicUuid = ?", [classicTargetUuid]).forEach(row => {
			xlTargetUuid = row.xlUuid;
		});

		if (xlTargetUuid) {
			xlDb.query("select name, json from targets where uuid = ?", [xlTargetUuid]).forEach(row => {
				xlTargetName = row.name;
				xlTargetStatus = JSON.parse(row.json).status;
			});
		} else {
			if (classicTargetName) {
				xlDb.query("select uuid, json from targets where lower(name) = ?", [classicTargetName.toLowerCase()]).forEach(row => {
					xlTargetUuid = row.uuid;
					xlTargetStatus = JSON.parse(row.json).status;
				});
				if (!xlTargetUuid) {
					xlDb.query("select uuid, json from derived_targets where lower(name) = ?", [classicTargetName.toLowerCase()]).forEach(row => {
						xlTargetUuid = row.uuid;
						xlTargetStatus = JSON.parse(row.json).status;
					});
				}
			}
		}
	}

	// If more than one entity found, try to disambiguate using the name of the related target.
	if (found.length > 1 && xlTargetUuid !== null) {
		var filtered = found.filter(entity => {
			var obj = JSON.parse(entity.json);
			var u = (obj.discoveredBy || obj.source || {}).uuid;
			return xlTargetUuid === u;
		});

		if (filtered.length === 1) {
			return JSON.parse(filtered[0].json);
		}
	}


	// Still no match - try to match the uuid in class against the remoteId in XL
	var found2 = xlDb.query(`select * from entities where className = ? and json like ('%"' || ? || '"%')`, [xlClass, e.uuid]);
	found2 = found2.filter(entity => {
		var obj = JSON.parse(entity.json);
		return (obj.remoteId === e.uuid);
	});

	if (found2.length === 1) {
		return JSON.parse(found2[0].json);
	}


	// Still no match - try the Cluster special case where the name is two parts delimited by a slash in classic but
	// only the 2nd part is used in XL.
	if (xlClass === "Cluster" && !e.$clusterNameHackFlag) {
		var f = xlDispName.split("/");
		if (f.length === 2) {
			var e2 = _.deepClone(e);
			e2.displayName = f[1];
			e2.$clusterNameHackFlag = true;
			return this.findEntityInXl(classicDb, xlDb, nameMap, e2);
		}
	}

	if (xlTargetStatus && xlTargetName && xlTargetStatus !== "Validated") {
		var err0 = new Error(sprintf("Entity '%s::%s' not found (target '%s' not validated)", xlClass, xlDispName, xlTargetName));
		err0.noTarget = true;
		throw err0;
	} else if (xlTargetStatus && classicTargetName && xlTargetStatus !== "Validated") {
		var err1 = new Error(sprintf("Entity '%s::%s' not found (target '%s' not validated)", xlClass, xlDispName, classicTargetName));
		err1.noTarget = true;
		throw err1;
	} else if (xlTargetName && !xlTargetUuid) {
		var err6 = new Error(sprintf("Entity '%s::%s' not found (target '%s' not migrated)", xlClass, xlDispName, xlTargetName));
		err6.noTarget = true;
		throw err6;
	} else if (classicTargetName && !xlTargetUuid) {
		var err2 = new Error(sprintf("Entity '%s::%s' not found (target '%s' not migrated)", xlClass, xlDispName, classicTargetName));
		err2.noTarget = true;
		throw err2;
	} else if (e.className === "Storage" && (e.discoveredBy || {}).type === "Azure") {
		var err4 = new Error(sprintf("Entity '%s::%s' not found (Azure Storage objects not implemented in %s)", xlClass, xlDispName, exports._xl));
		err4.unsupported = true;
		throw err4;
	} else if (e.className === "Application" && e.displayName.hasPrefix("GuestLoad")) {
		var err5 = new Error(sprintf("Entity '%s::%s' not found (GuestLoad objects not implemented in %s)", xlClass, xlDispName, exports._xl));
		err5.unsupported = true;
		throw err5;
	} else {
		var err3 = new Error(sprintf("Entity '%s::%s' not found", xlClass, xlDispName));
		err3.noTarget = false;
		throw err3;
	}
};

// =====================================================================================

exports.getInstancesOfType = function(client_, types, func) {
	var opts = { types: types.join(",") };
	return client_.paginate("getSearchResults", opts, func);
};

exports.getInstancesUsingQuery = function(client_, envType, types, q, func) {
	if (client_._byNameCriteria === null) {
		client_._byNameCriteria = { };
		var data = client_.getGroupBuilderUsecases();
		var classes = _.keys(data);
		classes.forEach(t => {
			data[t].criteria.forEach(c => {
				if (c.filterType.hasSuffix("ByName")) {
					client_._byNameCriteria[t] = c.filterType;
				}
			});
		});
	}

	var count = 0;

	types.forEach(type => {
		var filterType = client_._byNameCriteria[type];
		if (!filterType) {
			throw new Error("getInstancesUsingQuery: unsupported type: "+type);
		}

		var filter = {
			caseSensitive: true,
			expType: "RXEQ",
			expVal: q,
			filterType: filterType
		};

		var body = {
			criteriaList: [filter],
			logicalOperator: "AND",
			className: type
		};

		var opts = {
			ascending: true,
			limit: 400,
		};

		var enums = client_.getMembersBasedOnCriteria.apiInfo.queryArgs.order_by.enum;
		if (enums.contains("name")) {
			opts.order_by = "name";
		} else if (enums.contains("NAME")) {
			opts.order_by = "NAME";
		} else {
			throw new Error("cant find supported 'order_by' value");
		}

		count += client_.paginate("getMembersBasedOnCriteria", opts, body, func);
	});

	return count;
};

exports.findInstance = function(client_, type, name) {
	var found = [ ];
	this.getInstancesUsingQuery(client_, null, [ type ], name.quoteRegexpMeta(true), e => {
		found.push(e);
	});
	return found.length === 1 ? found[0] : null;
};


// =====================================================================================
// Define some global functions.

// jshint -W117, -W020

var titleNum = 1;
var subTitleNum = 1;

title = function(str) {
	colour("magenta", "bold");
	printf("%d: %s", titleNum ++, str);
	colour();
	println();
	subTitleNum = 1;
};

titleOf = function(num, str) {
	colour("magenta", "bold");
	printf("[%d of %d]: %s", titleNum ++, num, str);
	colour();
	println();
	subTitleNum = 1;
};

subtitle = function(str) {
	colour("magenta", "bold");
	printf("%d.%d: %s", titleNum-1, subTitleNum++, str);
	colour();
	println();
};

error = function(str) {
	colour("hiRed");
	print(str);
	colour();
	println();
};

success = function(str) {
	colour("hiGreen");
	print(str);
	colour();
	println();
};

warning = function(str) {
	colour("hiYellow");
	print(str);
	colour();
	println();
};

warning2 = function(str) {
	colour("hiMagenta");
	print(str);
	colour();
	println();
};

note = function(str) {
	colour("hiCyan");
	print(str);
	colour();
	println();
};

woops = function(str) {
	error(str);
	exit(2);
};

bar = function() {
	colour("hiCyan");
	print("|");
	colour();
};

hash = function() {
	colour("hiCyan");
	print("#");
	colour();
};
