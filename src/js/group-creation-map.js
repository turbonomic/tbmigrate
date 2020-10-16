var _this = {
	dynamicGroup: function(groupType, match, filterType, dispName) {
		return {
		    "className": "Group",
		    "criteriaList": [
		        {
		            "caseSensitive": false,
		            "expType": "RXEQ",
		            "expVal": match.quoteRegexpMeta(true),
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


	creatorMap: {
		"AppByPM": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ApplicationByPhysicalMachine": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ApplicationByType": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ApplicationServerByType": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"AppsByDataCenter": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"AppsByTarget": function(g) { throw "Dynamic 'Application' groups are not migratable"; },

		"ChassisByNetwork": null,

		"CHsByNetwork": null,

		"ContainerByDataCenter": null,

		"ContainerByTarget": null,

		"ContainerByVM": null,

		"ContainerPodByDataCenter": null,

		"ContainerPodByTarget": null,

		"ContainerPodByVM": null,

		"DAsByStorageController": null,

		"DatabaseByType": null,

		"DBsByAccount": null,

		"DBsByResourceGroup": null,

		"DBSsByAccount": null,

		"DBSsByResourceGroup": null,

		"DiskArrayByStorageController": null,

		"EntitiesByCluster": null,

		"IOModuleByChassis": null,

		"IOsByChassis": null,

		"LogicalPoolByDiskArray": null,

		"LPsByStorageController": null,

		"PhysicalMachineByChassis": null,

		"PhysicalMachineByChassisOrDataCenter": function(g) {
			var dc = g.displayName.trimPrefix("PMs_");
			return _this.pmDynamicGroup(dc, "pmsByDC", g.displayName);
		},

		"PhysicalMachineByCluster": function(g) {
			var clusterName = g.displayName.trimPrefix("PMs_").replace(/\\/g, "/");
			var groupName = "PMs_" + clusterName;
			return _this.pmDynamicGroup(clusterName, "pmsByClusterName", groupName);
		},

		"PhysicalMachineByDataCenter": function(g) {
			var dc = g.displayName.trimPrefix("PMs");
			var groupName = "PMs_" + dc;
			return _this.pmDynamicGroup(dc, "pmsByDC", groupName);
		},

		"PivotalVmsByDeployment": null,

		"PMsByChassis": null,

		"PMsByCluster": null,

		"PMsByCost": null,

		"PMsByDatacenter": null,

		"PMsByTargetType": null,

		"ProxyVMsByTarget": null,

		"StorageByCluster": null,

		"StorageByDataCenter": null,

		"StorageByDiskArray": null,

		"StorageByLogicalPool": null,

		"StorageByServiceLevelCluster": null,

		"StorageByStorageCluster": function(g) {
			var f = g.displayName.trimPrefix("Storage_").split("\\");
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

		"StorageByTargetType": null,

		"StorageEntitiesByCluster": null,

		"StorageEntitiesByServiceLevelCluster": null,

		"STsByCluster": null,

		"STsByCost": null,

		"STsByDatacenter": null,

		"STsByDiskArray": null,

		"STsBySLCluster": null,

		"STsBySTCluster": null,

		"SwitchByNetwork": null,

		"SWsByNetwork": null,

		"VAppsByServiceType": null,

		"VirtualMachineByBusinessUser": null,

		"VirtualMachineByCluster": function(g) {
			var clusterName = g.displayName.trimPrefix("VMs_").replace(/\\/g, "/");
			var groupName = "VMs_" + clusterName;
			return _this.vmDynamicGroup(clusterName, "vmsByClusterName", groupName);
		},

		"VirtualMachineByNetwork": function(g) {
			var netName = g.displayName.trimPrefix("VMs_");
			return _this.vmDynamicGroup(netName, "vmsByNetwork", g.displayName);
		},

		"VirtualMachineByPhysicalMachine": function(g) {
			var hostName = g.displayName.trimPrefix("VMs_");
			return _this.vmDynamicGroup(hostName, "vmsByPMName", g.displayName);
		},

		"VirtualMachineByServiceLevelCluster": null,

		"VirtualMachineByStorage": function(g) {
			var f = g.displayName.trimPrefix("VMs_").split("\\");
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
			var f = g.displayName.trimPrefix("VMs_").split("\\");
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

		"VMsByTargetType": null,

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
			    "displayName": g.displayName,
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
		    "displayName": g.displayName,
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
		    "displayName": g.displayName,
		    "entityTypes": [ type ],
		    "groupType": type,
		    "isStatic": false,
		    "logicalOperator": "AND",
		    "memberTypes": [ type ]
		};
	},

	// Refer to DefaultGroups.group.topology on classic. Names here must match group internal names in that filse
	// (stripped of the "GROUP-" prefix).
	defaultGroupsByName: {
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

		// In XL hosts are "ON Prem" by definition - so this is equivalent to "all hosts"
		"OnPremPMs": function(g) { return _this.allEntitiesOfType(g, "PhysicalMachine"); },
		"BusinessApplication": function(g) { return _this.allEntitiesOfType(g, "BusinessApplication"); },

		// Includes Application, ApplicationServer, DatabaseServer in classic
		"Application": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationByPhysicalMachine": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationByType": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationServer": function(g) { throw "System 'Application' groups are not migratable"; },
		"ApplicationServerByType": function(g) { throw "System 'Application' groups are not migratable"; }

	}
};

exports = _this;
