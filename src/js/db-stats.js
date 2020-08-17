var P = plugin("sqlite3-plugin");

function inspect(dbName) {
	println("");

	try {
		var db = P.open("data/"+dbName+".db");

		db.query("select count(*) n from targets").forEach(row => {
			printf("%s_num_targets=%v\n", dbName, row.n);
		});

		db.query("select count(*) n from target_scopes").forEach(row => {
			printf("%s_num_target_scopes=%v\n", dbName, row.n);
		});

		db.query("select count(*) n from templates").forEach(row => {
			printf("%s_num_templates=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "isXL" and json = "true"`).forEach(row => {
			printf("%s_isxl=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "vmt_helper_data"`).forEach(row => {
			printf("%s_has_helper_data=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_targets_end_time"`).forEach(row => {
			printf("%s_targets_migrated=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_groups_end_time"`).forEach(row => {
			printf("%s_groups_migrated=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_templates_end_time"`).forEach(row => {
			printf("%s_templates_migrated=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "migrate_policies_end_time"`).forEach(row => {
			printf("%s_policies_migrated=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "isLocal" and json = "true"`).forEach(row => {
			printf("%s_is_local=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "hasSshCreds" and json = "true"`).forEach(row => {
			printf("%s_has_ssh_creds=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "targets_1_confirmed" and json = "true"`).forEach(row => {
			printf("%s_targets_1_confirmed=%v\n", dbName, row.n);
		});

		db.query(`select count(*) n from metadata where name = "targets_2_confirmed" and json = "true"`).forEach(row => {
			printf("%s_targets_2_confirmed=%v\n", dbName, row.n);
		});

		db.close();

		printf("%s_db_ok=1\n", dbName);
	} catch (ex) {
		printf("%s_db_ok=0\n", dbName);
	}
}

inspect("classic");
inspect("xl1");
inspect("xl2");
inspect("xl3");

exit(0);
