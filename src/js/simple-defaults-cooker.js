// Change the contents of fieldsByName and classicFields to make what XL expects ...

exports.cook = function(fieldsByName, classicFields, xlFields, classicDb, xlDb, type) {
	_.keys(xlFields).forEach(f => {
		if (fieldsByName[f] === undefined) {
			var spec = null;
			xlDb.query("select json from target_specs where type = ?",[type]).forEach(row => {
				spec = JSON.parse(row.json);
			});
			if (spec && spec.inputFields) {
				spec.inputFields.forEach(fld => {
					if (fld.name === f && fld.defaultValue !== undefined) {
						fld.value = fld.defaultValue;
						fieldsByName[f] = fld;
						classicFields[f] = {
							n: _.keys(classicFields).length,
							type: fld.valueType
						};
					}
				});
			}
		}
	});

	// A commonly-needed hack for targets that change "nameOrAddress" to "address".
	if (
		fieldsByName.nameOrAddress && !fieldsByName.address &&
		classicFields.nameOrAddress && !classicFields.address &&
		!xlFields.nameOrAddress && xlFields.address
	) {
		fieldsByName.address = fieldsByName.nameOrAddress;
		fieldsByName.address.name = "address";
		delete fieldsByName.nameOrAddress;

		classicFields.address = classicFields.nameOrAddress;
		delete classicFields.nameOrAddress;
	}
};
