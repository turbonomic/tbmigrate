var P = plugin("sqlite3-plugin");

var stats = { };

function inspect(dbName) {
	try {
		var db = P.open("data/"+dbName+".db");

		db.query("select count(*) n from targets").forEach(row => {
			stats[sprintf("%s_num_targets", dbName)] = parseInt(row.n);
		});

		db.query("select count(*) n from target_scopes").forEach(row => {
			stats[sprintf("%s_num_target_scopes", dbName)] = parseInt(row.n);
		});

		db.query("select count(*) n from templates").forEach(row => {
			stats[sprintf("%s_num_templates", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "isXL" and json = "true"`).forEach(row => {
			stats[sprintf("%s_isxl", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "vmt_helper_data"`).forEach(row => {
			stats[sprintf("%s_has_helper_data", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_targets_end_time"`).forEach(row => {
			stats[sprintf("%s_targets_migrated", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_groups_end_time"`).forEach(row => {
			stats[sprintf("%s_groups_migrated", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_templates_end_time"`).forEach(row => {
			stats[sprintf("%s_templates_migrated", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_policies_end_time"`).forEach(row => {
			stats[sprintf("%s_policies_migrated", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_users_end_time"`).forEach(row => {
			stats[sprintf("%s_users_migrated", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "isLocal" and json = "true"`).forEach(row => {
			stats[sprintf("%s_is_local", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "hasSshCreds" and json = "true"`).forEach(row => {
			stats[sprintf("%s_has_ssh_creds", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "targets_1_confirmed" and json = "true"`).forEach(row => {
			stats[sprintf("%s_targets_1_confirmed", dbName)] = parseInt(row.n);
		});

		db.query(`select count(*) n from metadata where name = "targets_2_confirmed" and json = "true"`).forEach(row => {
			stats[sprintf("%s_targets_2_confirmed", dbName)] = parseInt(row.n);
		});

		db.close();

		stats[sprintf("%s_db_ok", dbName)] = 1;
	} catch (ex) {
		stats[sprintf("%s_db_ok", dbName)] = 0;
	}
}

inspect("classic");
inspect("xl1");
inspect("xl2");
inspect("xl3");


function fileExists(file) {
	return readDir(file).length > 0;
}


stats.credsReady = true;
stats.credsDone = fileExists("data/tbutil-credentials.json");

stats.collect1Ready = stats.credsDone;
stats.collect1Done = stats.xl1_db_ok === 1 && fileExists("logs/xl-collect-1.log") && !fileExists("data/.redo-collect-1");

stats.targets1Ready = stats.credsDone && stats.collect1Done;
stats.targets1Done = stats.xl1_targets_migrated === 1 && stats.collect1Done;

stats.collect2Ready = stats.targets1Done;
stats.collect2Done = stats.xl2_db_ok === 1 && stats.collect2Ready && fileExists("logs/xl-collect-2.log");

stats.groups1Ready = stats.collect2Done;
stats.groups1Done = stats.xl2_groups_migrated === 1 && stats.groups1Ready;

stats.targets2Ready = stats.groups1Done;
stats.targets2Done = stats.targets2Ready && fileExists("logs/migrate-targets-2.log");
stats.targets2Needed = stats.classic_num_target_scopes  > 0 || stats.classic_db_ok === 0;

stats.collect3Ready = stats.targets2Done;
stats.collect3Done = stats.xl3_db_ok === 1 && stats.collect3Ready && fileExists("logs/xl-collect-3.log");
stats.collect3Needed = stats.targets2Needed;

stats.groups2Ready = stats.collect3Done; 
stats.groups2Done = stats.xl3_groups_migrated === 1 && stats.groups2Ready;
stats.groups2Needed = stats.targets2Needed;

stats.templatesReady = stats.collect3Done || (stats.collect2Done && !stats.targets2Needed);
stats.templatesDone = stats.xl3_templates_migrated === 1;

stats.policiesReady = (stats.collect3Done && stats.groups2Done) || (stats.collect2Done && !stats.targets2Needed && stats.groups1Done);
stats.policiesDone = stats.xl3_policies_migrated === 1;

stats.usersReady = (stats.collect3Done && stats.groups2Done) || (stats.collect2Done && !stats.targets2Needed && stats.groups1Done);
stats.usersDone  = stats.xl3_users_migrated === 1;

stats.reviewGroupsReady = stats.collect1Done;

stats.exposeReportReady = stats.collect1Done;


if (args.length > 0) {
	printf("%v\n", stats[args[0]]);
} else {
	_.keys(stats).forEach(k => {
		printf("%s=%v\n", k, stats[k]);
	});
}


exit(0);
