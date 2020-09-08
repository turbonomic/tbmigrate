exports.nameMap = JSON.parse(loadText("name-map.json").join("\n").replace(/\n/g, " ").replace(/\/\*.*?\*\//g, ""));

exports.nameMap.target_cooker_script_lib = { };
_.keys(exports.nameMap.target_cooker_script_map).forEach(typ => {
	exports.nameMap.target_cooker_script_lib[typ] = require("./" + exports.nameMap.target_cooker_script_map[typ]);
});

var groupClassRe = new RegExp(exports.nameMap.group_class_re);

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
	if (!e.remoteId && e.vendorIds) {
		var dn = (e.discoveredBy || {}).displayName;
		var rid = undefined;
		if (dn) {
			rid = (e.vendorIds || {})[dn];
		}
		if (!rid) {
			rid = _.values(e.vendorIds).join(",");
		}
		e.remoteId = rid;
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
			isStatic, isCustom, isDiscovered, entitiesCount, membersCount, order_,
			json
		)
	`);
	db.exec("create unique index group_uuid on groups ( uuid )");

//	db.exec(`create table v1groups (uuid, className, name, displayName)`);
//	db.exec(`create unique index v1group_uuid on v1groups ( uuid )`);

	db.exec(`create table group_uuid_mapping (classicUuid, xlUuid)`);
	db.exec("create unique index group_uuid_mapping_idx on group_uuid_mapping (classicUuid)");

	db.exec(`create table group_category (uuid, category)`);
	db.exec(`create unique index group_category_uuid on group_category ( uuid )`);
};

exports.saveGroup = function(db, g, order) {
	var rtn = db.exec("replace into groups values (?, ?, ?, ?, ?, ?, ?, ?, cast(? as int), cast(? as int), cast(? as int), ?)",[
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

exports.saveGroupMapping = function(db, classicUuid, xlUuid) {
	db.exec("replace into group_uuid_mapping values(?, ?)", [ classicUuid, xlUuid ]);
};

exports.saveGroupCategory = function(db, uuid, category) {
	db.exec("replace into group_category values(?, ?)", [ uuid, category ]);
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

// =====================================================================================

exports.createTargetTables = function(db) {
	db.exec("create table targets (category, type, uuid, displayName, name, isScoped, json)");
	db.exec("create unique index target_uuid on targets ( uuid )");
	db.exec("create table target_scopes (targetUuid, fieldName, groupUuid, found)");

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

	var name = names.join(", ");
	if (!name) { name = fields.address; }
	if (!name) { name = fields.nameOrAddress; }
	if (!name) { name = fields.targetId; }
	if (!name) { name = fields.targetIdentifier; }

	if (!name && t.displayName) { name = t.displayName; }

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


exports.saveTargetScope = function(db, targetUuid, fieldName, groupUuid, found) {
	db.exec("insert into target_scopes values (?, ?, ?, ?)", [
		targetUuid,
		fieldName,
		groupUuid,
		found
	]);
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

// if (t["-uuid"] === "_1FAH0Lx9Eeq386z7t8Gr_g") { debugger; }

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


exports.disableAllActions = function(client, db) {
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
			client.editSettingsPolicy(s.uuid, {}, s);
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
