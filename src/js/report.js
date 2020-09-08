// TODO
//	- add schedules
//	- make "missing group" look the same in targets and policies
//	- fix "undefined" in default policy listings (seems to be a V7 issue - eg: 10.16.172.246)
//	- add failure warnings at top of each target block
//	- fix scope/name mixed field in 10.16.172.143 "Host production policy"
//	- save the instance hostname or IP in meta data and use in report title.
//	- missing target info in 10.16.173.55 (and .57)



function htmlEncode(str) {
	return (str || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}


println(`<!DOCTYPE html>
	<html><head>
	<style>
		p, ul { margin-top: 2px; margin-bottom: 2px }
		table { border-spacing: 0; border-collapse: collapse; }
		table td, th { border: solid 1px gray; padding: 6px }
		body { font-family: "sans" }
		.text-left { text-align: left }
		.text-top { vertical-align: top }
		.active { font-weight: bold; color: #008000 }
		.idle { color: #800000 }
	</style>
	</head><body><div id="main" style="display: none">
	<div style="color: blue; font-weight: bold">
	TODO: Handle placement policies.<br>
	TODO: List templates.
	</div>
`);


function compareDisplayNames(a, b) {
	var aa = a.displayName.toLowerCase();
	var bb = b.displayName.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
}

function compareTargetNames(a, b) {
	var aa = a.$name.toLowerCase();
	var bb = b.$name.toLowerCase();
	if (aa < bb) { return -1; }
	if (aa > bb) { return 1; }
	return 0;
}


var tbutil = getenv("ARGV0").replace(/tbscript$/, "tbutil");
var versionText = commandPipe(tbutil, [client.getCredentialKey(), "version", "-db", args[0]]);
var supplyChainText = commandPipe(tbutil, [client.getCredentialKey(),  "list", "hybrid", "supplychain", "-x", "@.html", "-db", args[0] ]);
var targetsText = commandPipe(tbutil, [client.getCredentialKey(),  "list", "targets", "-x", "@.csv", "-db", args[0], "-columns", "1,2,3,4,5" ]);
var defaultSettingsText = commandPipe(tbutil, [client.getCredentialKey(), "print", "all", "default", "settings", "policy", "changes", "-db", args[0], "-html"]);

var customGroupsText = commandPipe(tbutil, [client.getCredentialKey(), "list", "my", "groups", "-j", "-db", args[0]]);
var customGroups = JSON.parse(customGroupsText);
customGroups.sort(compareDisplayNames);

var usersText = commandPipe(tbutil, [client.getCredentialKey(), "list", "users", "-j", "-db", args[0]]);
var users = JSON.parse(usersText);
users.sort(compareDisplayNames);

var adGroupsText = commandPipe(tbutil, [client.getCredentialKey(), "list", "ad", "groups", "-j", "-db", args[0]]);
var adGroups = JSON.parse(adGroupsText);
adGroups.sort(compareDisplayNames);

var placementText = commandPipe(tbutil, [client.getCredentialKey(), "list", "placement" , "policies", "-j", "-db", args[0]]);
var placement = JSON.parse(placementText);
placement.sort(compareDisplayNames);


require("@/sqlite3_hooks").init(client, "file:"+args[0]+"?mode=ro");
var lib = require("./libmigrate");

var policies = client.getSettingsPolicies({}).filter(p => { return !p.default && !p.disabled; });

policies.sort(compareDisplayNames);

var showGroupMembers = { };


function mapExpType(e) {
	switch (e) {
		case "RXEQ": return "matches";
		case "RXNEQ": return "doesnt match";
		default: return e;
	}
}


function mapFilterType(f) {
	switch (f) {
		case "containersByName": return "container name";
		case "containerpodsByName": return "pod name";
		case "vmsByStorage": return "storage";
		case "pmsByClusterName": return "cluster name";
		default: return f;
	}
}


function simplifyExpression(e, v) {
	if (e === "RXEQ" && v.match(/^[a-zA-Z0-9]*\.\*$/)) {
		return "starts with \""+v.trimSuffix(".*")+"\"";
	}
	if (e === "RXNEQ" && v.match(/^[a-zA-Z0-9]*\.\*$/)) {
		return "doesnt start with \""+v.trimSuffix(".*")+"\"";
	}
	if (e === "RXEQ" && v.match(/^\.\*[a-zA-Z0-9]*$/)) {
		return "ends with \""+v.trimPrefix(".*")+"\"";
	}
	if (e === "RXNEQ" && v.match(/^\.\*[a-zA-Z0-9]*$/)) {
		return "doesnt end with \""+v.trimPrefix(".*")+"\"";
	}
	return mapExpType(e) + " \"" + v + "\"";
}


function getCriterionDetail(c) {
	return mapFilterType(c.filterType)+" "+simplifyExpression(c.expType, c.expVal);
}


function getScopeDetail(scopes) {
	var rtn = [ ];
	(scopes || []).forEach(s => {
		var g = { };
		try {
			g = client.getGroupByUuid(s.uuid);
		} catch (ex) {
			rtn.push(`<p style='color: red'>Missing group (uuid: ${s.uuid})</p>`);
			return;
		}
		var line = "<p>";
		var category = null;

		client.DB.query("select category from group_category where uuid = ?", [ s.uuid ]).forEach(row => {
			category = row.category.trimPrefix("GROUP-").replace(/By/g, " By ");
		});

		line += sprintf("%v %v %v \"<b>%v</b>\".<br/>", g.isStatic ? "Static" : "Dynamic", category ? category : g.groupType, g.className, g.displayName);
		if (g.source) {
			line += "Discovered by: " + g.source.displayName + ".<br/>";
		}
		if (!g.isStatic) {
			if (g.criteriaList) {
				line += "</p><p>Criteria is:</p><ul>";
				(g.criteriaList || []).forEach(c => {
					line += sprintf("<li>%v</li>\n", getCriterionDetail(c));
				});
				line += "</ul><p>";
			}
			if (g.entitiesCount === 0) {
				line += "Group is empty.<br/>";
			} else if (g.entitiesCount === g.activeEntitiesCount) {
				line += sprintf("Group contains %v active members.<br/>", g.activeEntitiesCount);
				showGroupMembers[g.uuid] = true;
			} else {
				line += sprintf("Group contains %v members, of which %v are active.<br/>", g.entitiesCount, g.activeEntitiesCount);
				showGroupMembers[g.uuid] = true;
			}

		} else {
			if (g.entitiesCount === 0) {
				line += "Group is empty.<br/>";
			} else if (g.entitiesCount === g.activeEntitiesCount) {
				line += sprintf("Group contains <a href='#' onclick=\"pushPage('"+g.uuid+"')\">%v active members</a>.<br/>", g.activeEntitiesCount);
				showGroupMembers[g.uuid] = true;
			} else {
				line += sprintf("Group contains <a href='#' onclick=\"pushPage('"+g.uuid+"')\">%v members</a>, of which %v are active.<br/>", g.entitiesCount, g.activeEntitiesCount);
				showGroupMembers[g.uuid] = true;
			}

		}

		line += "</p>";
		rtn.push(line);
	});
	return rtn.join("<br>\n");
}


function getScheduleDetail(p) {
	if (!p.schedule) {
		return "<p>Not restricted by schedule</p>";
	}
	var s = p.schedule;
	var recurrence = null;
	if (s.recurrence) {
		var r = s.recurrence;
		recurrence = "Recurrs "+r.type;
		if (r.interval) {
			recurrence += `<br>Interval: ${r.interval}`
		}
		if (r.daysOfWeek) {
			recurrence += `<br>Days of week: ${r.daysOfWeek.join(", ")}`;
		}
		if (r.daysOfMonth) {
			recurrence += `<br>Days of month: ${r.daysOfMonth.join(", ")}`;
		}
		if (r.weekOfTheMonth) {
			recurrence += `<br>Weeks on month: ${r.weekOfTheMonth.join(", ")}`;
		}
	} else {
		recurrence = "Not recurring";
	}

	return `
		<table border=1 width="100%">
			<tr>
				<th>Name</th><td>${s.displayName}</td>
			</tr>
			<tr>
				<th>Start</th><td>${s.startTime.replace(/T/, " - ")}</td>
			</tr>
			<tr>
				<th>End</th><td>${s.endTime.replace(/T/, " - ")}</td>
			</tr>
			<tr>
				<th>TimeZone</th><td>${s.timeZone}</td>
			</tr>
			<tr>
				<th>Recurrence</th><td>
					${recurrence}
				</td>
			</tr>
		</table>
	`;
}


function getSettingsDetail(p) {
	var lines = [ ];
	p.settingsManagers.forEach(sm => {
		lines.push("<p>"+sm.displayName+":</p>\n<ul>\n");
		sm.settings.forEach(s => {
			lines.push("<li>"+s.displayName+": "+s.value+"</li>\n");
		});
		lines.push("</ul>");
	});
	return lines.join("\n");

}


function getGroupScopes(g) {
	var rtn = [];

	var sql = "select p.displayName, s.scopeType from policy_scopes s, placement_policies p where s.groupUuid = ? and s.policyUuid = p.uuid";
	client.DB.query(sql, [ g.uuid ]).forEach(row => {
		rtn.push(sprintf("Placement policy '%s' (%s)", htmlEncode(row.displayName), row.scopeType));

	});

	sql = "select t.displayName from settings_scopes s, settings_types t where s.groupUuid = ? and s.typeUuid = t.uuid";
	client.DB.query(sql, [ g.uuid ]).forEach(row => {
		rtn.push(sprintf("Settings policy '%s'", htmlEncode(row.displayName)));

	});

	sql = "select t.name from target_scopes s, targets t where s.groupUuid = ? and s.targetUuid = t.uuid";
	client.DB.query(sql, [ g.uuid ]).forEach(row => {
		rtn.push(sprintf("Target '%s'", htmlEncode(row.name)));
	});

	sql = "select u.name, u.provider from user_scopes s, users u where s.groupUuid = ? and s.userUuid = u.uuid";
	client.DB.query(sql, [ g.uuid ]).forEach(row => {
		rtn.push(sprintf("%s User '%s'", row.provider === "LDAP" ? "AD" : "Local", htmlEncode(row.name)));
	});

	sql = "select g.displayName from user_group_scopes s, user_groups g where s.groupUuid = ? and s.userGroupUuid = g.uuid";
	client.DB.query(sql, [ g.uuid ]).forEach(row => {
		rtn.push(sprintf("AD user group '%s'", htmlEncode(row.displayName)));
	});

	return rtn.length > 0 ? rtn.join("<br>") : null;
}


var meta = { };
client.DB.query("select * from metadata").forEach(row => {
	meta[row.name] = JSON.parse(row.json);
});

var name = meta.credKey;
var host = meta.host;
var ts = meta.startTime;

println(`<h1>Instance: ${ name || host }</h1>`);

printf("<b>Host</b>: %v<br>\n", host);
printf("<b>Details extracted</b>: %v<br>\n", ts);
printf("<b>Password migration</b>: %v<br>\n", meta.vmt_helper_data ? "enabled" : "disabled");

println("<h2>Software version</h2>");
println(`<pre>${htmlEncode(versionText)}</pre>`);

println("<h2>Entities (Supply chain)</h2>");
print(supplyChainText.trimSpace().trimPrefix("<html><body>").trimSuffix("</body></html>"));


println("<h2>Targets</h2>");
targetsText = _.deepClone(parseCsv(targetsText));
targetsText.shift();

print("<table><tr>");
[ "Category", "Type", "Address or Name", "Account", "Status" ].forEach(h => { printf("<th>%v</th>", h); });
print("</tr>");
targetsText.forEach(row => {
	var statusColour = row[4] === "Validated" ? "black" : "red";
	print(`<tr>
		<td>${htmlEncode(row[0])}</td>
		<td>${htmlEncode(row[1])}</td>
		<td>${htmlEncode(row[2])}</td>
		<td>${htmlEncode(row[3])}</td>
		<td style="color: ${statusColour}">${htmlEncode(row[4])}</td>
	</tr>`);
});
println("</table>");

var targets = client.getTargets({environment_type: "HYBRID"});
targets.forEach(t => {
	t.$name = lib.getTargetName(t);
});
targets.sort(compareTargetNames);

targets.forEach(t => {
	println(`<h3>Target: ${htmlEncode(lib.getTargetName(t))}</h3>`);
	println("<table>");
	println(`<tr><th class="text-left">Category / Type</th><td>${htmlEncode(t.category)} / ${htmlEncode(t.type)}</td></tr>`);

	(t.inputFields || []).forEach(f => {
		print(`<tr><th class="text-left">${htmlEncode(f.displayName)}</th>`);
		if (f.isSecret) {
			print("<td>[ <i>secret</i> ]</td>");
		} else if (f.value === undefined) {
			print("<td>[ <i>not defined</i> ]</td>");
		} else if (f.valueType === "GROUP_SCOPE") {
			try {
				var g = client.getGroupByUuid(f.value);
				print(`
					<td>
						${getScopeDetail([g])}
					</td>
				`);
				showGroupMembers[f.value] = true;
			} catch (ex) {
				print(`<td style="color: red">Group UUID ${f.value} missing</td>`);
			}
		} else {
			print(`<td>${htmlEncode(f.value)}</td>`);
		}
		println("</tr>");
	});
	println("</table>");
});

println("<h2>Default settings policies</h2>");
println(defaultSettingsText);

println("<h2>Custom settings policies</h2>");

var policyExclusionRe = null;

policies.filter(p => {
	return !p.displayName.match(/^(AvailabilitySet|AzureScaleSet)::.*?::Policy$/) &&
		!p.displayName.match(/^Region .*? Expired Promo Templates::Policy$/) &&
		!p.displayName.match(/^VMs_Accelerated Networking Enabled.*?::Policy$/);
}).forEach(policy => {
	printf("<h3 class=\"policy_name\">%s</h3>\n", policy.displayName);
	printf("<p>A %s policy.</p>\n", policy.entityType);
	println("<table>");
	printf(`<tr><th class="text-left text-top">Scope</th><td>%s</td></tr>\n`, getScopeDetail(policy.scopes));
	printf(`<tr><th class="text-left text-top">Schedule</th><td>%s</td></tr>\n`, getScheduleDetail(policy));
	printf(`<tr><th class="text-left text-top">Settings</th><td>%s</td></tr>\n`, getSettingsDetail(policy));
	println("</table>");
	println("");
});

/*
print(`
	<h2>Placement Policies</h2>
	<table border=1>
	<tr>
		<th>Name</th>
		<th>Type</th>
		<th>Provider Group</th>
		<th>Supplied Group</th>
	</tr>
`);

placement.forEach(p => {
	printf(`<tr>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
		</tr>`,
		htmlEncode(p.displayName),
		p.type
	);
});
print("</table>");
*/

var n = 0;
print(`
	<h2>Local Users</h2>
	<table border=1>
	<tr>
		<th>Name</th>
		<th>Role</th>
		<th>Type</th>
		<th>Scope</th>
	</tr>
`);
users.forEach(u => {
	if (u.loginProvider === "Local") {
		n += 1;
		var scopes = (u.scope || []).map(s => { return htmlEncode(s.displayName); });
		scopes.sort();
		printf(`<tr>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			</tr>`,
			htmlEncode(u.username),
			u.roleName,
			u.type.replace(/Customer$/, ""),
			scopes.join("<br>")
		);
	}
});
if (n === 0) {
	println("<tr><td colspan=4 style='text-align: center'>--- None ---</td></tr>");
}
println("</table>");


print(`
	<h2>AD Users</h2>
	<table border=1>
	<tr>
		<th>Name</th>
		<th>Role</th>
		<th>Type</th>
		<th>Scope</th>
	</tr>
`);
n = 0;
users.forEach(u => {
	if (u.loginProvider === "LDAP") {
		n += 1;
		var scopes = (u.scope || []).map(s => { return htmlEncode(s.displayName); });
		scopes.sort();
		printf(`<tr>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			</tr>`,
			htmlEncode(u.username),
			u.roleName,
			u.type.replace(/Customer$/, ""),
			scopes.join("<br>")
		);
	}
});
if (n === 0) {
	println("<tr><td colspan=4 style='text-align: center'>--- None ---</td></tr>");
}
println("</table>");


n = 0;
print(`
	<h2>AD User Groups</h2>
	<table border=1>
	<tr>
		<th>Name</th>
		<th>Role</th>
		<th>Type</th>
		<th>Scope</th>
	</tr>
`);
adGroups.forEach(g => {
		n += 1;
		var scopes = (g.scope || []).map(s => { return htmlEncode(s.displayName); });
		scopes.sort();
		printf(`<tr>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			<td>%s</td>
			</tr>`,
			htmlEncode(g.displayName),
			g.roleName,
			g.type.replace(/Customer$/, ""),
			scopes.join("<br>")
		);

});
if (n === 0) {
	println("<tr><td colspan=4 style='text-align: center'>--- None ---</td></tr>");
}
println("</table>");


println("<h2>Templates</h2>");
println("<span style='color: orange'>NB: This report does not yet include template details.</span>");


println("<h2>Custom groups</h2>");
println("<table>");
print(`<tr>
	<th>Name</th>
	<th>Type</th>
	<th>N. Entities</th>
	<th>N. Active</th>
	<th>Details</th>
	<th>Scope For</th>
	</tr>`);

customGroups.forEach(g => {
	print("<tr>");
	printf("<td>%v</td>", g.displayName);
	printf("<td>%v</td>", g.groupType);
	printf("<td align='right'>%v</td>", g.entitiesCount);
	printf("<td align='right'>%v</td>", g.activeEntitiesCount);
	print("<td>");
	if (g.isStatic) {
		if (g.entitiesCount > 0) {
			showGroupMembers[g.uuid] = true;
			println("<a onclick=\"pushPage('"+g.uuid+"')\" href=\"#\"><i style='color: #40a0a0'>Static group</i>  &#128269;</a>");
		} else {
			println("<i style='color: #40a0a0'>Static group</i>");
		}
	} else {
		(g.criteriaList || []).forEach(c => {
			printf("%v<br>\n", getCriterionDetail(c));
		});
	}
	println("</td>");
	var scopes = getGroupScopes(g);
	if (scopes === null) {
		printf("<td style='color: #d0d0d0'>n/a</td>");
	} else {
		printf("<td>%s</td>\n", getGroupScopes(g));
	}
});
println("</table>");


println("</div>");

_.keys(showGroupMembers).forEach(uuid => {
	var g = client.getGroupByUuid(uuid);
	var m = client.getEntitiesByGroupUuid(uuid);

	println(`
		<div id="${uuid}" style="display: none">
			<div>
				<button onclick="popPage()"><span style='font-size:30px; color: blue'>&#128281;</span></button>
				&nbsp;
				<span style='font-size: 30px'>Group "${htmlEncode(g.displayName)}"</span>
			</div>
			<div style="margin-top: 10px">
				<b>Group type: </b>${g.groupType}
			</div>
			<div style="margin-top: 10px">
				<b>UUID: </b>${g.uuid}
			</div>
			<div style="margin-top: 10px">
				<b>Number of entities: </b>${m.length} (green/bold indicates active entities)
			</div>
			<pre style="background-color: #f0f0f0; border: solid 1 #8080; padding: 10px; font-size: 16px">`);
	m.sort((a, b) => {
		var aa = a.displayName.toLowerCase();
		var bb = b.displayName.toLowerCase();
		if (aa < bb) { return -1; }
		if (aa > bb) { return 1; }
		return 0;
	});

	m.forEach(e => {
		if (e.state === "ACTIVE") {
			println("<span class='active'>"+htmlEncode(e.displayName)+"</span>");
		} else if (e.state === "IDLE") {
			println("<span class='idle'>"+htmlEncode(e.displayName)+"</span>");
		} else {
			println(htmlEncode(e.displayName));
		}
	});
	println(`</pre>
		</div>
	`);
});

println(`
	<script>
	var currentPage = null;
	function showPage(pageId) {
		if (currentPage !== null) {
			document.getElementById(currentPage).style.display = "none";
		}
		document.getElementById(pageId).style.display = "block";
		currentPage = pageId;
		console.log("Current page is now: "+pageId);
	}
	showPage("main");

	var oldPage = null;
	var oldScrollX = null;
	var oldScrollY = null;

	function pushPage(pageId) {
		oldPage = currentPage;
		oldScrollX = window.scrollX;
		oldScrollY = window.scrollY;
		showPage(pageId);
	}

	function popPage() {
		showPage(oldPage);
		window.scrollTo(oldScrollX, oldScrollY);
	}
	</script>
`);
println("</body></html>");
