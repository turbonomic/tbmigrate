/*
	tables that are changed by migrate_targets.js:
		target_selection
		metadata:
			migrate_targets_end_time
			migrate_targets_end_time
		saveTarget( .. )

	targets are mapped by name
*/

var lib = require("./libmigrate.js");
var F = require("@/functions");

var _classic = lib._classic;
var _xl = lib._xl;

usage = function() {
	println("");
	println("Usage is:");
	println("");
	printf ("  tbscript @xl match-targets.js {%s-db-file} {%s-db-file}\n", _classic.toLowerCase(), _xl.toLowerCase());
	println("");
	exit(2);
};

var args_ = F.extendedOptions("");
if (args_.remaining.length !== 2) {
	usage();
}

if (!client.isIWO()) {
	woops("This is not an IWO instance");
}

var namePrefix = "MIGRATED-";

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args_.remaining[0]+"?mode=ro");
var xlDb = P.open("file:"+args_.remaining[1]+"?mode=rw");

// Refresh the list of known probe types (in case the user has added some using "Helm" since we last collected data).

lib.dropProbeTables(xlDb);
lib.createProbeTables(xlDb);

client.getProbes().forEach(p => {
	lib.saveProbe(xlDb, p);
});


function simplify(t) {
	t.json = JSON.parse(t.json);
	t.fields = { };
	t.json.inputFields.forEach(fld => {
		t.fields[fld.name] = fld.value;
	});
}

var classicTargets = [ ];
var classicTargetsByUuid = { };
classicDb.query("select * from targets").forEach(row => {
	simplify(row);
	classicTargets.push(row);
	classicTargetsByUuid[row.uuid] = row;
});

var iwoTargets = [ ];
var iwoTargetsByUuid = { };
xlDb.query("select * from targets").forEach(row => {
	simplify(row);
	iwoTargets.push(row);
	iwoTargetsByUuid[row.uuid] = row;
});

var mapping = { };
xlDb.query("select * from target_uuid_mapping").forEach(row => {
	mapping[row.classicUuid] = row.xlUuid;
});


function findIwoTarget(classic) {
	var found = [ ];

	// Find from existing mapping (if any)
	var mapped = mapping[classic.uuid];
	if (mapped === "-") {
		return null;
	}

	if (mapped) {
		iwoTargets.forEach(t => {
			if (t.uuid === mapped) {
				found.push(t);
			}
		});
		if (found.length === 1) {
			return found[0];
		}
	}

	// Find by name
	found = [ ];
	iwoTargets.forEach(t => {
		if (false && t.name.toLowerCase().trim() === classic.name.toLowerCase().trim()) {
			found.push(t);
		}
	});
	if (found.length === 1) { return found[0]; }

	// 2nd try: find by address and user
	found = [ ];
	iwoTargets.forEach(t => {
		if (((t.json.iwoInfo || {}).Connections ||[]).length === 1) {
			try {
				var user = t.json.iwoInfo.Connections[0].Credential.Username;
				var addr = t.json.iwoInfo.Connections[0].ManagementAddress;
				if (user === classic.fields.username && addr === classic.fields.address) {
					found.push(t);
				}
			} catch (ex) { }
		}
	});
	if (found.length === 1) { return found[0]; }

	return null;
}

var matched = [ ];		// matched (or not) targets

classicTargets.forEach(c => {
	var i = findIwoTarget(c);
	if (i) {
		matched.push({ classic: c, iwo : i});
		c.matched = true;
		i.matched = true;
	} else {
		matched.push({ classic: c });
	}
});

matched.sort((a, b) => {
	var aa = a.classic.name.toLowerCase();
	var bb = b.classic.name.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
});


//================================================================================================
// Code for the curses table-based UI
//================================================================================================

function runForm() {
	var app = null;

	var returnCode = null;

	var helpKeys = "<Up>/<Down>: Scroll , <Return>: Close this help";
	var tableKeys = "<?>: Help,  <Up>/<Down>: Navigate,  <Enter>: Select target,  <ESC>: Exit/Save,  <^C>: Abort";
	var exitKeys = "<s>: Save and exit, <a>: Abort without saving, <ESC> Cancel";
	var selectorKeys = "<Up>/<Down>: Scroll,  <Return>: Select and close,  <ESC> Cancel";

	var blue   = tcell.GetColor("blue");
	var yellow = tcell.GetColor("yellow");
	var white  = tcell.GetColor("white");
	var orange = tcell.GetColor("orange");
	var grey   = tcell.GetColor("grey");
	var black  = tcell.GetColor("black");

	function showKeys(app, text) {
		var mesg = text.replace(/</g, "<[yellow]").replace(/>/g, "[-]>");
		app.$mainGrid.$footer.SetText(mesg);
	}

	function fill(s, w) {
		return s + (" ".repeat(Math.max(0, w - s.length)));
	}

	function center(s, w) {
		var spaces = w - s.length;
		var rtn = " ".repeat(Math.max(0, spaces / 2));
		rtn += s;
		rtn += " ".repeat(Math.max(0, w - rtn.length));
		return rtn;
	}

	function newCell(str, uuid, width) {
		var text = fill(str, width);
		var cell = tview.NewTableCell(fill(text, width));
		cell.SetSelectable(true);
		cell.$uuid = uuid;
		return cell;
	}

	function setCell(table, row, col, cell) {
		table.$cells[sprintf("%d,%d",row, col)] = cell;
		table.SetCell(row, col, cell);
	}

	// use "getCell()" rather than t.GetCell() so that our custom $.. fields are preserved.
	function getCell(table, row, col) {
		return table.$cells[sprintf("%d,%d",row, col)];
	}

	function iwoTargetSelected(table, selector, row) {
		var uuid = getCell(selector, row, 0).$uuid;
		var name = getCell(selector, row, 0).Text.trimSpace().trimPrefix("✓").trimSpace();

		var sel = table.GetSelection();
		var cell = getCell(table, sel[0], 1);

		if (uuid === "none") {
			cell.SetText("-");
			cell.$uuid = "none";
		} else {
			// zap any duplicates that would result
			var nrows = table.GetRowCount();
			for (var r=0; r<nrows; r+=1) {
				var c = getCell(table, r, 1);
				if (c.$uuid === uuid) {
					c.SetText("-");
					cell.$uuid = "none";
				}
			}
			cell.SetText(name);
			cell.$uuid = uuid;
		}

		app.$popup = null;
		app.SetFocus(table);
		showKeys(app, tableKeys);
	}

	function isIwoTargetUsed(table, uuid) {
		var n = table.GetRowCount();
		for (var r=1; r<n; r+=1) {
			var cell = getCell(table, r, 1);
			if (cell.$uuid === uuid) {
				return true;
			}
		}
		return false;
	}

	function iwoTargetSelectorPopup(table, row, col) {
		var windowRect = app.$mainGrid.GetRect();
		var windowWidth = windowRect[2];
		var windowHeight = windowRect[3];
		var width = Math.max(70, windowWidth - 16);
		var height = Math.max(10, windowHeight - 12);
		var classicUuid = getCell(table, row, 0).$uuid;
		var iwoUuid = getCell(table, row, 1).$uuid;
		var cType = classicTargetsByUuid[classicUuid].type;
		var title = ` Select the matching '${cType}' target `;

		var box = tview.NewTable();
		box.$name = "targets";
		box.$cells = { };
		box.SetRect(
			Math.floor((windowWidth - 2 - width) / 2),
			Math.floor(1 + (windowHeight - 2 - height) / 2),
			width + 2, height + 2
		);

		box.SetBorderColor(orange);
		box.SetTitleColor(orange);
		box.SetBorder(true);
		box.SetTitle(title);
		box.SetSelectable(true, true);
		box.SetSelectedFunc((row, col) => { iwoTargetSelected(table, box, row); });

		var strings = [
			box.GetTitle().trimSpace() + 2
		];

		var cells = [ ];
		iwoTargets.forEach(t => {
			if (t.type !== cType) {
				return;
			}
			var colour = white;
			var marker = " ";
			if (t.uuid === iwoUuid) {
				colour = yellow;
				marker = "✓";
			} else if (isIwoTargetUsed(table, t.uuid)) {
				return;
				// colour = grey;
			}
			var wideName = fill(" " + marker + " " + t.name, width);
			var cell = tview.NewTableCell(wideName);
			cell.SetTextColor(colour);
			cell.SetSelectable(true);
			cell.$uuid = t.uuid;
			cells.push(cell);
		});

		cells.sort((a, b) => {
			var aa = a.Text.toLowerCase().substr(3);
			var bb = b.Text.toLowerCase().substr(3);
			if (aa < bb) { return -1; }
			if (aa > bb) { return 1; }
			return 0;
		});

		var blankCell = tview.NewTableCell(" ".repeat(width));
		blankCell.SetSelectable(false);
		blankCell.SetBackgroundColor(black);

		var ct = classicTargetsByUuid[classicUuid];

		var hintCell = tview.NewTableCell(fill(`  Select the ${_xl} target that matches ${_classic} target '${ct.name}' ...`, width));
		hintCell.SetSelectable(false);
		hintCell.SetBackgroundColor(black);
		hintCell.SetTextColor(white);

		var lineCell = tview.NewTableCell("═".repeat(width));
		lineCell.SetBackgroundColor(black);
		lineCell.SetTextColor(orange);
		lineCell.SetSelectable(false);

		setCell(box, 0, 0, blankCell);
		setCell(box, 1, 0, hintCell);
		setCell(box, 2, 0, blankCell);
		setCell(box, 3, 0, lineCell);

//		var noneCell = tview.NewTableCell(fill("   [ NO MATCH ]      <--   select this to dissociate", width));
//		noneCell.SetSelectable(true);
//		noneCell.$uuid = "none";
//		setCell(box, 3, 0, noneCell);

		var r = 5;
		var currentRow = -1;
		cells.forEach(cell => {
			setCell(box, r, 0, cell);
			if (cell.$uuid === iwoUuid) {
				currentRow = r;
			}
			r += 1;
		});

		if (currentRow !== -1) {
			box.Select(currentRow, 0);
		}

		var colour = white;
		var marker = " ";
		if (currentRow === -1) {
			colour = yellow;
			marker = "✓";
		}
		var noneCell = tview.NewTableCell(fill(` ${marker} [ NO MATCH ]      <--   select this to dissociate`, width));
		noneCell.SetSelectable(true);
		noneCell.$uuid = "none";
		noneCell.SetTextColor(colour);
		setCell(box, 4, 0, noneCell);


		app.$popup = box;
		app.SetFocus(box);
		showKeys(app, selectorKeys);
	}


	function initTable() {
		var table = tview.NewTable();
		table.SetBorder(true);
		table.SetBorders(true);
		table.SetSelectable(true, false);
		table.SetFixed(1, 0);
		var cwidth = 20;
		var iwidth = 20;

		matched.forEach(t => {
			cwidth = Math.max(cwidth, t.classic.name.length);
			if (t.iwo) {
				iwidth = Math.max(iwidth, t.iwo.name.length);
			}
		});

		table.$cwidth = cwidth;
		table.$iwidth = iwidth;

		// we cant rely on table.GetCell because we loose the custom fields (like $uuid) if we do.
		// so we need to keep our own record of the cells in the table.
		table.$cells = { };

		setCell(table, 0, 0, tview.NewTableCell("[green::b]"+_classic+" Targets").SetSelectable(false).SetAlign(tview._AlignCenter));
		setCell(table, 0, 1, tview.NewTableCell("[green::b]"+_xl+" Targets").SetSelectable(false).SetAlign(tview._AlignCenter));

		var row = 1;
		matched.forEach(t => {
			setCell(table, row, 0, newCell(t.classic.name, t.classic.uuid, cwidth));
			if (t.iwo) {
				setCell(table, row, 1, newCell(t.iwo.name, t.iwo.uuid, iwidth));
			} else {
				setCell(table, row, 1, newCell("-", null, iwidth));	
			}
			row += 1;
		});

		// When the user presses <enter> he/she can select the IWO target in a popup.
		table.SetSelectedFunc((row, col) => {
			iwoTargetSelectorPopup(table, row, col);
		});


		return table;
	}


	function initHelp() {
		var help = tview.NewTextView();
		help.SetBorder(true);
		help.SetDynamicColors(true);
		help.SetWordWrap(true);
		var mesg = `
			| [green::bu]Introduction[-::-]
			|
			| The migration tool needs to know which targets in ${_xl} correspond to which in ${_classic}.
			# This requires human assistance.
			|
			| When you press the RETURN key, you will be presented with a table containing two columns
			# showing the names of the targets in the ${_classic} and the results of our initial attempt at
			# identifying the corresponding ones in ${_xl}. Using the keyboard (not the mouse), please
			# update any entries in the ${_xl} targets column that need to be changed so that they correctly
			# match the equivalent ${_classic} targets.
			|
			| Leave the ${_xl} entry blank for ${_classic} targets that have not been MIGRATED
			# over to ${_xl}. Be aware that this may mean that the contents of some groups and policies will
			# be different as a result.
			|
			| ${_xl} targets that match no listed ${_classic} target are those that have been added to the
			# ${_xl} instance but do not exist in ${_classic}. This is valid, but be aware that it means that
			# the ${_xl} instance will contain entities that dont exist in ${_classic}, and the result is
			# likely to be that some group contents and policy impacts will be different.
			|
			| [green::bu]Associating an ${_xl} target[-::-]
			|
			| If you want to associate an ${_xl} target that is not already associated with any ${_classic} one
			| then follow these steps..
			|
			|  1. Use the Up and Down arrow keys to highlight the relevant line in the table.
			|  2. Press the Enter key. A list of possible targets pops up.
			|  3. Use the arrow keys to select the required target and then press Enter.
			|
			| [green::bu]Dissociating an ${_xl} target[-::-]
			|
			| If the ${_xl} colum already has a target listed that you need to dissociate (for example: to
			# allow it to be associated with a different ${_classic}), you should follow these steps:
			|
			|  1. Use the Up and Down arrow keys to highlight the relevant line in the table.
			|  2. Press the Enter key. A list of possible targets pops up.
			|  3. Use the arrow keys to select the "--- no match ---" entry at the top of the list and then
			# press Enter.
			|
			| [green::bu]Changing the associated ${_xl} target[-::-]
			|
			| If you want to associate an ${_xl} target that is already associated with a different ${_classic}
			# one, you should dissocate it first (see above) before you can associate it with the required
			# ${_classic}.
			|
			| [green::bu]Key strokes[-::-]
			|
			| A brief summary of the keys to use will be shown on the bottom line of of the screen. If you
			# want to see this help again, just press the "?" key.
			|
			| [yellow::b]?      [-::-] : Display this help message (press RETURN to return to the table).
			| [yellow::b]Up/Down[-::-] : Navigate up and down the targets list.
			| [yellow::b]Enter  [-::-] : Change the matching ${_xl} target.
			| [yellow::b]ESC    [-::-] : Exit (and optionally, save).
			| [yellow::b]^C     [-::-] : Exit without saving.
			|
			| [::r] Press RETURN to continue. [::-]
		`;
		mesg = mesg.replace(/\n\s*\| ?/g, "\n").replace(/\n\s*# ?/g, " ").trim();
		help.SetText(mesg);
		return help;
	}


	function initMainGrid() {
		var grid = tview.NewGrid();
		grid.SetRows(3, 0, 1);
		grid.SetColumns(0);
		grid.SetBorder(false);

		var header = tview.NewTextView();
		header.SetText("\nMatch Targets");
		header.SetTextColor(yellow);
		header.SetBackgroundColor(blue);
		header.SetBorder(false);
		header.SetTextAlign(tview._AlignCenter);

		var help = initHelp();

		var footer = tview.NewTextView();
		footer.SetText("-");
		footer.SetBorder(false);
		footer.SetTextAlign(tview._AlignCenter);
		footer.SetDynamicColors(true);
		footer.SetBackgroundColor(blue);

		var table = initTable();

		grid.AddItem(header, 0, 0, 1, 1, 0, 0, false);
		grid.AddItem(help, 1, 0, 1, 1, 0, 0, true);
		grid.AddItem(footer, 2, 0, 1, 1, 0, 0, false);

		grid.$header = header;
		grid.$help = help;
		grid.$footer = footer;
		grid.$table = table;

		grid.$active = "help";

		return grid;
	}

	function center(str, width) {
		var space = width - str.length;
		var rtn = (" ".repeat(space/2)) + str;
		return rtn + (" ".repeat(width - rtn.length));
	}

	function confirm(app, question) {
		var windowRect = app.$mainGrid.GetRect();
		var windowWidth = windowRect[2];
		var windowHeight = windowRect[3];
		var width = Math.min(60, windowWidth - 16);
		var height = Math.min(5, windowHeight - 12);

		var box = tview.NewTextView();
		box.$name = "exit";

		box.SetRect(
			Math.floor((windowWidth - 2 - width) / 2),
			Math.floor(1 + (windowHeight - 2 - height) / 2),
			width + 2, height + 2
		);

		box.SetTextColor(yellow);
		box.SetBorderColor(orange);
		box.SetTitleColor(orange);
		box.SetBorder(true);
		box.SetTitle(" Please Select.. ");
		box.SetTextAlign(tview._AlignCenter);
		box.SetText("\nSave (s) or Abort (a) ?\n\n(press 's', 'a' or ESC to cancel)");

		app.$popup = box;
		app.SetFocus(box);
		showKeys(app, exitKeys);
	}

	function initApp() {
		var app = tview.NewApplication();
		app.$mainGrid = initMainGrid();
		app.SetFocus(app.$mainGrid.$help);
		showKeys(app, helpKeys);

		function showTable() {
			if (app.$mainGrid.$active === "help") {
				app.$mainGrid.RemoveItem(app.$mainGrid.$help);
				app.$mainGrid.AddItem(app.$mainGrid.$table, 1, 0, 1, 1, 0, 0, true);
				app.$mainGrid.$active = "table";
				app.SetFocus(app.$mainGrid.$table);
				showKeys(app, tableKeys);
			}
		}

		function showHelp() {
			app.$mainGrid.RemoveItem(app.$mainGrid.$table);
			app.$mainGrid.AddItem(app.$mainGrid.$help, 1, 0, 1, 1, 0, 0, true);
			app.$mainGrid.$active = "help";
			app.SetFocus(app.$mainGrid.$help);
			showKeys(app, helpKeys);
		}

		app.SetInputCapture(ev => {
			if (app.$popup && app.$popup.$name === "exit") {
				switch (ev.Name().toLowerCase()) {
					case "esc":
						app.$popup = null;
						app.SetFocus(app.$mainGrid.$table);
						showKeys(app, tableKeys);
						return null;
					case "rune[s]":
						app.Stop();
						returnCode = "s";
						return null;
					case "rune[a]":
						app.Stop();
						returnCode = "a";
						return null;
				}
			} else if (app.$popup && app.$popup.$name === "targets") {
				switch (ev.Name().toLowerCase()) {
					case "esc":
						app.$popup = null;
						app.SetFocus(app.$mainGrid.$table);
						showKeys(app, tableKeys);
						return null;
					case "ctrl+c":
						returnCode = ev.Name().toLowerCase();
						app.Stop();
						return null;
					default:
						var fn = app.$popup.InputHandler();
						return fn(ev, function() { return null; });
				}
			} else {
				switch (ev.Name().toLowerCase()) {
					case "esc":
						if (app.$mainGrid.$active === "table") {
							confirm(app);
						} else {
							showTable();
						}
						return null;
					case "ctrl+c":
						returnCode = ev.Name().toLowerCase();
						app.Stop();
						return null;
					case "rune[?]":
						showHelp();
						return null;
					case "enter":
						if (app.$mainGrid.$active === "help") {
							showTable();
							return null;
						}
						break;
				}
			}
			return ev;
		});

		// Handle pop up
		app.SetAfterDrawFunc(function(screen) {
			if (app.$popup) {
				app.$popup.Draw(screen);
			}
		});

		return app;
	}

	app = initApp();

	app.SetRoot(app.$mainGrid, true);

	app.Run();

	var t = app.$mainGrid.$table;
	var n = t.GetRowCount();
	var mapping = [ ];
	for (var r2=1; r2 < n; r2 += 1) {
		mapping.push({
			row: r2,
			cuuid: getCell(t, r2, 0).$uuid,
			iuuid: getCell(t, r2, 1).$uuid
		});
	}

	return { exitKey: returnCode, mapping: returnCode === "s" ? mapping : undefined };
}

lib.saveMetaData(xlDb, "match_targets_start_time", "" + (new Date()));

print("<SELECTOR_START>\r                     \r");
var userInput = runForm();
print("<SELECTOR_END>\r                      \r");

if (!userInput || !userInput.exitKey || userInput.exitKey !== "s") {
	println("Selection aborted");
	exit(1);
}


var headers = [ _classic, _xl ];
var rows = [ ];

var noIwoRows = [ ];
var noClassicRows = [ ];

lib.clearTargetMapping(xlDb);
userInput.mapping.forEach(m => {
	if (m.cuuid) {
		if (!m.iuuid || m.iuuid === "none") {
			m.iuuid = "-";
		}
		lib.saveTargetMapping(xlDb, m.cuuid, m.iuuid || "-");
		if (classicTargetsByUuid[m.cuuid] && iwoTargetsByUuid[m.iuuid]) {
			rows.push([
				classicTargetsByUuid[m.cuuid].name,
				iwoTargetsByUuid[m.iuuid].name
			]);
		}
		if (classicTargetsByUuid[m.cuuid] && !iwoTargetsByUuid[m.iuuid]) {
			noIwoRows.push(classicTargetsByUuid[m.cuuid].name);
		}
	}
});

println("Mapping saved\n");

lib.saveMetaData(xlDb, "match_targets_end_time", "" + (new Date()));

if (rows.length > 0) {
	note(`The following ${_classic} -> ${_xl} target mappings have been saved..`);
	printTable(headers, rows);
	println();
}

if (noIwoRows.length > 0) {
	note(`The following ${_classic} targets are not associated with any ${_xl} target`);
	noIwoRows.sort();
	noIwoRows.forEach(t => {
		println(" - "+t);
	});
	println();
}

iwoTargets.forEach(t => {
	var matched = false;
	userInput.mapping.forEach(m => {
		if (m.iuuid === t.uuid) {
			matched = true;
		}
	});
	if (!matched) {
		noClassicRows.push(t.name);
	}
});

if (noClassicRows.length > 0) {
	note(`The following ${_xl} targets are not associated with any ${_classic} target`);
	noClassicRows.sort();
	noClassicRows.forEach(t => {
		println(" - "+t);
	});
	println();
}

exit(0);
