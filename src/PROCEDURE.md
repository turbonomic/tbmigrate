# Prodedure for script-assisted migration of Classic to XL Turbonomic instance.

## Scope

This process will migrate (when the logic is complete)..

- Targets
- Policies and schedules
- Templates
- Custom Groups
- Groups used to scope policies and targets.


## Exclusions

Migration of multiple classic instances to a single XL instance is not handled. The tool migrates a single classic to a single XL.

The following elements are not handled..

- Historic data.
- Dashboards and widgets.
- Users and groups.
- Email and trap notification configuration.
- Email server configuration.
- Reports and report templates.
- Plans.
- Placement and reservations.
- Billing and cost configuration.
- License.
- Data retention configuration.
- HTTP Proxy configuration.
- Logging levels.
- Support options.
- Action scripts and orchestration configuration.

Note: at the time of writing, not all target types have been tested against, due to limitations in the lab.


## Preparation

Bring your classic instance up to the latest release if it is older than 6.4.15 (TO BE CONFIRMED).

Bring your XL instance up to the latest release if it is older than 7.22.4 (TO BE CONFIRMED)

Ensure you know..

- IP address used to access both SSH (putty) and the UI of the classic instance.
- IP address used to access the UI of the XL instance.
- SSH login credentials for the classic instance.
- UI administrator credentials for both the classic and XL instances.

Check that ..

- You can SSH to the classic instance.
- You can access the REST API of the XL instance from the classic instance.
   - Test this by logging in to the classic instance using SSH "putty" or similar and running
      - `curl -k https://XL_INSTANCE_IP/vmturbo/rest/cluster/isXLEnabled && echo`
   - If all is well, you should see the word "true".
- You can log in to the UI of both the classic and XL instances using the administrator account.
- Your classic instance's configuration is "good". In particular, you should resolve the following..
   - Templates, groups or policies with duplicate names.
   - Policies or targets that are scoped to now-deleted groups.
   - Schedules that start and end in the past.
   - Targets that are not "validated".

## Procedure


### Install the tool on the classic instance.

- Download the latest `tbmigrate-VERSION_NUMBER.tgz` tarball and copy to the `/tmp` directory of the classic instance.
   - Download URL : TO BE DEFINED.
- Log in to the classic instance using "putty" or other SSH client.
- Un-tar the tarball
   - `cd $HOME`
   - `tar xvfz /tmp/tbmigrate-VERSION_NUMBER.tgz --no-same-owner`


### Change freeze

Once you start the migration process, you should avoid making any configuration changes to either the XL or Classic instances until it is complete or you elect to abort the process (unless the scripts recommend that you make a change).

Once the migration is complete, then you are free to make further changes but you should ensure that the equivalent changes are made on both instances as appropriate, Further note that you should NOT re-run the migration tool or your manual changes may be lost and all actions will be disabled.


### Logs

The ".log" files in the tbmigrate/logs directory contain the log output of each step. You should review these carefully to ensure that elements that could not be migrated completely do not negatively impact your environment.


### Safety net

Note that the tool sets the "disable all actions" setting to "true" on the XL instance. This means that the XL will show no actions but will be collecting metrics and storing them in it's historical database. This allows you to verify the configuration and allows XL to collect enough historical data over time to properly refine the actions that consider the impact of history.

We recommend running XL and classic in parallel for a time (a month is typical) to allow XL to collect the needed history. Once you are happy to cut over from classic to XL you first disable actions on the classic and then enable them on XL.


### Configure credentials for both instances.

When logged in to the classic instance ...

- `cd $HOME/tbmigrate`
- `sh setup.sh`
   - Answer the questions asked


### Gather the current configuration.

Under normal circumstances, the encrypted passwords will be included in the collection. This means that you will not need to enter them yourself during the target migration phase. If you prefer NOT to collect this info (meaning you'll have to enter it by hand) then add the "-skip-passwords" option to the command below.

- Either: to include passwords, run:
   - `sh collect-data.sh 1`
- Or: to skip password collection, run:
   - `sh collect-data.sh -skip-passwords 1`
- Confirm that no errors are reported.


### Migrate un-scoped targets.

In this step, we migrate all targets that are not scoped to groups.

> **Note**
>
> Scoped targets can only be migrated after the groups to which they apply have been created. These groups in turn can only be created once the entities they contain have been discovered. These factors mean we need to discover targets in two phases, like this.
>
> 1. Discover un-scoped targets (those that have no connection to a specific group).
> 2. Wait for discovery to complete.
> 3. Create groups.
> 4. Discover any remaining scoped targets, now that the groups they reference are known.

Run the following command to execute the first of these steps:

- `sh migrate-targets.sh 1`
   - After a brief delay, an interactive selector will be displayed. This shows you the targets that CAN be migrated (they have a tick on the left) and those that CANT (marked with an "X").
   - Use the UP and DOWN arrow keys to move from target to target and view the message shown at the bottom of the screen for each one. Take a note of any that need to have the supporting mediation pod enabled on XL. Targets marked with a tick can be deselected by pressing the space bar if you wish.
   - Once you have finished viewing and selecting the targets to migrate, press the ESC key to exit the selector.
   - If you then select "Yes", the migration will continue with the selected targets (if any).
   - If you select "No", the migration will abort and you can use "Helm" or the Operator to add the missing mediation probes to XL (if any).
   - If you needed to update the XL probles, then re-run this script when you're done, make your selection, press ESC and then select "Yes" to start the migration.
   - Confirm that no errors are reported.
   - Take a note of whether the output from the script ends with the message "There are some scoped targets to be migrated later."


### Migrate KubeTurbo (if relevant)

The script does not migrate "KubeTurbo" targets for you. If you use it, then you will need to update your KubeTurbo configuration to point to the XL manually.

If you have groups or policies that depend on topology discovered by "KubeTurbo" then we recommand that you make the relevant changes at this point in the process.


### Wait.

Allow the targets just migrated to validate and discover the topology.

You can monitor this in the UI or use the following shell commands to see the supply chain and target statuses.

- `bin/tbutil @xl list supplychain`
- `bin/tbutil @xl list targets -l`

You can use the "watch" tool to re-run either of these repeatedly, until you stop it by pressing Control-C. For example:

- `watch -n 10 bin/tbutil @xl list supplychain`

The message "`WOOPS! Supplychain object not found`" indicates that no entities have been discovered, and (provided one or more targets have validated) indicates that discovery has not yet generated any toplogy.

A couple of hints..

- Be aware that the numbers shown may increase over time as more targets complete their discovery. You should wait until all discovery is complete.
- At this point in the procedure, the global setting "Disable all actions" is turned on in XL, so the supply chain will show all green and no actions will be reported. This is as expected.

When finished with the "watch" session, press Control-C to stop the command.

If there are target validation issues then you can change credentials etc using the UI, and trigger re-validation and re-discovery.

Once all the targets are validated and discovery is complete, you can continue to ..


### Gather the updated XL topology data.

The toplogy of the XL instance has changed since you did the original "Gather" step, so it needs to be repeated now.

- `sh collect-data.sh 2`


### Migrate groups

Migrate the custom and scope groups that can be created from the un-scoped targets.

- `sh migrate-groups.sh 1`


### Migrate scoped targets, if any

If the earlier "Migrate un-scoped targets" step displayed the message "There are some scoped groups to be migrated later", then you need to migrate them now. If the message "There are no outstanding scoped targets" was reported then you can skip the next few steps, and jump to "Migrate templates".

- `sh migrate-targets.sh 2`
   - Answer any questions that are asked.
   - Note any targets that cannot be migrated due to absence of the required mediation probe pods
      - To add them: exit the selector by pressing ESC and selecting "No" - and then turn to the XL instance to enable the missing PODs. Once they are up and running, you can re-run this step.
      - TODO : add notes on how to do that.
   - Confirm that no errors are reported.


### Wait.

Wait for the new targets to be validated and for discovery to complete (see above)


### Gather the updated XL topology data.

Once the target discovery is complete, you should re-run the XL topology gathering one more time..

- `sh collect-data.sh 3`


### Migrate additional groups

Update the groups using the updated topology.

- `sh migrate-groups.sh 2`


### Migrate templates

Migrate the templates.

- `sh migrate-templates.sh`


### Migrate policies.

Migrate the default, automation and placement policies. This copies automation settings from classic to XL that match ALL the following criteria..

- The setting has been changed in classic (ie: it has a value different from it's default).
- The setting has an equivalent in XL.

Placement policies are also migrated in this step.

If the process finds any settings in classic that cannot be mapped into XL (or visa-versa), then a suitable warning message will be printed.

Run the following command..

- `sh migrate-policies.sh`


### Cut-over

Once all the above steps are complete, the XL instance is configured to be as similar as possible to the Classic instance, but you should verify that the configuration is as you expect. In particular, review the warnings and errors that came from the steps above and consider whether they may have an impact on your environment.

We recommend allowing XL (with actions turned off) and classic (with actions turned on) to run in parallel for at least the length of time you require historical metrics to be collected for - particularly for the purpose of controlling the timing of resize actions.

This is a good point to address the configuration settings that are not migrated by the script. This includes the configuration items listed in the "exclusions" section at the top of this document.

Once you are happy that sufficient history has been collected and that the configuration of XL is correct then you can cut the management of your estate over from classic to XL. There are two steps to this process and the order is important.

- First: set "disable all actions" to true in classic and wait for all actions to be cleared down.
- Then: set "disable all actions" to false in XL.

It is important that the classic and XL instances are not both taking actions at the same time.

If you want to review the actions that XL would take before cutting over, you could...

- Change XL policies to set all AUTOMATED actions to RECOMMENDED in XL.
- Set XL's "disable all actions" to false.

This will allow XL to recommend actions that you can review. Please note that the two systems will not present identical sets of actions and there are many valid reasons for this.

If you go down this route, then the cut-over process becomes:

- First: set "disable all actions" to true in classic and wait for all actions to be cleared down.
- Then: change your XL policies to configure the required actions back to "AUTOMATED".

