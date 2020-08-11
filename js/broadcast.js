/* global sshConnect, dnsLookup */

var conn = sshConnect(client.getCredentialKey());
var dnsTunnel = conn.tunnel("169.254.25.10:53", false);
var ips = dnsLookup("topology-processor.turbonomic.svc.cluster.local.", dnsTunnel.address);
dnsTunnel.close();

var tun = conn.tunnel(ips[0]+":8080", false);
var api = newClient("http://"+tun.address+"/");
var rtn = api.http.post("/TopologyService/requestTopologyBroadcast", null, {});

printJson(rtn);

tun.close();
