# Migration from CWOM to IWO

## Introduction

The IWO system is a new platform to manage application performance to the same standards you are used to with the CWOM family. It introduces a SAAS component-based architecture that can manage larger environments, as well as enhancements to the supply chain and user interface that emphasize the management and performance of your applications.

Because of these changes, you must migrate to the IWO system – You cannot perform a simple update like you would to update to a later version of the same family. A migration transfers your group, policy, and other selected data from your CWOM installation, into the IWO installation.

We provide a tool to perform part of the migration automatically. You set the IP address and credentials of your CWOM installation and URL and credentials for your IWO installation in the tool. It then discovers the data that it can migrate, and loads that data into the IWO installation. The tool migrates:

* Custom groups
* Discovered groups used to scope policies, etc
* Templates
* Policies and schedules

Limitations

Please be aware of the following limitations to the migration tool:

* You should not migrate multiple instances of CWOM installations to a single IWO installation using the tool.

  You should only migrate a single CWOM instance to a single IWO instance.

  If you want to migrate multiple instances, please contact your support representative.

* The tool does not migrate the following:
   * Target configurations
   * Your current license
   * Historical data
   * Dashboards and charts
   * Plans
   * Placements and reservations
   * Billing and cost configuration
   * Action scripts and orchestration configurations
   * Email and trap notification configuration
   * Reports and report templates
   * Data retention configuration
   * Email server configuration
   * HTTP Proxy configuration
   * SSO configurations
   * Logging levels
   * Support options
   * Users and user groups, including Local and Active Directory user accounts

Note that IWO and CWOM support some different targets. If you use targets in CWOM that are not available in IWO you may see some differences in the discovered estate topology.

## Preparing your CWOM and IWO Instances

Before you can migrate, you must prepare the CWOM instance for the migration. It must be updated to the correct version, and you must have access to it via a secure shell session (SSH).

* Update your CWOM instance to XX.XX.XX or later.

  The tool requires that your CWOM instance is no earlier than XX.XX.XX.

* Gather IP addresse or URL and credentials to access both instances

  Ensure that you know:
   * The IP address used to access both SSH (putty) and the UI of the CWOM instance
   * SSH login credentials for the CWOM instance
   * The IP address used to access the UI of the IWO instance
   * UI administrator credentials for both the CWOM and IWO instances
   * Ensure that you have credentials for an Administrator user account through the user interfaces of the CWOM and the IWO instances.

* Ensure that you have a valid license on the IWO instance.

  If you do not have a valid license on the IWO version, then the migration tool cannot execute.

* Double-check your access to the Turbonomic instances

  Ensure that you can:

   * Log into a secure shell session (SSH) on the CWOM instance
   * Log in to the UI of both the CWOM and IWO instances of Turbonomic via the administrator account.

  Ensure that your CWOM instance has access to IWO by using the "curl" command from the CWOM shell to download the IWO home page source.

* If you have deployed Kubeturbo in your CWOM environment, deploy Kubeturbo for IWO.

  The tool does not migrate Kubeturbo deployments. This stage in the migration process is the perfect time to deploy Kubeturbo to operate with your IWO installation. For more information, see the Kubeturbo github repository, located at https://github.com/turbonomic/kubeturbo.

  If you declared (on your CWOM instance) groups or policies that rely on the topology that Kubeturbo discovers, then you should manually create them in the IWO instance. Note that the IWO instance creates different entity types for your container infrastructure. Your associated groups and policies will use this new topology model.

* Ensure that all the targets in your environment are in a Valid state.

  The migration tool will not configure targets on the IWO instance; you need to populate them by hand first, matching all the parameters and credentials used in the CWOM instance. Mis-matches may cause problems later.

  Before running the migration, you should ensure that all the targets validate in both instances. Either correct any issues, or delete the target that does not validate.

  If you delete a target before migrating, or if the target matching fails, then the migration will not contain any groups that Turbonomic discovers to support that target. As a result, if you have any policies that rely on these discovered groups for scope, that scope will no longer exist. You should understand how policies use the given target's scope, and clean up or delete any policies that will have en empty scope because the target was removed.

* Impose an effective *freeze* on the configurations of your CWOM and IWO instances.

  Once you start the migration process, you should not make any configuration changes to either the IWO instance or the CWOM instance.


## Installing the Migration Tool

To run the migration, install the tool on your CWOM instance.

1. Download the tool. **TODO: THE URL BELOW NEEDS UPDATING OR THE PAGE IT REFERENCES DOES**

   For access and download instructions, navigate to https://github.com/turbonomic/tbmigrate/blob/master/DOWNLOAD.md. Scroll to the section, *Downloading TbMigrate.*

   > NOTE: Be sure to download the latest version of the the migration tool.

2. Log in to the CWOM instance using "putty" or another SSH client (if you have not done so already).

3. Expand the archive file onto your Turbonomic instance.

   Execute the commands:

   ```
   cd $HOME
   
   tar xvfz /tmp/tbmigrate-VERSION_NUMBER.tgz --no-same-owner
```


## Running the Migration

To run a migration you will open the Migration Tool Interactive Menu, and then execute the commands in order.

> NOTE: When using the CWOM to IWO migration tool, you must run the steps in order. If you run steps after the Migrate Targets step, and then backtrack to run the Migrate Targets step again, the tool loses the record of any steps that you ran after the initial execution of Migrate Targets.
> 
> We recommend that you carefully review the results of each step that you complete, before moving on to the next one. This can make it unnecessary for you to backtrack.
> 
> For example, assume you ran the tool all the way through the migration. Then you want to see how the tool calculated the target migration so you run Migrate Targets again. After that, the tool assumes you have not finished the migration, and will not let you review the steps subsequent to Migrate Targets. If you had closely reviewed the Migrate Targets result right after you executed that step, then you would not have needed to go back and run it again.

Open the Migration Tool Interactive Menu

While still logged in to the CWOM instance, navigate to the migration tool location, and launch the Interactive Menu. Execute the commands:

```
cd $HOME/tbmigrate
sh menu.sh
```

The Interactive Menu displays in your shell window.

**TODO: ADD IMAGE**

The menu gives you the migration steps you should perform, in order. In the menu:

* Each step has a status:
    * Ready to run – You should run steps in order.
    * Not ready – You must run previous steps before running this step.
    * Done – You can rerun some completed steps. For some completed steps, you can navigate to the step and then display logs.
   * Not required – Optional steps to migrate or collect data a second time.

* Use up and down arrows to navigate to different steps.

* For a selected step, you can:

   * Execute the menu command – Press RETURN to execute the selected step.

   * Display associated logs – Press the "L" key to view logs for completed steps.

   * Exit the step – Pres ESC to exit the step

Executing the Migration Commands

> NOTE: As you execute the migration commands, they write output to .log files in the $HOME/tbmigrate/logs directory. You can view these by selecting the relevant step in the menu and pressing "L".
>
> You should review these logs carefully to ensure that you don't see negative impacts from any elements the tool could not migrate completely. You should review the logs when the migration is finished, and you can review them at different stages of the migration process.

To run the migration, you will step through the menu commands in order, and execute them. The following steps describe each menu command.

1. Set up credentials.

   This step configures credentials for both instances. Execute the command, and then provide the information that the tool requests.

   As part of the credential setup, this step prompts you with the Target Password Migration option:

   * YES – The migration tool collects your encrypted target passwords, and uses them to configure and validate the targets that you migrate to the IWO instance. You will not have to enter those passwords yourself during various stages of the target migration phase.

   * NO – The migration tool does not collect your encrypted passwords. If you do not migrate passwords, you will see prompts to enter passwords at various stages during the target migration process.

2. Collect initial CWOM and IWO configuration data.

   Collect the current configuration from your CWOM installation.

   This step collects configuration data from your instances. The migration process will use the collected data.

   When this step completes, it generates a log of the actions it performed. You should review the log to be sure there are no errors.

3. Match targets

   The tools needs to know which targets in IWO correspond to those in CWOM. If the targets have been created using identical parameters on the two systems then

**TODO: ADD NOTES ABOUT TARGET MATCHING**

4. Migrate groups.

   This step migrates your custom groups. It also migrates scope groups that can be created from the un-scoped targets. This enables the eventual migration of scoped targets.

   Note that this step does not migrate most discovered groups. The IWO instance will discover groups according to its own rules.

   Execute the step, and when it completes review the log to make sure there are no errors.

5. Migrate templates.

   This step migrates the templates you have defined in the CWOM instance. It does not migrate generated templates such as average cluster templates, nor does it migrate discovered templates. Execute the step, and when it completes review the log to make sure there are no errors.

6. Migrate policies.

   This step migrates your Placement Policies, and your default and custom Automation Policies.

   For Automation Policies, this step copies automation settings from CWOM to IWO that meet all of the following criteria:

   * The setting had been changed in the CWOM instance.

     In other words, the setting has a value that is different from its default.

   * There is an equivalent setting in the IWO instance.

     Note that not all settings in CWOM have been replicated in IWO. On the other hand, IWO introduces new settings that do not exist in CWOM.

   This step also migrates Placement Policies.

   If the migration encounters settings in CWOM that cannot migrate into IWO (or vice versa), the tool writes a suitable warning to the log. Examples include:

   * Action policies for entity types that do not map to the IWO supply chain. For example, Application in CWOM entities are Application Component entities in IWO.

   * Settings do not match. For example, in CWOM you can set SLA Capacity for a Business Application, IWO does not include that setting.

   * Settings that are specified by a different mechanism. For example, settings for Action Scripts are specified differently in IWO.

   Execute the step, and when it completes review the log to make sure there are no errors.

This completes the migration process.

You should review the tool outputs to ensure there are no errors. If the tool did log errors, you can review them to determine corrective actions you can take in the IWO instance. The tool writes output to .log files in the $HOME/tbmigrate/logs directory.

Once all the above steps are complete, the IWO instance is configured to be as similar as possible to the CWOM instance, but you should verify that the configuration is as you expect. In particular, review the warnings and errors that the tool logged for any of the migration steps above. You should consider whether these warnings or errors can have an impact on your environment. If necessary, you can log into the IWO user interface and make corrections there.
