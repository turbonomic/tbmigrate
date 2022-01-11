### TbMigrate Frequently Asked Questions

## Where can I find the latest version of TbMigrate?

The published editions are always available in the [Turbonomic GitHub](https://github.com/turbonomic/tbmigrate) with each release named by the version number.

We always recommend using the latest available version.

## Where is the TbMigrate documentation?

You can find the documentation in the Turbonomic Installation Guide under Appendix C which is [available here.](https://docs.turbonomic.com)

Notes on reviewing the migration results [can be read here](src/REVIEW-CLASSIC_TO_XL.md).

## There is an error, what should I do?

Sometimes, things don't go 100% right but it may be by design due to some changes in architecture between Turbonomic 6 and Turbonomic 8.  

View logs in the interactive menu by pressing “L” which opens up the log for you or check log files in $HOME/tbmigrate/text-logs directory.

## Why are there no actions in XL?

This is deliberate because you would not want two Turbonomic instances managing the same environment at the same time.

Actions can be enabled in your Turbonomic 8 instance when you're ready to switch over to it by turning OFF the "disable all actions" switch in the global default settings - but this should only be done AFTER turning the same switch to ON in your Turbonomic 6 instance.

## It's taking a long time to migrate groups. Is it expected?

This is expected with large environments which have more groups created.  This will take more time but be patient and the utility will let you know when it is completed.

## Can I migrate targets and come back to do the rest next week/month?

We recommend doing it all on the same day. It may need two sessions if your targets take a long to finish discovery.

### Session 1: steps 1 to 3

Wait 20-60 minutes for the environment discovery to complete

### Session 2: (later the same day) the rest

## Will the XL instance be an exact copy of the classic?

No – a number of minor differences in naming conventions, entity types, available targets, and other small changes in the architecture may result in the Turbonomic 8 target looking slightly different than your Turbonomic 6 source instance.

## How long should I wait between steps 3 and 4 (and 6 and 7, if needed)?

It all depends on the size of your environment, infrastructure performance, network latency – all that performance stuff that needs auto-managing :)

You need to be sure that all target discovery has 100% finished AND that the groups component has completed its task.
You can check the Turbonomic supply chain view in the UI to make sure ALL the expected elements are included and the search UI to look for auto-generated groups.

NOTE: you will NOT see any colour other than green because we have disabled actions by default in the new instance. 

To be safe, wait for at least another 20 minutes before moving to step 4 (or 7). The longer you leave it, the better – but avoid the temptation of leaving more than 24 hours.

## Why are some dynamic groups from Turbonomic 6 changed to static groups in Turbonomic 8?

Because Turbonomic 8 has different dynamic group filters than Turbonomic 7, some legacy groups may not supported in Turbonomic 8 and will need to be recreated using the new filters.


## Why are some elements reported as "not found" during group migration?

There are several possible reasons for this.
* The elements may have changed naming convention.
* The target logic may mean that some elements are no longer populated into our topology.
* The element may be "stale" in Turbonomic 6 due to discovery failures.
* The target may have failed to discover in Turbonomic 8.
* The element may not longer be supported (for example: GuestLoad)


## What happens if the SSH connection breaks mid-way through the migration?

It depends on when this happens. But generally, it is not great news. You may be able to recover by restarting the step at which the failure occurred – but you need to make sure that the old copy of the tool is not still running first.
Avoid the problem using the old DevOps favourite utility: ["screen"](https://blog.turbonomic.com/why-the-screen-utility-will-change-your-remote-ssh-approach).


## How can I check the results of the migration?

Detailed notes on reviewing the migration [can be read here](src/REVIEW-CLASSIC_TO_XL.md).


## How can I fix errors when configuring credentials for the XL instance?

Some customers have reported (January 2022) that the setting of credentials for the XL instance may fail when a proxy is configured in the classic instance. If you get "EOF", "context deadline exceeded" or similar errors when setting the XL instance credentials then exit the utility (press control-C), run the following command and then try running it again. If you log out and back in the error will resurface so you will need to repeat this step.

```
export http_proxy="" HTTP_PROXY="" https_proxy="" HTTPS_PROXY=""
```
