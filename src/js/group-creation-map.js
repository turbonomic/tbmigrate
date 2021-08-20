var _this = {
	dynamicGroup: function(groupType, match, filterType, dispName) {
		return {
		    "className": "Group",
		    "criteriaList": [
		        {
		            "caseSensitive": false,
		            "expType": "RXEQ",
		            "expVal": match.quoteRegexpMeta(true).replace(/\//g, "[/\\\\]"),
		            "filterType": filterType,
		            "singleLine": false
		        }
		    ],
		    "displayName": dispName,
		    "groupType": groupType,
		    "isStatic": false
		};
	},

	vmDynamicGroup: function(match, filterType, dispName) {
		return this.dynamicGroup("VirtualMachine", match, filterType, dispName);
	},

	pmDynamicGroup: function(match, filterType, dispName) {
		return this.dynamicGroup("PhysicalMachine", match, filterType, dispName);
	},


	// A null creator (or one that returns null) results in a static group being created.
	// Note: groups types that cannot be created must throw a string meessage (not a "new Error()").

	creatorMap: {
		"AppByPM": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ApplicationByPhysicalMachine": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ApplicationByType": null, 		// TODO

		"ApplicationServerByType": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"AppsByDataCenter": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"AppsByTarget": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ChassisByNetwork": null,		// TODO

// TODO - Recheck all "not used" groups using "list group members" with "-direct" option

		"CHsByNetwork": null,			// not used (?)

		"ContainerByDataCenter": null,

		"ContainerByTarget": null,

		"ContainerByVM": null,

		"ContainerPodByDataCenter": null,

		"ContainerPodByTarget": null,

		"ContainerPodByVM": null,

		"DAsByStorageController": null,	// not used (?)

		"DatabaseByType": null,			// TODO

		"DBsByAccount": null,			// not used (?)

		"DBsByResourceGroup": null,		// not used (?)

		"DBSsByAccount": null,			// not used (?)

		"DBSsByResourceGroup": null,	// not used (?)

		"DiskArrayByStorageController": null,	// TODO

		"EntitiesByCluster": null,		// TODO

		"IOModuleByChassis": null,		// TODO

		"IOsByChassis": null,			// not used (?)

		"LogicalPoolByDiskArray": null,	// TODO

		"LPsByStorageController": null,	// not used (?)

		"PhysicalMachineByChassis": null,	// TODO

		"PhysicalMachineByChassisOrDataCenter": function(g) {
			var obj = g.json ? JSON.parse(g.json) : _.deepClone(g);
			if ((obj.source || {}).type === "Azure") { return null; }
			if ((obj.source || {}).type === "AWS") { return null; }
			var dc = _this.lib.mapGroupName(g.displayName).trimPrefix("PMs_");
			return _this.pmDynamicGroup(dc, "pmsByDC", _this.lib.mapGroupName(g.displayName));
		},

		"PhysicalMachine": function(g) {
			var obj = g.json ? JSON.parse(g.json) : _.deepClone(g);
			if ((obj.source || {}).type === "Hyper-V") { return null; }
			if ((obj.source || {}).type === "Azure") { return null; }
			if ((obj.source || {}).type === "AWS") { return null; }
			var dc = _this.lib.mapGroupName(g.displayName).trimPrefix("PMs_");
			return _this.pmDynamicGroup(dc, "pmsByDC", _this.lib.mapGroupName(g.displayName));
		},

		"PhysicalMachineByCluster": function(g) {
			var obj = g.json ? JSON.parse(g.json) : _.deepClone(g);
			//if ((obj.source || {}).type === "Hyper-V") { return null; }
			var clusterName = _this.lib.mapGroupName(g.displayName).trimPrefix("PMs_").replace(/\\/g, "/");
			var groupName = "PMs_" + clusterName;
			return _this.pmDynamicGroup(clusterName, "pmsByClusterName", groupName);
		},

		"PhysicalMachineByDataCenter": function(g) {
			var dc = _this.lib.mapGroupName(g.displayName).trimPrefix("PMs");
			var groupName = "PMs_" + dc;
			return _this.pmDynamicGroup(dc, "pmsByDC", groupName);
		},

		"PivotalVmsByDeployment": null,

		"PMsByChassis": null,		// not used (?)

		"PMsByCluster": null,		// not used (?)

		"PMsByCost": null,			// not used (?)

		"PMsByDatacenter": null,	// not used (?)

		"PMsByTargetType": null,	// not used (?)

		"ProxyVMsByTarget": null,	// not used (?)

		"StorageByCluster": null,		// TODO

		"StorageByDataCenter": null,	// TODO

		"StorageByDiskArray": null,		// TODO

		"StorageByLogicalPool": null,	// TODO

		"StorageByServiceLevelCluster": null,	// not used (?)

		"StorageByStorageCluster": function(g) {
			var f = _this.lib.mapGroupName(g.displayName).trimPrefix("Storage_").split("/");
			if (f.length === 1) {
				// No DC included in the group name
				return {
				    "className": "Group",
				    "criteriaList": [
				        {
				            "caseSensitive": false,
				            "expType": "RXEQ",
				            "expVal": f[0].quoteRegexpMeta(true),
				            "filterType": "storageByStorageCluster",
				            "singleLine": false
				        },
				    ],
				    "displayName": "Storage_"+f[0],
				    "groupType": "Storage",
				    "isStatic": false
				};
			} else {
				// Group name has a DC and Cluster name include
				var dc = f.shift();
				var cluster = f.join("/");
				return {
				    "className": "Group",
				    "criteriaList": [
				        {
				            "caseSensitive": false,
				            "expType": "RXEQ",
				            "expVal": cluster.quoteRegexpMeta(true),
				            "filterType": "storageByStorageCluster",
				            "singleLine": false
				        },
				        {
				            "caseSensitive": false,
				            "expType": "RXEQ",
				            "expVal": dc.quoteRegexpMeta(true),
				            "filterType": "storageByDC",
				            "singleLine": false
				        }
				    ],
				    "displayName": "Storage_"+dc+"/"+cluster,
				    "groupType": "Storage",
				    "isStatic": false
				};
			}
		},

		"StorageByTargetType": null,		// not used (?)

		"StorageEntitiesByCluster": null,	// TODO

		"StorageEntitiesByServiceLevelCluster": null,	// TODO

		"STsByCluster": null,				// not used (?)

		"STsByCost": null,					// not used (?)

		"STsByDatacenter": null,			// not used (?)

		"STsByDiskArray": null,				// not used (?)

		"STsBySLCluster": null,				// not used (?)

		"STsBySTCluster": null,				// not used (?)

		"SwitchByNetwork": null,			// TODO

		"SWsByNetwork": null,				// not used (?)

		"VAppsByServiceType": null,			// not used (?)

		"VirtualMachineByBusinessUser": null,	// TODO

		"VirtualMachineByCluster": function(g) {
			var clusterName = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_").replace(/\\/g, "/");
			var groupName = "VMs_" + clusterName;
			return _this.vmDynamicGroup(clusterName, "vmsByClusterName", groupName);
		},

		"VirtualMachineByNetwork": function(g) {
			var netName = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_");
			return _this.vmDynamicGroup(netName, "vmsByNetwork", _this.lib.mapGroupName(g.displayName));
		},

		"VirtualMachineByPhysicalMachine": function(g) {
			var hostName = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_");
			return _this.vmDynamicGroup(hostName, "vmsByPMName", _this.lib.mapGroupName(g.displayName));
		},

		"VirtualMachine": function(g) {
			var hostName = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_");
			return _this.vmDynamicGroup(hostName, "vmsByPMName", _this.lib.mapGroupName(g.displayName));
		},

		"VirtualMachineByServiceLevelCluster": null,

		"VirtualMachineByStorage": function(g) {
			var f = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_").split("/");
			var storage = f.pop();
			var dc = f.join("/");
			return {
			    "className": "Group",
			    "criteriaList": [
			        {
			            "caseSensitive": false,
			            "entityType": null,
			            "expType": "RXEQ",
			            "expVal": dc.quoteRegexpMeta(true),
			            "filterType": "vmsByDC",
			            "singleLine": false
			        },
			        {
			            "caseSensitive": false,
			            "entityType": null,
			            "expType": "RXEQ",
			            "expVal": storage.quoteRegexpMeta(true),
			            "filterType": "vmsByStorage",
			            "singleLine": false
			        }
			    ],
			    "displayName": "VMs_" + _.flatten([f, storage]).join("/"),
			    "groupType": "VirtualMachine",
			    "isStatic": false
			};
		},

		"VirtualMachineByStorageCluster": null,

		"VirtualMachineByVirtualDataCenter": function(g) {
	// TODO - What if the name has no back slashes? ( see 10.10.169.116 for example )
	// TODO - What if the DC is actually a DesktopPool
			var f = _this.lib.mapGroupName(g.displayName).trimPrefix("VMs_").split("/");
			var dc = f.pop();
			var cluster = f.join("/");
			return {
			    "className": "Group",
			    "criteriaList": [
			        {
			            "caseSensitive": false,
			            "expType": "RXEQ",
			            "expVal": dc.quoteRegexpMeta(true),
			            "filterType": "vmsByVDC",
			            "singleLine": false
			        },
			        {
			            "caseSensitive": false,
			            "expType": "RXEQ",
			            "expVal": cluster.quoteRegexpMeta(true),
			            "filterType": "vmsByClusterName",
			            "singleLine": false
			        }
			    ],
			    "displayName": "VMs_" + _.flatten([f, dc]).join("/"),
			    "groupType": "VirtualMachine",
			    "isStatic": false
			};
		},

		"VMsByAccount": null,

		"VMsByBusinessUser": null,

		"VMsByCluster": null,

		"VMsByNetwork": null,

		"VMsByOrgVDC": null,

		"VMsByResourceGroup": null,

		"VMsBySLCluster": null,

		"VMsBySTCluster": null,

		"VMsByStorage": null,

		"VMsByTarget": null,

		"VMsByTargetType": function(g) {
			g = JSON.parse(g.json);
			if (g.cloudType === "AZURE" || g.cloudType === "AWS") {
				return {
				    "cloudType": g.cloudType,
				    "criteriaList": [
				        {
				            "caseSensitive": false,
				            "expType": "EQ",
				            "expVal": g.cloudType,
				            "filterType": "vmsByCloudProvider",
				            "singleLine": false
				        }
				    ],
				    "displayName": g.displayName,
				    "groupType": "VirtualMachine",
				    "isStatic": false,
				    "logicalOperator": "AND",
				};
			}
			return null;
		},

		"WorkloadByAccount": null,

		"WorkloadByResourceGroup": null
	},


	allCloud: function(g, type, filter, exprVal) {
		g = JSON.parse(g.json);
		if (!g.isStatic && !g.criteriaList && g.groupType === type) {
			return {
			    "className": "Group",
			    "criteriaList": [
			        {
			            "caseSensitive": false,
			            "expType": "EQ",
			            "expVal": exprVal,
			            "filterType": filter,
			            "singleLine": false
			        }
			    ],
			    "displayName": _this.lib.mapGroupName(g.displayName),
			    "entityTypes": [ type ],
			    "groupType": type,
			    "isStatic": false,
			    "logicalOperator": "AND",
			    "memberTypes": [ type ]
			};
		}
		return null;	// otherwise static
	},


	hotAdd: function(g, filter) {
		return {
		    "className": "Group",
		    "criteriaList": [{
	            "caseSensitive": false,
	            "entityType": null,
	            "expType": "EQ",
	            "expVal": "true",
	            "filterType": filter,
	            "singleLine": false
	        }],
		    "displayName": _this.lib.mapGroupName(g.displayName),
		    "entityTypes": [ "VirtualMachine" ],
		    "groupType": "VirtualMachine",
		    "isStatic": false,
		    "logicalOperator": "AND",
		    "memberTypes": [ "VirtualMachine" ]
		};
	},

	allEntitiesOfType: function(g, type) {
		return {
		    "className": "Group",
		    "criteriaList": [],
		    "displayName": _this.lib.mapGroupName(g.displayName),
		    "entityTypes": [ type ],
		    "groupType": type,
		    "isStatic": false,
		    "logicalOperator": "AND",
		    "memberTypes": [ type ]
		};
	},

	staticGroupOfGroups: function(g, uuids) {
		return {
		    "className": "Group",
		    "groupType": "Group",
		    "isStatic": true,
		    "memberUuidList": uuids
		};
	},


	// migrate-groups will patch these to have real logic before use.

	internalHostsGroupUuid: function() { return "1234000000"; },
	internalZonesGroupUuid: function() { return "1235000000"; },
	hotAddMemoryGroupUuid:  function() { return "1236000000"; },
	hotAddCpuGroupUuid:     function() { return "1237000000"; },


	// Refer to DefaultGroups.group.topology on classic. Names here must match group internal names in that filse
	// (stripped of the "GROUP-" prefix).

	defaultGroupsByName: {
		"AllVirtualMachine": function(g) { return _this.allEntitiesOfType(g, "VirtualMachine"); },

		"MyGroups": function(g) { throw "Un-migratable group"; },

		"CloudDBSs": function(g) { return _this.allCloud(g, "DatabaseServer", "databaseServerByCloudProvider", "AZURE|AWS"); },
		"CloudDBs": function(g) { return _this.allCloud(g, "Database", "databaseByCloudProvider", "AZURE"); },
		"CloudPMs": function(g) { return _this.allCloud(g, "Zone", "zoneByCloudProvider", "AZURE|AWS|SOFTLAYER"); },
		"CloudVMs": function(g) { return _this.allCloud(g, "VirtualMachine", "vmsByCloudProvider", "AZURE|AWS"); },

		// Workloads are VMs, DBs and DBSs
		"CloudWorkloads": null,
		"CloudSTs": null,
		"CloudDAs": null,

		// Hot add groups
		"VimVMHotAddMem": function(g) { return _this.hotAdd(g, "vmsHotAddMemory" ); },
		"VimVMHotAddCPU": function(g) { return _this.hotAdd(g, "vmsHotAddCPU" ); },
		"ResizeAutomated": function(g) { return _this.staticGroupOfGroups(g, [_this.hotAddCpuGroupUuid(), _this.hotAddMemoryGroupUuid()] );},

		// In XL hosts are "ON Prem" by definition - so this is equivalent to "all hosts"
		"OnPremPMs": function(g) { return _this.allEntitiesOfType(g, "PhysicalMachine"); },
		"PhysicalMachine": function(g) {return _this.staticGroupOfGroups(g, [_this.internalHostsGroupUuid(), _this.internalZonesGroupUuid()] ); },
		"BusinessApplication": function(g) { return _this.allEntitiesOfType(g, "BusinessApplication"); },

		"PhysicalMachineByDataCenter": function(g) { throw "Un-migratable group"; },
//		function(g) {
//			if (_this.chassisPresent()) {
//				return null;	// The presense of Chasis means we have to go static.
//			} else {
//				return _this.staticGroupOfGroups(g, [_this.internalHostsGroupUuid(), _this.internalZonesGroupUuid()] );
//			},
//		},

		"PhysicalMachineByChassis": function(g) { throw "Un-migratable group"; },

		"PhysicalMachineByChassisOrDataCenter": function(g) {return _this.staticGroupOfGroups(g, [_this.internalHostsGroupUuid(), _this.internalZonesGroupUuid()] ); },

		// Includes Application, ApplicationServer, DatabaseServer in classic
		"Application": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationByPhysicalMachine": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationByType": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationServer": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationServerByType": function(g) { throw "System 'Application' groups are not migratable"; },

		"AWSAccounts": function(g) {
			return {
			    "className": "Group",
			    "criteriaList": [
			        {
			            "caseSensitive": false,
			            "expType": "EQ",
			            "expVal": "AWS",
			            "filterType": "businessAccountCloudProvider",
			            "singleLine": false
			        }
			    ],
			    "displayName": _this.lib.mapGroupName(g.displayName),
			    "groupType": "BusinessAccount",
			    "isStatic": false,
			    "logicalOperator": "AND",
			};
		},

		"AzureAccounts": function(g) {
			return {
			    "className": "Group",
			    "criteriaList": [
			        {
			            "caseSensitive": false,
			            "expType": "EQ",
			            "expVal": "AZURE",
			            "filterType": "businessAccountCloudProvider",
			            "singleLine": false
			        }
			    ],
			    "displayName": _this.lib.mapGroupName(g.displayName),
			    "groupType": "BusinessAccount",
			    "isStatic": false,
			    "logicalOperator": "AND",
			};
		}
	},

	set: function(name, value) {
		_this[name] = value;
	}
};

exports = _this;
