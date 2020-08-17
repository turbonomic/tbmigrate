var lib = require("./libmigrate");
var nameMap = lib.nameMap;

function getSupplyChain(cred, cnm) {
	var client = newClient(cred);
	var sc = client.getSupplyChainByUuids( {"uuids": "Market", "environment_type": "HYBRID", "health": false } );
	var seMap = sc.seMap || {};
	var rtn = { };
	_.keys(seMap).forEach(type => {
		var type2 = cnm[type] || type;
		rtn[type2] = rtn[type2] || 0;
		rtn[type2] += seMap[type].entitiesCount;
	})
	return [ cred, rtn ];
}

var map = nameMap.class_name_map;
//map.Region = "DataCenter";
//map.Zone = "PhysicalMachine";
//map.AvailabilityZone = "PhysicalMachine";

// map = { };

go(getSupplyChain, "@xl", map);
go(getSupplyChain, "@classic", map);

var sc1 = wait(-1);
var sc2 = wait(-1);

var xlChain = (sc1[0] === "@xl") ? sc1[1] : sc2[1];
var classicChain = (sc1[0] === "@classic") ? sc1[1] : sc2[1];

var all = { };

_.keys(xlChain).forEach(type => {
	all[type] = all[type] || {};
	all[type].xl = xlChain[type];
});

_.keys(classicChain).forEach(type => {
	all[type] = all[type] || {};
	all[type].classic = classicChain[type];
});

var types = _.keys(all);
types.sort();

var headers = [ "Type", ">Number in Classic", ">Number in XL" ];
var rows = [ ];
types.forEach(type => {
	rows.push([
		type,
		all[type].classic === undefined ? "-" : all[type].classic,
		all[type].xl === undefined ? "-" : all[type].xl
	]);
});

printTable(headers, rows);
