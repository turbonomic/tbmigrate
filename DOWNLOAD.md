# Downloading TbMigrate 4.1

| Description | Value |
| ---- | ----- |
| Tool Version | 4.1 |
| Relased | 20th August 2021 |
| Download From | https://github.com/turbonomic/tbmigrate/raw/4.1/dist/tbmigrate-4.1.tgz |
| MD5 Check sum | 8a88c8c30ba84394328dc68500e08a62 |

## Compatibility

This version of the migration tool is for use with Turbonomic 8.3.0. We recommend upgrading to that release before using it.


## If your V6.4 instance has access to the internet

If your V6.4 instance has access to the internet, you can download the tool directly from its linux command line like this:

1. Log in to the V6.4 instance as the "root" user using "putty" or other SSH client tool of your choice.
2. Type the following commands..
   * `cd /tmp`
   * `curl -LO https://github.com/turbonomic/tbmigrate/raw/4.1/dist/tbmigrate-4.1.tgz`
   * `md5sum tbmigrate-4.1.tgz`

The session will look like this...

```
[root@turbonomic ~] cd /tmp

[root@turbonomic tmp] curl -LO https://github.com/turbonomic/tbmigrate/raw/4.1/dist/tbmigrate-4.1.tgz
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   150  100   150    0     0    756      0 --:--:-- --:--:-- --:--:--   757
100 15.4M  100 15.4M    0     0  19.7M      0 --:--:-- --:--:-- --:--:-- 29.8M

[root@turbonomic tmp] md5sum tbmigrate-4.1.tgz
8a88c8c30ba84394328dc68500e08a62  tbmigrate-4.1.tgz
```

The string `8a88c8c30ba84394328dc68500e08a62` in the last line is important - it tells you that the file has been downloaded correctly. If you have a different value there, then something has gone wrong.

## If your V6.4 instance does NOT have access to the internet

The way you should download the tool depends on how your environment is set up.

A typical approach would be...

1. Use a browser on your laptop to download the file from https://github.com/turbonomic/tbmigrate/raw/4.1/dist/tbmigrate-4.1.tgz 
2. Copy it to your jump host (if you use one).
3. Copy it from your jumphost (or laptop) onto the V6.4 instance using the free "WinScp" tool or something similar. Place the in the "/tmp" directory.
4. Log in to the V6.4 instance as the "root" user using "putty" or something similar.
5. Type the following commands..
   * `cd /tmp`
   * `md5sum tbmigrate-4.1.tgz`
6. Check that you see the string `8a88c8c30ba84394328dc68500e08a62` - that means that the file has been downloaded correctly.

