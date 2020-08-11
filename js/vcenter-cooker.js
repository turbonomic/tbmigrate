// Change the contents of fieldsByName and classicFields to make what XL expects ...

exports.cook = function(fieldsByName, classicFields, xlFields, classicDb, xlDb) {
	if (fieldsByName.isStorageBrowsingEnabled === undefined) {

		fieldsByName.isStorageBrowsingEnabled = {
			displayName: "Storage Browsing Enabled",
			isSecret: false,
			valueType: "BOOLEAN",
			name: "isStorageBrowsingEnabled"
		};

		classicFields.isStorageBrowsingEnabled = {
			n: _.keys(classicFields).length,
			type: "STRING"
		};

		classicDb.query(`select distinct value from settings where managerUuid = \"storagesettingsmanager\" and uuid = \"datastoreBrowsing\"`).forEach(row => {
			fieldsByName.isStorageBrowsingEnabled.value = row.value;
		});
	}

	if (fieldsByName.guestMetricsEnabled === undefined) {
		fieldsByName.guestMetricsEnabled = {
			displayName: "Guest metrics enabled",
			isSecret: false,
			valueType: "BOOLEAN",
			name: "guestMetricsEnabled",
			value: "false"
		};

		classicFields.guestMetricsEnabled = {
			n: _.keys(classicFields).length,
			type: "STRING"
		};
	}
};
