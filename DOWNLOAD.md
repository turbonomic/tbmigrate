# Downloading TbMigrate 3.8

| Description | Value |
| ---- | ----- |
| Tool Version | 3.8 |
| Download From | https://github.com/turbonomic/tbmigrate/raw/master/dist/tbmigrate-3.8.tgz |
| MD5 Check sum | a4ad47fed9504fd515c87e8cf2a20399 |


## If V6.4 instance has access to the internet

If your V6.4 instance has access to the internet, you can download the tool directly from the linux command line as follows..

1. Log in to the V6.4 instance as the "root" user using "putty" or other SSH client tool or your choice.
2. Type the following commands..
   * `cd /tmp`
   * `curl -LO https://github.com/turbonomic/tbmigrate/raw/master/dist/tbmigrate-3.8.tgz`
   * `md5sum tbmigrate-3.8.tgz`

The session will look like this...

```
[root@turbonomic ~] cd /tmp
[root@turbonomic tmp] curl -LO https://github.com/turbonomic/tbmigrate/raw/master/dist/tbmigrate-3.8.tgz
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   150  100   150    0     0    756      0 --:--:-- --:--:-- --:--:--   757
100 15.4M  100 15.4M    0     0  19.7M      0 --:--:-- --:--:-- --:--:-- 29.8M
[root@turbonomic tmp] md5sum tbmigrate-3.8.tgz
a4ad47fed9504fd515c87e8cf2a20399  tbmigrate-3.8.tgz
```

The string `a4ad47fed9504fd515c87e8cf2a20399` in the last line is important - it tells you that the file has been downloaded correctly. If you have a different value there, then something has gone wrong.

## If V6.4 instance has no access to the internet

The way you should download the tool depends on how your environment is set up. A common approach would be...

1. Use a browser to download the file from https://github.com/turbonomic/tbmigrate/raw/master/dist/tbmigrate-3.8.tgz 
2. Copy it to your jump host (if you use one).
3. Copy it from your laptop or jumphost onto the V6.4 instance using the "WinScp" tool or your chosen alternative. Place it in the "/tmp" directory.
4. Log in as the "root" user to the V6.4 instance using "putty" or something similar.
5. Type the following commands..
   * `cd /tmp`
   * `md5sum tbmigrate-3.8.tgz`
6. Check that you see the string `a4ad47fed9504fd515c87e8cf2a20399` - that means that the file has been downloaded correctly.

