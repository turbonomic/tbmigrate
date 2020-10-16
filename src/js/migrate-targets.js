// NB: Targets that need group scopes cant be created until the groups have been created.
//     However: we need to create the main targets BEFORE we can create groups.
//     Hence: this script will need to be run twice.
//			once, ignorning scoped targets
//			then: the migrate-groups scipt should be run
//			then again: handling scoped targets. (if there are any to migrate)

/* jshint -W083, -W080, -W061 */
/* globals title, titleOf, error, warning, success, note */

var lib = require("./libmigrate.js");
var F = require("@/functions");

function E(x) { return x || {}; }


usage = function() {
	println("");
	println("Usage is:");
	println("");
	println("  tbscript {xl-credentials} migrate-targets.js [options] {classic-db-file} {xl-db-file}");
	println("");
	println("  where options is any combination of:");
	println("     -include-scoped-targets");
	println("     -delete-failed");
	println("     -deselect-by-default");
	println("");
	exit(2);
};

var args_ = F.extendedOptions("", "include-scoped-targets", "delete-failed", "deselect-by-default", "count-only");
if (args_.remaining.length !== 2) {
	usage();
}


if (!client.isXL()) {
	woops("This is not an XL instance");
}

var namePrefix = "MIGRATED-";

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args_.remaining[0]+"?mode=ro");
var xlDb = P.open("file:"+args_.remaining[1]+"?mode=rw");

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator" && userInfo.roleName.toLowerCase() !== "site_admin") {
	woops("Must be run by a user with Turbonomic administrator rights");
}

var scopeCooker = require("./scope-cooker.js");


// Refresh the list of known probe types (in case the user has added some using "Helm" since we last collected data).

lib.dropProbeTables(xlDb);
lib.createProbeTables(xlDb);

client.getProbes().forEach(p => {
	lib.saveProbe(xlDb, p);
});


// Check that the target types that "Classic" uses are known to XL. It may be that the user needs to edit the
// "Helm chart" and create the relevant mediation PODs, and then come back here.

var nSkipped = 0;
var nKubeTurbo = 0;
var numSkippedScoped = 0;
var targets = [ ];

var selected = { };
xlDb.exec("create table if not exists target_selection (uuid, flag)");
xlDb.query("select * from target_selection").forEach(row => {
	selected[row.uuid] = parseInt(row.flag) === 1;
});


function getTargetFields(db, category, type) {
	var rtn = { };
	db.query("select * from target_spec_fields where category = ? and type = ?", [ category, type ]).forEach(fieldRow => {
		rtn[fieldRow.fieldName] = {
			"n": parseInt(fieldRow.n),
			"type": fieldRow.valueType,
			"secret": parseInt(fieldRow.isSecret) !== 0,
			"default": JSON.parse(fieldRow.json).defaultValue
		};
	});
	return rtn;
}


var selection = { title: "Select the targets to migrate", choices: [] };

// Get the UUIDs of derived targets so that we can exclude then from the list of selectable ones.
var derived = { };
classicDb.query("select json from targets").forEach(row => {
	var t = JSON.parse(row.json);
	(t.derivedTargets || []).forEach(d => {
		derived[d.uuid] = true;
	});
});


function targetDetailsMatch(name, type) {
	var classicTarget = null;
	var numClassicTargets = 0;
	classicDb.query("select * from targets where lower(name) = lower(?) and type = ?", [name, type]).forEach(row => {
		classicTarget = JSON.parse(row.json);
		classicTarget.name = row.name;
		numClassicTargets += 1;
	});

	if (numClassicTargets > 1) {
		return "Multiple matching targets found in classic";
	} else if (numClassicTargets === 0) {
		return "No matching targets found in classic";
	}

	var xlTarget = null;
	var numXlTargets = 0;
	xlDb.query("select * from targets where lower(name) = lower(?) and type = ?", [name, type]).forEach(row => {
		xlTarget = JSON.parse(row.json);
		xlTarget.name = row.name;
		numXlTargets += 1;
	});

	if (numXlTargets > 1) {
		return "Multiple matching targets found in XL";
	} else if (numXlTargets === 0) {
		return "No matching targets found in XL";
	}


	var classicFieldInfo = getTargetFields(classicDb, classicTarget.category, classicTarget.type);
	var xlFieldInfo = getTargetFields(xlDb, xlTarget.category, xlTarget.type);

	var classicFields = { };
	classicTarget.inputFields.forEach(f => {
		if (!f.isSecret) {
			f.known = classicFieldInfo[f.name] !== undefined;
			f.default = (classicFieldInfo[f.name] || {}).default;
			classicFields[f.name] = f;
		}
	});

	var xlFields = { };
	xlTarget.inputFields.forEach(f => {
		if (!f.isSecret) {
			f.known = xlFieldInfo[f.name] !== undefined;
			f.default = (xlFieldInfo[f.name] || {}).default;
			xlFields[f.name] = f;
		}
	});


	var mismatches = [ ];

	_.keys(xlFields).forEach(name => {
		if (
			(xlFields[name] || {}).known && (classicFields[name] || {}).known && 
			xlFields[name].valueType === classicFields[name].valueType &&
			xlFields[name].valueType !== "GROUP_SCOPE"
		) {
			var xlValue = xlFields[name].value;
			if (xlValue === undefined) { xlValue = xlFields[name].default; }

			var classicValue = classicFields[name].value;
			if (classicValue === undefined) { classicValue = classicFields[name].default; }

			if (
				xlFields[name].valueType === "STRING" &&
				(xlFields[name].value || "").toLowerCase() === (xlTarget.name || "").toLowerCase() &&
				(xlFields[name].value || "").toLowerCase() === (classicFields[name].value || "").toLowerCase()
			) {
				// special case which we accept. The string is the name which we tollerate sloppy case matching
				// on.
			} else {
				// otherwise, it has to be exact
				if (classicValue !== xlValue && classicValue !== undefined) {
					mismatches.push(name);
				}
			}
		}
	});

	if (mismatches.length === 0) {
		return null; // nothing bad to remport
	}

	mismatches.sort();
	return "Exists in XL but details differ from classic ("+mismatches.join(", ")+")";
}


var numMismatchedTargets = 0;

classicDb.query("select distinct uuid, category, type, displayName, name, isScoped, json from targets order by category, type").forEach(row => {
	// Filter out derived targets ..
	if (derived[row.uuid]) { return; }

	// Filter out kubeturo etc
//	if (row.category === "Cloud Native" && row.type.hasPrefix("Kubernetes")) { return; }
//	if (row.category === "Cloud Native" && row.type.hasPrefix("TerraForm")) { return; }

	var sel = selected[row.uuid];
	if (sel === undefined && args_["deselect-by-default"]) {
		sel = false;
	}

	var choice = {
		key: row.uuid,
		value: "[blue]" + row.category + "[white] - [green]" + row.type + "[white] - " + row.name,
		selected: sel !== false,
		skipped: false,	// true means: tell the user about this target, but he/she cant select it
		message: "[green]Target can be migrated",
		exclude: false,	// true means: no point even mentioning this to the user in the selector
		later: false
	};

	if (!row.category) {
		nSkipped += 1;
		choice.skipped = true;
		choice.message = "Missing category name";
		choice.category = "<unknown category>";
	}

	if (row.category === "Cloud Native" && row.type.hasPrefix("Kubernetes")) {
		nSkipped += 1;
		nKubeTurbo += 1;
		choice.skipped = true;
		choice.failed = true;
		choice.message = "[orange::b]ACTION SUGGESTED[-::-] - KubeTurbo targets should be reconfigured manually";
	}

	if (row.category === "Cloud Native" && row.type.hasPrefix("TerraForm")) {
		nSkipped += 1;
		choice.failed = true;
		choice.skipped = true;
		choice.message = "[orange::b]ACTION SUGGESTED[-::-] - TerraForm targets should be reconfigured manually";
	}

	selection.choices.push(choice);
	targets.push(row);

	var got = 0;

/////////////////////////////////////////////////////////////////////////////////
// TODO - Should we use the derived name instead ?
/////////////////////////////////////////////////////////////////////////////////

	// convert the displayName presented by classic to what we'd see for a matching target in XL.
	var fn = E(lib.nameMap.standardize_target_display_name[row.type]).js;
	var dispName = row.displayName;
	if (fn) {
		var _fn_;
		fn = eval("_fn_ = " + fn);
		dispName = _fn_(dispName);
	}

	if (lib.targetExists(xlDb, row.name, row.type)) {
		var msg = targetDetailsMatch(row.name, row.type);
		if (msg === null) {
			choice.message = sprintf("[orange::b]EXSITS[-::-] - Target already exists in XL");
			choice.selected = false;
			choice.skipped = true;
			choice.exclude = true;
			row.$EXCLUDE = true;
		} else {
			choice.message = sprintf("[red::b]ACTION REQUIRED[-::-] - "+msg);
			choice.selected = false;
			choice.skipped = true;
			choice.exclude = true;
			choice.failed = true;
			row.$EXCLUDE = true;
			numMismatchedTargets += 1;
		}
		return;
	}

//	if (parseInt(row.isScoped) === 1 && !args_["include-scoped-targets"]) {
//		nSkipped += 1;
//		numSkippedScoped += 1;
//		choice.message = "[orange::b]MIGRATE LATER[-::-] - Target is scoped (the opportunity to migrate it comes AFTER groups are migrated)";
//		choice.selected = false;
//		choice.skipped = true;
//		choice.exclude = false;
//		choice.later = true;
//		return;
//	}

	var classicTarget = JSON.parse(row.json);
	var classicFields = getTargetFields(classicDb, row.category, row.type);

	var n = 0;
	var foundCategory = null;
	xlDb.query("select count(*) n, category from target_specs where type = ?", [row.type]).forEach(row => {
		n = parseInt(row.n);
		foundCategory = row.category;
	});

	if (n > 1) {
		nSkipped += 1;
		choice.message = "Ambiguous target category";
		choice.selected = false;
		choice.skipped = true;
		return;
	}


	if (n === 0 && !choice.skipped) {
		nSkipped += 1;
		choice.message = sprintf("[orange::b]ACTION SUGGESTED[-::-] - Mediation pod for Target type '%s::%s' is not configured in XL", row.category, row.type);
		choice.selected = false;
		choice.skipped = true;
		choice.failed = true;
		return;
	}

	if (classicTarget.status !== "Validated" && !choice.skipped) {
		nSkipped += 1;
		choice.message = sprintf("[orange::b]ACTION SUGGESTED[-::-] - Target validation failed in Classic");
		choice.selected = false;
		choice.skipped = true;
		choice.failed = true;
		return;
	}

	if (parseInt(row.isScoped) === 1 && !args_["include-scoped-targets"]) {
		nSkipped += 1;
		numSkippedScoped += 1;
		choice.message = "[orange::b]MIGRATE LATER[-::-] - Target is scoped (the opportunity to migrate it comes AFTER groups are migrated)";
		choice.selected = false;
		choice.skipped = true;
		choice.exclude = false;
		choice.later = true;
		return;
	}

	var xlFields = getTargetFields(xlDb, foundCategory, row.type);

	var fieldsByName = { };
	(classicTarget.inputFields || []).forEach(f => {
		fieldsByName[f.name] = f;
	});


	// If there is a target-specific cooker script defined, then use it now to convert
	// the classic target fields to what XL expects.
	try {
		if (lib.nameMap.target_cooker_script_lib[row.type]) {
			lib.nameMap.target_cooker_script_lib[row.type].cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, row.type);
		}
	} catch (ex) {
		choice.message = ex.message;
		choice.selected = false;
		choice.skipped = true;
		return;
	}

	var notInClassic = [ ];
	_.keys(xlFields).forEach(x => {
		if (!["STRING", "BOOLEAN", "NUMERIC", "GROUP_SCOPE"].contains(xlFields[x].type)) {
			notInClassic.push(x);
		} else {
			if (classicFields[x] === undefined) {
				notInClassic.push(x);
			}
		}
	});

	if (notInClassic.length > 0 && !choice.skipped) {
		notInClassic.sort();
		choice.message = sprintf("XL Field%s unknown to classic for '%s::%s' - %s", notInClassic.length > 1 ? "s" : "", foundCategory, row.type, notInClassic.join(", "));
		choice.selected = false;
		choice.skipped = true;
		return;
	}

//	selection.choices.push(choice);
//	targets.push(row);
});

// selection.choices = selection.choices.filter(c => { return c.exclude ? false : true; });
// targets = targets.filter(t => { return t.$EXCLUDE ? false : true; });

if (args_["count-only"]) {
	var count = 0;
	selection.choices.forEach(s => {
		if (s.exclude === false && s.skipped === false) {
			count +=1;
		}
	});
	if (count === 0 && numMismatchedTargets === 0) {
		lib.saveMetaData(xlDb, "migrate_targets_end_time", "" + (new Date()));
		exit(111);	// migrate_targets not needed
	}

	exit(0);
}


var choosable = selection.choices.filter(c => { return c.exclude ? false : true; });

if (choosable.length === 0) {
	warning("No targets need migration");
	lib.saveMetaData(xlDb, "migrate_targets_end_time", "" + (new Date()));
	exit(1);
}


// Allow user to select any groups to be skipped or included.
if (getenv("AUTO_SELECT_ALL_TARGETS") !== "true") {
	var f = tempFile(JSON.stringify(selection));
	try {
		print("<SELECTOR_START>\r                     \r");
		commandPipe("./select", [f.path()]);
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

	if (numMismatchedTargets > 0) {
		warning("***************************************************************************************");
		warning(sprintf("WARNING: %d targets in XL have configurations that dont match their classic equivalents", numMismatchedTargets));
		warning("***************************************************************************************");
		println("");
		println("We strongly advise correcting these issues in XL before proceeding.");
		println("");
		println("Do you wish to disregard this warning and continue none the less?");
		while (true) {
			var yn = readLine("Enter 'y' or 'n': ");
			if (yn === "n") {
				exit(22);
			}
			if (yn === "y") {
				break;
			}
		}
	}
}


var count = 0;
selected = { };


// Allow for the fact that AWS target has been split into two in XL. There is now
// a separate "Billing" target. At this point, we detect a target for which a
// related billing target is needed and just clone the existing classic target into
// our work list, marked with a "$BILLING" tag (which gets handled later).

var addedBillingTargets = 0;
var index = -1;
selection.choices.forEach(ch => {
	index += 1;

	if (ch.selected && !ch.skipped && !ch.$BILLING) {
		var g = null;
		classicDb.query("select json from targets where uuid = ?", [ch.key]).forEach(row => {
			g = JSON.parse(row.json);
		});

		var billingType = lib.nameMap.split_billing_targets[g.type || "BAD"];
		if (billingType) {
			var fields = { };
			g.inputFields.forEach(f => { fields[f.name] = f.value; });

			var billingTargetNeeded = false;
			billingType.fields.forEach(f => {
				if (fields[f]) { billingTargetNeeded = true; }
			});

			if (billingTargetNeeded) {
				var billingTarget = _.deepClone(targets[index]);
				billingTarget.$BILLING = billingType;
				targets.push(billingTarget);

				var billingChoice = _.deepClone(ch);
				billingChoice.$BILLING = billingType;
				selection.choices.push(billingChoice);

				addedBillingTargets += 1;
			}
		}
	}
});


selection.choices.forEach(ch => {
	if (!ch.skipped) {
		xlDb.exec("replace into target_selection values (?, ?)", [ ch.key, ch.selected ]);
		if (ch.selected) {
			count += 1;
			selected[ch.key] = true;
		}
	}
});

if (count === 0) {
	lib.saveMetaData(xlDb, "migrate_targets_end_time", "" + (new Date()));
	woops("No targets are selected for migration");
}

printf("%v target%s selected for migration\n", count - addedBillingTargets, (count - addedBillingTargets) === 1 ? "" : "s");
if (addedBillingTargets > 0) {
	printf("%v related billing target%s added\n", addedBillingTargets, addedBillingTargets === 1 ? "" : "s");
}


// Disable ALL actions in XL - for safety.
lib.disableAllActions(client, xlDb);


// Iterate over the selected targets
targets.forEach(row => {

	// If the user un-ticked the target, then skip over it

	if (!selected[row.uuid]) {
		return;
	}

	var n = 0;
	var foundCategory = null;
	var xlType = row.type;
	if (row.$BILLING) {
		xlType = row.$BILLING.type;
	}

	xlDb.query("select count(*) n, category from target_specs where type = ?", [xlType]).forEach(row => {
		n = parseInt(row.n);
		foundCategory = row.category;
	});

	if (n !== 1) {
		return;
	}

	var classicFields = getTargetFields(classicDb, row.category, row.type);
	var xlFields = getTargetFields(xlDb, foundCategory, xlType);

	// Turn the target's fields from classic into a JS object for easy access later.
	var classicTarget = JSON.parse(row.json);
	var fieldsByName = { };
	(classicTarget.inputFields || []).forEach(f => {
		fieldsByName[f.name] = f;
	});

	// If there is a target-specific cooker script defined, then use it now to convert
	// the classic target fields to what XL expects.
	try {
		if (lib.nameMap.target_cooker_script_lib[row.type]) {
			lib.nameMap.target_cooker_script_lib[row.type].cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, row.type);
		} else if (parseInt(row.isScoped) === 1) {
			scopeCooker.cook(fieldsByName, classicFields, xlFields, classicDb, xlDb, row.type);
		}
	} catch (ex) {
		error(ex.message);
		return;
	}

	// Get an ordered list of field names
	var xlFieldNames = _.keys(xlFields);
	xlFieldNames.sort((a, b) => {
		if (xlFields[a].n < xlFields[b].n) { return -1; }
		if (xlFields[a].n > xlFields[b].n) { return 1; }
		return 0;
	});

	// The "keepTrying" flag is use to control the loop that allows the user to retry the creation
	// if the password had been entered interatively.

	var keepTrying = true;

	while (keepTrying) {
		// The DTO we're going to push to XL.
		var xlTarget = {
			category: foundCategory,
			inputFields: [],
			readonly: classicTarget.readonly,
			type: xlType
		};

		// Get the encryption key, if we know it.
		var encryptionKey = null;
		classicDb.query(`select json from metadata where name = "vmt_helper_data"`).forEach(meta => {
			encryptionKey = JSON.parse(meta.json);
		});

		// And copy it (if known) to the target creation DTO.
		if (encryptionKey) {
			xlTarget.inputFields.push({
				"name": "encryptionKey",
				"value": encryptionKey
			});
		}

		// did the user answer any questions?
		var interactive = false;

		// has the DTO got any secret fields?
		var hasEncryptedFields = false;

		println("");
		titleOf(count, sprintf("%s::%s -- '%s'\n", foundCategory, xlType, row.displayName));

		// Fill out the inputFields of the DTO

		var addField = function(name, secret, value, n) {
			xlTarget.inputFields.push({
				"name": name,
				"isSecret": secret,
				"value": value
			});
		};

		xlFieldNames.forEach(fld => {
			var f = fieldsByName[fld];

			if (classicFields[fld] === undefined) {

				error(sprintf("Field '%s' in XL target '%s::%s' not defined in classic\n", fld, foundCategory, xlType));
				return;

			} else if (f.isSecret) {

				// CASE 2 - The field is part of the classic DTO and is flagged as "secret"

				var values = { };
				classicDb.query("select accountValues from targets_extra where uuid = ?", [ row.uuid ]).forEach(a => {
					values = JSON.parse(a.accountValues);
				});

				if (encryptionKey) {
					hasEncryptedFields = true;
					if (values[f.name]) {
						printf("%-40.40s = ***************\n", f.displayName);
						addField(f.name, true, values[f.name], 1);
					} else {
						printf("%-40.40s = <null>\n", f.displayName);
						addField(f.name, true, null, 2);
					}
				} else {
					interactive = true;
					var prompt = sprintf("%-40.40s : ", f.displayName);
					xlTarget.inputFields.push({
						"name": f.name,
						"isSecret": true,
						"$encrypted": readPassword(prompt, true)
					});
				}
			} else {

				// CASE 3 - The field is supplied in the classic DTO and is not a secret

				if (f.value === null || f.value === undefined) {
					if (!f.isMandatory && f.valueType === "BOOLEAN") {
						printf("%-40.40s = %v\n", f.displayName, "false");
						addField(f.name, false, "false", 3);

					} else if (f.defaultValue !== null && f.defaultValue !== undefined) {
						printf("%-40.40s = %v\n", f.displayName, f.defaultValue);
						addField(f.name, false, f.defaultValue, 4);

					} else {
						printf("%-40.40s = <null>\n", f.displayName);
						addField(f.name, false, null, 5);
					}
				} else {
					if (f._displayValue) {
						printf("%-40.40s = %v (%v)\n", f.displayName, f._displayValue, f.value);
						delete f._displayValue;
					} else {
						printf("%-40.40s = %v\n", f.displayName, f.value);
					}
					addField(f.name, false, f.value, 6);
				}
			}

		});

		var newTarget = null;
		var exception = null;

		xlTarget.inputFields = xlTarget.inputFields.filter(f => { return f.value !== null; });

		client.setTimeout(lib.nameMap.timeouts.create_target);

		if (hasEncryptedFields) {
			try {
				var ep = "/migrations/targets";
				newTarget = client.http.post(ep, { disable_hateos: true }, xlTarget);
			} catch (ex) {
				exception = ex;
			}
		} else {
			try {
				var rtn = client.tbutil("import target", true, [ "-j", "-create", JSON.stringify(xlTarget) ]);
				if (rtn.status === 0) {
					newTarget = JSON.parse(rtn.out);
				} else {
					exception = rtn;
				}
			} catch (ex) {
				exception = ex;
			}
		}

		client.setTimeout("0");

		if (exception && exception.message) {
			if (exception.message.contains("Client.Timeout exceeded")) {
				exception.message = "API Timed out (check/fix the target status using the UI)";

			} else if (exception.message.hasSuffix(" already exists.")) {
				var found = [ ];
				client.getTargets({environment_type: "HYBRID"}).forEach(t => {
					if (t.category === xlTarget.category && t.type === xlTarget.type && lib.getTargetName(t) === lib.getTargetName(xlTarget)) {
						found.push(t);
					}
				});
				if (found.length === 0) {
					exception.message = "API reports 'already exists' but cant find a match";
				} else if (found.length > 1) {
					exception.message = "API reports 'already exists' but found multiple matches";
				} else { // found one
					newTarget = found[0];
				}
			}
		}

		if (newTarget) {
			if (newTarget.status === "Validated") {
				success("\n\u2713 Target Validated");
				keepTrying = false;
				lib.saveTarget(xlDb, newTarget);
			} else if (interactive) {
				println("");
				error("Error: " + newTarget.status);
				println("");

				while (true) {
					var hint = "'k' or 'r' ? ";
					println("How do you want to proceed?");
					println(" k : Keep the target in its failed state.");
					if (args_["delete-failed"]) {
						println(" d : Delete and skip the target.");
						hint = "'k', 'r' or 'd' ? ";
					}
					println(" r : Retry (re-enter the passwords).");
					var choice = readLine(hint).toLowerCase();

					if (choice === "d" && args_["delete-failed"]) {
						try {
							client.deleteTarget(newTarget.uuid);
						} catch (ex) {
							printJson(ex);
						}
						keepTrying = false;
						break;
					}

					if (choice === "r") {
						try {
							client.deleteTarget(newTarget.uuid);
						} catch (ex) {
							printJson(ex);
						}
						keepTrying = true;
						break;
					}

					if (choice === "k") {
						keepTrying = false;
						lib.saveTarget(xlDb, newTarget);
						break;
					}
				}
			} else {
				// non-interactive case - clean up and dont retry
				println("");
				error("Error: "+ newTarget.status);
				println("");
				keepTrying = false;
				if (args_["delete-failed"]) {
					try {
						client.deleteTarget(newTarget.uuid);
					} catch (ex) {
						printJson(ex);
					}
				} else {
					lib.saveTarget(xlDb, newTarget);
				}
			}
		} else {
			error("Error: "+exception.message);
			keepTrying = false;
		}
	}
});


if (!args_["include-scoped-targets"] && getenv("TBMIGRATE_MENU") !== "true") {
	if (numSkippedScoped > 0) {
		note("\nNOTE: There are scoped targets to be migrated once groups are in place.");
		note(  "      You should run 'sh migrate-targets.sh 2' once discovery is complete");
		note(  "      and after migrating the groups using 'sh migrate-groups.sh 1'.");
		note(  "      See the documentation for details.\n");
	}
}

lib.saveMetaData(xlDb, "migrate_targets_end_time", "" + (new Date()));
