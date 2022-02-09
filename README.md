
### TbMigrate 4.2

# Important Note: Use cases.

_The TbMigrate tool, provided here, assists in migrating configuration from a Turbonomic V6 instance to a V8 one (or CWOM 2 to 3)._

_If, however you need a way to migrate configuration from one Turbonomic V8 instance to another, then you should use the [TbUtil HOT-WARM tool](https://github.com/turbonomic/tbutil/wiki/K8S-HOTWARM) in "single-shot" mode instead (although, that is not its primary use case)._


# Note: Issues caused by proxy configuration.

Some customers have reported (January 2022) that the setting of credentials for the XL instance may fail when a proxy is configured in the classic instance. If you get "EOF", "context deadline exceeded" or similar errors when setting the XL instance credentials then exit the utility (press control-C), run the following command and then try running it again. If you log out and back in the error will resurface so you will need to repeat this step.

```
export http_proxy="" HTTP_PROXY="" https_proxy="" HTTPS_PROXY=""
```


# Version compatibility

This release of the migration tool has been tested with Turbonomic versions 8.3.0 (CWOM 3.1.0) and 8.4.0 (CWOM 3.2.0).

For migrating to 8.2.x (CWOM 3.0.x) releases, please use [version 3.15 of "TbMigrate"](https://github.com/turbonomic/tbmigrate/blob/3.15/README.md)

For migrating to releases after 8.4.0 (CWOM 3.2.0), we **highly** recommend the following work flow..

1. Install Turbonomic 8.4.0 (CWOM 3.2.0)
2. Run the migration to completion.
3. Update to the latest release

For release 8.5.0 (CWOM 3.3.0) and later, the above approach is mandatory.


# Documentation

The documentation for this tool can be found in the Appendix with the title "Migrating Turbonomic From Classic to XL" in the Turbonomic 8.4.0 installation guide. See: http://docs.turbonomic.com.

The FAQ (Frequenty Asked Questions) document [can be read here](FAQ.md).

Notes on reviewing the migration results [can be read here](src/REVIEW-CLASSIC_TO_XL.md).


# Downloading

Please [follow this link](DOWNLOAD.md) for information about downloading the latest version.

