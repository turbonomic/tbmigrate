/*
	TODO

	- How do we handle case sensitivity? Are the rules the same in XL and classic?
*/


/* global colour, title, subtitle, warning, success, note, error */

var F = require("@/functions");
var lib = require("./libmigrate.js");

usage = function() {
	println("");
	println("Usage is:");
	println("");
	println("  tbscript {xl-credentials} migrate-users.js [-pass {password}] {classic-db-file} {xl-db-file}");
	println("");
	println("  Where:");
	println("    -pass     Password to use for all new local users (random password used if none specified)");
	println("");
	exit(2);
};

var args_ = F.extendedOptions("", "pass:");
if (args_.remaining.length !== 2) {
	usage();
}

var pass = args_.pass;

var P = plugin("sqlite3-plugin");
var classicDb = P.open("file:"+args_.remaining[0]+"?mode=rw");
var xlDb = P.open("file:"+args_.remaining[1]+"?mode=rw");

var userInfo = client.http.get("/users/me", { });
if (userInfo.roleName.toLowerCase() !== "administrator") {
	woops("Must be run by a user with Turbonomic administrator rights");
}

var classicAd = null;
classicDb.query("select json from metadata where name = 'ldap'").forEach(row => {
	classicAd = JSON.parse(row.json);
});


function mapGroupName(dn) {
	dn = dn.replace(/\\/g, "/");
	return dn;
}

function filloutScope(u) {
	if (!u.scope) { return; }
	u.scope.forEach(s => {
		if (s.uuid && !s.displayName) {
			var found = false;
			xlDb.query("select displayName from entities where uuid = ?", [s.uuid]).forEach(row => {
				s.displayName = row.displayName;
				found = true;
			});
			if (!found) {
				try {
					var obj = client.getObjectByUuid(s.uuid);
					s.displayName = obj.displayName;
				} catch (ex) { }
			}
		}
	});
}


function getRole(u) {
	return ((u || {}).roleName || "?").toUpperCase();
}


function getProvider(u) {
	return ((u || {}).loginProvider || "?").toUpperCase();
}

function getType(u) {
	return ((u || {}).type || "?").toUpperCase().trimSuffix("CUSTOMER");
}

function getScope(u) {
	var scopes = [ ];
	(u.scope || []).forEach(s => {
		if (s.displayName !== undefined) {
			scopes.push(mapGroupName(s.displayName));
		}
	});
	scopes.sort();
	return scopes.join(", ");
}


var randomPasswordUsed = false;

// TODO: If already configured, dont over-write but check that the config is the same. Report if not.

if (classicAd && classicAd.length > 0 && (classicAd[0].domainName || classicAd[0].loginProviderURI)) {
	println("Migrating Active-Directory configuration");
	// var xlAd = client.getActiveDirectories();
	var body = {
		domainName: classicAd[0].domainName,
		loginProviderURI: classicAd[0].loginProviderURI,
		secure: classicAd[0].secure
	};
	try {
		var newConfig = client.createActiveDirectory(body);
		lib.saveMetaData(xlDb, "ldap", newConfig);
		success("    Ok: Configuration migrated");
	} catch (ex) {
		error(sprintf("    Error: %v", ex.message));
	}
}


classicDb.query("select name, json from users").forEach(row => {
	// Leave the "administrator" user well alone.
	if (row.name === "administrator") { return; }

	var u = JSON.parse(row.json);

	printf("\nMigrating %v user '%v' ...\n", u.loginProvider, u.username);

	// If the user already exists in XL, dont make any changes.
	var existingUser = null;
	var numFound = 0;

	xlDb.query("select json from users where name = ?", [ u.username ]).forEach(row => {
		numFound += 1;
		existingUser = JSON.parse(row.json);
	});

	if (numFound > 1) {
		warning("    Warning: more than one matching user found in XL");
		return;
	}

	if (numFound === 1) {
		var okay = true;

		if (getRole(existingUser) !== getRole(u)) {
			warning("    Warning: existing user's role doesnt match");
			warning("      in classic: "+getRole(u));
			warning("      in XL:      "+getRole(existingUser));
			okay = false;
		}

		if (getProvider(existingUser) !== getProvider(u)) {
			warning("    Warning: existing user's login provider doesnt match");
			warning("      in classic: "+getProvider(u));
			warning("      in XL:      "+getProvider(existingUser));
			okay = false;
		}

		if (getType(existingUser) !== getType(u)) {
			warning("    Warning: existing user's login type doesnt match");
			warning("      in classic: "+getType(u));
			warning("      in XL:      "+getType(existingUser));
			okay = false;
		}

		if (getScope(existingUser) !== getScope(u)) {
			warning("    Warning: existing user's scope doesnt match");
			warning("      in classic: "+getScope(u));
			warning("      in XL:      "+getScope(existingUser));
			okay = false;
		}

		if (okay) {
			success("    Success: user already exists and matches");
		}

		return;
	}

	delete u.uuid;
	delete u.roleUuid;
	delete u.links;

	u.roleName = u.roleName.toUpperCase();
	if (u.loginProvider === "Local") {
		randomPasswordUsed = true;
		u.password = pass ? pass : newUuid();
	}

	if (u.scope) {
		var scopeOk = true;
		var newScope = [ ];
		u.scope.forEach(s => {
			var xlUuid = null;
			xlDb.query("select xlUuid from group_uuid_mapping where classicUuid = ?", [s.uuid]).forEach(row => {
				xlUuid = row.xlUuid;
			});
			if (xlUuid === null) {
				warning(sprintf("    Warning: scope group '%s' not found (required for user '%s')", s.displayName, u.username));
				scopeOk = false;
			} else {
				newScope.push( { uuid: xlUuid });
			}
		});

		if (!scopeOk) {
			return;
		}

		u.scope = newScope;
	}

	try {
		var newUser = client.createUser(u);
		filloutScope(newUser);
		lib.saveUser(xlDb, newUser);
		success("    Success: User created");
	} catch (ex) {
		error(sprintf("    Error: %v", ex.message));
		return;
	}

});


classicDb.query("select json from user_groups").forEach(row => {
	var g = JSON.parse(row.json);

	printf("\nMigrating LDAP group '%v' ...\n", g.displayName);

	// If the group already exists in XL, dont make any changes.
	var existingGroup = null;
	var numFound = 0;

	xlDb.query("select json from user_groups where displayName = ?", [ g.displayName ]).forEach(row => {
		existingGroup = JSON.parse(row.json);
		numFound += 1;
	});

	if (numFound > 1) {
		warning("    Warning: more than one matching group found in XL");
		return;
	}

	if (numFound === 1) {
		var okay = true;

		if (getRole(existingGroup) !== getRole(g)) {
			warning("    Warning: existing group's role doesnt match");
			warning("      in classic: "+getRole(g));
			warning("      in XL:      "+getRole(existingGroup));
			okay = false;
		}

		if (getType(existingGroup) !== getType(g)) {
			warning("    Warning: existing group's login type doesnt match");
			warning("      in classic: "+getType(g));
			warning("      in XL:      "+getType(existingGroup));
			okay = false;
		}

		if (getScope(existingGroup) !== getScope(g)) {
			warning("    Warning: existing group's scope doesnt match");
			warning("      in classic: "+getScope(g));
			warning("      in XL:      "+getScope(existingGroup));
			okay = false;
		}

		if (okay) {
			success("    Success: group already exists and matches");
		}

		return;
	}

	delete g.uuid;
	g.roleName = g.roleName.toUpperCase();

	if (g.scope) {
		var scopeOk = true;
		var newScope = [ ];
		g.scope.forEach(s => {
			var xlUuid = null;
			xlDb.query("select xlUuid from group_uuid_mapping where classicUuid = ?", [s.uuid]).forEach(row => {
				xlUuid = row.xlUuid;
			});
			if (xlUuid === null) {
				warning(sprintf("    Warning: scope group '%s' not found (required for group '%s')", s.displayName, g.displayName));
				scopeOk = false;
			} else {
				newScope.push( { uuid: xlUuid });
			}
		});

		if (!scopeOk) {
			return;
		}

		g.scope = newScope;
	}

	try {
		var newGroup = client.createActiveDirectoryGroup(g);
		filloutScope(newGroup);
		lib.saveUserGroup(xlDb, newGroup);
		success("    Success: LDAP group created");
	} catch (ex) {
		error(sprintf("    Error: %v", ex.message));
	}
});


lib.saveMetaData(xlDb, "migrate_users_end_time", "" + (new Date()));

if (randomPasswordUsed) {
	note("");
	note("************************************************************************************");
	note("*                                       NOTE                                       *");
	note("************************************************************************************");
	note("* You have migrated one or more 'local' users.                                     *");
	note("*                                                                                  *");
	note("* They have been allocated random passwords. You will need to coordinate with them *");
	note("* to agree and set a suitable, secure password using the Admin UI.                 *");
	note("************************************************************************************");
	note("");
}
