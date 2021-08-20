// Change the contents of fieldsByName and classicFields to make what XL expects ...

exports.cook = function(fieldsByName, classicFields, xlFields, classicDb, xlDb, type) {
	if (classicFields.iamRole.type === "STRING" && xlFields.iamRole.type === "BOOLEAN") {
		fieldsByName.iamRole.valueType = "BOOLEAN";
		fieldsByName.iamRole.displayName = "IAM Role";

		fieldsByName.iamRoleArn = {
			displayName: "IAM Role ARN",
			isSecret: false,
			valueType: "STRING",
			name: "iamRoleArn"
		};

		classicFields.iamRoleArn = {
			n: _.keys(classicFields).length,
			type: "STRING"
		};

		if (fieldsByName.iamRole.value === undefined) {
			fieldsByName.iamRoleArn.value = null;
			fieldsByName.iamRole.value = "false";
		} else {
			fieldsByName.iamRoleArn.value = fieldsByName.iamRole.value;
			fieldsByName.iamRole.value = "true";
		}
	}

	if (xlFields.proxyHost && !xlFields.proxy && !classicFields.proxyHost && classicFields.proxy) {
		var renameField = function(x, c) {
			classicFields[x] = _.deepClone(classicFields[c]);
			delete classicFields[c];

			fieldsByName[x] = _.deepClone(fieldsByName[c]);
			delete fieldsByName[c];
			fieldsByName[x].name = x;
		};
		renameField("proxyHost", "proxy");
		renameField("proxyPort", "port");
		renameField("proxyUsername", "proxyUser");
		classicFields.secureProxy = {
			n: _.keys(classicFields).length,
			type: "BOOLEAN"
		};
		fieldsByName.secureProxy = {
			displayName: "Secure Proxy",
			name: "secureProxy",
			value: "false",
			valueType: "BOOLEAN",
			isSecret: false
		};
	}

	// patch up any remaining, missing, defaultable settings

	var cooker = require("./simple-defaults-cooker.js");
	cooker.cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, type, true);
};
