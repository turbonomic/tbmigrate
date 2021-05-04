// Change the contents of fieldsByName and classicFields to make what XL expects ...

exports.cook = function(fieldsByName, classicFields, xlFields, classicDb, xlDb, type) {
//	if (classicFields.iamRole.type === "STRING" && xlFields.iamRole.type === "BOOLEAN") {
//		fieldsByName.iamRole.valueType = "BOOLEAN";
//		fieldsByName.iamRole.displayName = "IAM Role";
//
//		fieldsByName.iamRoleArn = {
//			displayName: "IAM Role ARN",
//			isSecret: false,
//			valueType: "STRING",
//			name: "iamRoleArn"
//		};
//
//		classicFields.iamRoleArn = {
//			n: _.keys(classicFields).length,
//			type: "STRING"
//		};
//
//		if (fieldsByName.iamRole.value === undefined) {
//			fieldsByName.iamRoleArn.value = null;
//			fieldsByName.iamRole.value = "false";
//		} else {
//			fieldsByName.iamRoleArn.value = fieldsByName.iamRole.value;
//			fieldsByName.iamRole.value = "true";
//		}
//	}

	// patch up missing, defaultable settings and the scope.

	var cooker1 = require("./simple-defaults-cooker.js");
	var cooker2 = require("./scope-cooker.js");

	cooker1.cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, type, true);

	fieldsByName.targetEntities = _.deepClone(fieldsByName.nameOrAddress);
	classicFields.targetEntities = {
		n: _.keys(classicFields).length,
		type: "GROUP_SCOPE"
	};

	cooker2.cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, type);

	// then patch in the targetId if missing
	if (xlFields.targetId && !classicFields.targetId && !fieldsByName.targetId && classicFields.nameOrAddress && fieldsByName.nameOrAddress) {
		fieldsByName.targetId = {
			displayName: "Target Name",
			isSecret: false,
			valueType: "STRING",
			name: "targetId",
			value: fieldsByName.nameOrAddress.value
		};
		classicFields.targetId = {
			n: _.keys(classicFields).length,
			type: "STRING"
		};
	}
};
