// Change the contents of fieldsByName and classicFields to make what XL expects ...

exports.cook = function(fieldsByName, classicFields, xlFields, classicDb, xlDb) {
	// Targets with "targetEntities" group scope (should probably be a configuration item, really)
	if (fieldsByName.targetEntities && fieldsByName.targetEntities.valueType === "GROUP_SCOPE") {
		var found = false;
		var numEntities = null;
		xlDb.query(`select xlUuid from group_uuid_mapping where classicUuid = ?`, [fieldsByName.targetEntities.value]).forEach(row => {
			fieldsByName.targetEntities.value = row.xlUuid;
			found = true;
			xlDb.query(`select entitiesCount from groups where uuid = ?`, [ row.xlUuid ]).forEach(row2 => {
				numEntities = parseInt(row2.entitiesCount);
			});
		});

		if (!found) {
			throw new Error("Cant find the required scope group in XL");
		}

		if (numEntities === null) {
			throw new Error("Cant determine size of scope group");
		}

		if (numEntities === 0) {
			throw new Error("Scope group is empty in XL");
		}
	}
};
