// NB: Targets that need group scopes cant be created until the groups have been created.
//     However: we need to create the main targets BEFORE we can create groups.
//     Hence: this script will need to be run twice.
//			once, ignorning scoped targets
//			then: the migrate-groups scipt should be run
//			then again: handling scoped targets. (if there are any to migrate)

/* jshint -W083, -W080, -W061 */
/* globals title, error, warning, success, note */

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

var args_ = F.extendedOptions("", "include-scoped-targets", "delete-failed", "deselect-by-default");
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
if (userInfo.roleName.toLowerCase() !== "administrator") {
	woops("Must be run by a user with Turbonomic administrator rights");
}


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
	db.query("select distinct fieldName, valueType, n from target_spec_fields where category = ? and type = ?", [ category, type ]).forEach(fieldRow => {
		rtn[fieldRow.fieldName] = {"n": parseInt(fieldRow.n), "type": fieldRow.valueType};
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
//		choice.value = "[orange]" + row.category + " - " + row.type + " - " + row.name;
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

	xlDb.query("select count(*) n from targets where name = ?", [row.name]).forEach(row2 => {
		got = parseInt(row2.n);
	});

	if (got > 0) {
		choice.message = sprintf("Target '%s' already exists - skipped\n", row.name);
		choice.selected = false;
		choice.skipped = true;
		choice.exclude = true;
		row.$EXCLUDE = true;
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
//		choice.value = "[orange]" + row.category + " - " + row.type + " - " + row.name;
		return;
	}

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

selection.choices = selection.choices.filter(c => { return c.exclude ? false : true; });
targets = targets.filter(t => { return t.$EXCLUDE ? false : true; });

if (selection.choices.length === 0) {
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
				"value": encryptionKey.join("")
			});
		}

		// did the user answer any questions?
		var interactive = false;

		// has the DTO got any secret fields?
		var hasEncryptedFields = false;

		println("");
		title(sprintf("%s::%s -- '%s'\n", foundCategory, xlType, row.displayName));

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
					printf("%-40.40s = %v\n", f.displayName, f.value);
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
			var rtn = client.tbutil("import target", true, [ "-j", "-create", JSON.stringify(xlTarget) ]);
			if (rtn.status === 0) {
				newTarget = JSON.parse(rtn.out);
			} else {
				exception = rtn;
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
					println(" k : Keep the target in it's failed state.");
					if (args_["delete-failed"]) {
						println(" d : Delete and skip the target.");
						hint = "'k', 'r' or 'd' ? ";
					}
					println(" r : Retry (re-enter the passwords).");
					var choice = readLine(hint).toLowerCase();

					if (choice === "d" && args_["delete-failed"]) {
						client.deleteTarget(newTarget.uuid);
						keepTrying = false;
						break;
					}

					if (choice === "r") {
						client.deleteTarget(newTarget.uuid);
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
					client.deleteTarget(newTarget.uuid);
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
