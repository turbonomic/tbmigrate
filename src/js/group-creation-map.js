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

/*
	copyByTarget: function(type, name, clazz) {
		this.type = type;
		this.name = name;
		this.clazz = clazz;
	},
*/

	creatorMap: {
		"AppByPM": null,

		"ApplicationByPhysicalMachine": null,

		"ApplicationByType": null,

		"ApplicationServerByType": null,

		"AppsByDataCenter": null,

		"AppsByTarget": null,

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

//		"VMsByTarget": function(g) {
//			var f = g.displayName.trimPrefix("VMs_").split(":");
//			if (f.length === 2) {
//				return new _this.copyByTarget(f[0], f[1], "VirtualMachine");
//			} else {
//				return null;
//			}
//		},

		"VMsByTargetType": null,

		"WorkloadByAccount": null,

		"WorkloadByResourceGroup": null
	}
};

exports = _this;
