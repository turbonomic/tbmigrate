# Reviewing your XL instance after migration.

* Date: 12/Nov/2020
* TbMigrate version: 4.0 and later

For a version of this page that can be viewed on the internet, please go to:

    <https://github.com/turbonomic/tbmigrate/blob/master/src/REVIEW-CLASSIC_TO_XL.md>

Note: In these notes, the term "V6.4" refers to the old Turbonomic Version 6 instance and "XL" refers to the new version 7 or 8 instance.

You should review the XL configuration at various steps in the migration process and again once migration is complete. These notes give some guidance on how to do that.

You are almost certain to spot some differences between the V6.4 and XL configurations. Many of these will be benign but others may warrant some further action.

---

## REVIEWING TARGETS

Please note:

* Leaving enough time between steps 3 and 4 (and 6 and 7) is critical to the success of the migration. If you move on too quickly (ie: before discovery is complete) then later steps will result in incomplete groups, polices etc. If you leave it too long then changes that occur in the V6.4 instance in the intervening time gap may not be reflected in the XL.

* If you migrate any targets by hand before running the tool it is VERY important that ALL configuration fields match exactly. For example if the target address is specified as a host name in V6.4 but an IP address in XL (or the address uses different capitalisation, or you use a different account - etc), this will result in duplication and a range of associated issues. This is why we normally recommend using the tool against an empty XL instance.

* The tool does not migrate Kubernetes targets (Kubeturbo) because they are not configured using the UI. You should migrate them by hand following the relevant documentation.

You can review the targets by:
* Viewing the logs of steps 3 and 6. Highlight the option in the menu and press the "L" key.
* Using the V6.4 and XL web user interfaces to view the Settings -> Targets page.
* Using the UI to review the contents of the supply chain and entities (and groups) visible using the Search feature.

Targets may not be migrated because:
* You de-selected them when running steps 3 or 6.
* Their mediation pod is not enabled in the XL configuration (see below).
* They have failed validation in V6.4 OR XL.
* They require a scope group but you have not yet run step 5.
* The XL target requires configuration values that cannot be derived from the matching V6.4 set up.
* The target has been migrated by hand but one or more configuration values are not the same as in V6.4.

Check that the targets have validated correctly and that discovery has run to completion. If you find issues and resolve them, then you should wait for the updated discovery to complete and then restart the migration tool from step 3 (or step 6 if the only targets that need attention are ones that are scoped to a group).

Some targets may require the relevant mediation module (pod) to be enabled in the XL instance before they can be used. This fact will be shown in the target selector screen that is shown at the start of steps 3 and 6. Targets to which this applies will be marked with a red "Err" in the margin, and the details will be visible at the bottom of the screen when you select the target using the arrow keys. If a pod needs to be enabled in this way then abort the "migrate target" step (press ESCAPE and select "No" to return to the menu, then ESCAPE again to exit to the shell), make the change in XL and then re-run the step (step 3 or 6).

Please refer to the XL release notes and installation guide for information on the available target modules and instructions on how to enable them.

Note that if discovery had not finished when you moved from step 3 to 4 (or from 6 to 7) then this can cause issues later in the migration. If you find your groups are missing members that you believe should have been included then it could be worth restarting the migration from step 3.

---

## REVIEWING GROUPS

The tool will attempt to migrate a subset of the groups defined in the V6.4 instance. This includes:
* Custom groups (you have the option to exclude some of these when running steps 5 and 8).
* System-generated groups that are used as scopes for policies, targets or users.

All other groups are omitted.

You can review the migrated groups by:
* Viewing the logs for steps 5 and 8 (highlight the option in the menu and press the "L" key).
* Running the "Compare groups" tool from the migration menu.
* Using the web user interface's Search feature to list and browse the groups.

You should consider whether any of the changes you find impact the policies etc that are scoped to them (or whether intergrations that use them would be impacted), and whether it is appropriate to redesign them or the elements that use them.

Check for..

#### Groups that are smaller in XL than V6.4

These will have a negative number in the "diff" column from the "compare groups" tool.

Some differences here are normal because of changes in the way some targets work. Possible reasons for differences are..
* The XL target only discovers elements that are used by the XL market.
  * For example: the elements used to model cloud storage have been redesigned, and there are fewer of them.
* Element types have been reorganised. For example: "Host" groups no longer include "Availability Zone" items.
* You ran the "collect" step (4 or 7) too soon and discovery was not complete. If this sounds like a possible explanation, then allow sufficient time to pass and restart the process from step 4.

#### Groups that are larger in XL than V6.4

These will have a positive non-zero number in the "diff" column shown by the "Compare groups" option in the menu.

Reasons why a group may be larger in XL include:
* A dynamic group filter RegExp pattern has been used that is interpreted differently (V6.4 and XL use different RegExp processors). In this case, you should probably fix the filter pattern or redesign the configuration to achieve the desired results. If you change the configuration of a group in XL you should NOT re-run the migration tool's "Migrate Groups" step because it will probably reverse your edits.
* The targets have discovered more entities due to changes in their logic.

#### Groups that have not been migrated

Reasons why a group may not be migrated at all include:
* You deselected it in the group selector (in steps 5 and 8).
* The group is a redundant system-discovered group in V6.4 that is not used to scope any policies etc.
* It was discovered by a Target that has not (yet) been migrated to XL.
* It consists entirely of members that are discovered by targets that have not been migrated to XL.
* Changes in the internal model mean the group is no longer meaningful or its members don't exist in XL.

Custom groups and system-generated groups that are used as scopes will show in the output of the "compare groups" tool. Those that have not been migrated will be marked with a hyphen" in the XL column.

Groups that are neither custom groups nor system groups used in scopes will be omitted from the output of the "compare groups" tool because they have been omitted from migration. This is as per design.

#### Groups that have been changed to static

These will have the word "static" in red in the "type" column of the "compare groups" tool.

XL creates fewer "system" groups than V6.4 out of the box so the tool will attempt to migrate the ones that are used to scope policies etc. It will use dynamic groups for this wherever possible. In some cases there is no appropriate dynamic group filter available and so the tool has to drop back to migrating it as a static group.

XL also implements a slightly different set of dynamic group filters from V6.4. This means that some dynamic groups in V6.4 cannot be migrated as-is to XL. In these cases the tool also drops back to converting them to static groups in XL.

NOTE: you should be aware that static groups are not automatically managed for you going forward so you should consider whether they (and the policies or integrations that depend on them) could be implemented using a different dynamic filter or would be better implemented using a different approach in XL.

---

## REVIEWING TEMPLATES

The migration tool will attempt to copy your custom and factory templates. Templates such as the "AVG:" and "MAX:" ones that are generated at run time are not migrated because XL will create them automatically if needed.

XL does not allow template names to be duplicated but V6.4 does. This means that duplicate templates cannot be migrated (you will see a warning in the logs). You should consider whether you should copy the skipped template by hand using a different name.

V6.4 provides "Large", "Medium" and "Small" templates for VMs, Hosts and Storage out of the box. The tool  renames these to include the entity type when migrated to XL to get round the duplication rule mentioned above. For example: the factory "Large" VM template is named as "Large VirtualMachine" in XL.

Some templates make reference to metrics in V6.4 that are not part of the XL model. The tool will issue a warning when this happens, but migrate the template nonetheless. You may wish to consider whether the template should be modified by hand to provide the features you require in the XL installation.

You can review the templates by:
* Viewing the "migrate templates" step logs (step 9) by highlighting the option in the menu and pressing the "L" key.
* Using the XL web user interface to view the Settings->Templates page.

---

## REVIEWING POLICIES

The tool will attempt to migrate the default and custom policies for you.

#### For default automation policies:

The tool's approach is to copy any parameters that have been changed in V6.4. Parameters that are still left at their original default values will NOT be copied over even if the default value of the equivalent parameter in XL is different. The rationale behind this logic is that changes to the default values in XL are deliberate and better match the XL market's logic.

The tool will report the names and values of the parameters being changed. Any "defaults" policy that is unchanged in V6.4 will not be migrated.

#### For custom automation policies:

The tool will attempt to copy all parameters to their equivalents in XL (and report on any that it can't copy). It will NOT attempt to copy any "Action Orchestration" settings (also known as Action Scripts) since the new mechanism requires the scripts themselves to be reviewed and deployed using a different mechanism.

#### For placement policies:

The tool will attempt to copy all custom placement policies over and report on any issues it encounters along the way. Placement polices generated by the system (for example: for DRS) will not be migrated because the XL instance will create the required ones automatically.

#### For all policy types:

The XL and V6.4 platforms are quite different in the way policies are handled. XL supports some options that V6.4 does not, V6.4 supports some that XL does not and some parameters have changed format, name or permitted values.

As the policies are copied over you will almost certainly see a number of warnings or errors that are raised to notify you of the differences and any potential issues. Not all warnings prevent a policy from being migrated, but they can indicate that the copy is only partially complete.

### Possible warnings and errors

You may see warnings like these ...

#### Policy 'XYZ defaults' exists in V6.4 but has no equivalent in XL

This warning is printed as part of the pre-flight checks at the start of the policy migration. It indicates that the XYZ entity type has a default automation policy in V6.4, but no equivalent exists in XL. This may be because the entity type itself is not used in the XL market or because there are no configurable settings associated with it. The warning is benign.

#### No setting for 'ABC::DEF::GHI' (XYZ)

This warning is printed as part of the pre-flight checks at the start of the policy migration and indicates that the specific V6.4 parameter is not present in XL.

One specific case that is silently ignored is the "Datastore Browsing" option. In V6.4, this is part of the Storage defaults setting group but in XL you now configure it at per target when defining vCenter targets. The tool takes the setting in the Settings->Defaults section in V6.4 and applies that value to all vCenter targets in XL.

#### V6.4's value is larger than XL's allowed maximum - reducing to NNN

This indicates that the value configured in V6.4 is higher than the maximum value allowed by XL, and so has been automatically reduced before being applied.

#### V6.4's value is less than XL's allowed minimum - raising to NNN

This indicates that the value configured in V6.4 is less than the minimum value allowed by XL, and so has been automatically increased before being applied.

#### Policy scoped to a non-existent group (uuid: XXXX)

This means that the policy is broken in "V6.4" because the group to which is was originally scoped has subsequently been deleted. This prevents the tool from migrating the policy to XL.

#### Can't find scope group 'XYZ' in XL

This indicates that the group used to scope the policy cannot be found in XL. It is likely that this is down to a warning in the "migrate groups" phase which you will be able to discover following the notes in the "REVIEWING GROUPS" section above.

#### Can't find DC 'XYZ' in XL

This is similar to the warning above - it indicates that the required scope DC entity cannot be found in XL. The policy will not be migrated.

#### Multiple groups called 'XYZ' found

The tool has been unable to determine which group to use as the scope for the policy because there are multiple groups with the same name in XL. This prevents the policy from being migrated automatically. You should review the policy and the group/s to which it is scoped and configure it manually to XL. A redesign of the policy or scope group may be a good idea.

#### Setting 'ABC::DEF::GHI' is unknown to XL

The custom policy includes a setting in V6.4 that has no equivalent in XL. This makes it impossible (or unsafe) to migrate the policy automatically. You should migrate the policy by hand and may need to redesign it in the process.

#### Includes 'Action Orchestration' settings which wont be migrated.

The policy includes some action script configuration which is not migrated automatically. You will need to review the action scripts and deploy them manually using the new XL mechanisms and then configure the policy to invoke them. This may require some redesign of the scripts.

Pleases refer to the user guide for details about how action scripts work and how to deploy them in XL.

#### Policy would make no changes

If this policy were to be migrated it would have no effect because it contains no migratable settings. For this reason the policy will not be copied over. You may wish to review the original intent of the policy, consider redesigning it and then migrate it by hand.

#### Unable to migrate schedule (REASON)

The policy has a schedule associated with it, but the schedule could not be migrated. The reason for this is given in the brackets. For safety reasons, the policy will not be migrated.

A common cause of this warning is that the policy has both a start and end date in the past, and so would never trigger.

You may need to review whether the policy needs to be migrated or not and copy it manually with an adjusted schedule if so.

#### Policy not migrated

The messages in the preceding lines indicate the reasons why the tool has been unable to migrate the policy. You should consider whether you need to create the policy by hand using the filters and settings that are available in XL, possibly redesigning it in the process.

---

## REVIEWING ACTION SCRIPTS

The migration tool does not copy action scripts or their configuration. This will need to be done by hand.

It may be a good idea to address the porting and configuration of any existing scripts before enabling actions in XL, depending on how they are used and what features they implement in your environment.

---

## REVIEWING USERS AND USER GROUPS

The tool migrates your users, user group definitions and Active Directory configuration over for you in step 11.

In order to prevent issues with user details that have been updated in XL from being overwritten by the migration, the tool either
1. Creates the user or group if it does not already exist.
2. or: checks that the existing user or group definition matches the equivalent in V6.4 (ignoring the password).

You can review the users by:
* Viewing the logs of the "migrate users" step (number 11) by highlighting the option in the menu and pressing the "L" key.
* Viewing the users and groups in the Turbonomic web UI.

### User and group types

#### Administrator

The local "administrator" account will not be changed.

#### Other local users

Local users other than "administrator" will be copied over if they don't already exist or will be checked for a match if they do. The following attributes are copied:
* The user's name
* The user's role
* The user's scope (if any).

The user's password is NOT copied (it is not possible to decrypt the password in order to copy it over). Instead, the user is created with a large, random, undeclared password. This means that the user account exists but the administrator needs to give the user a password using the Turbonomic UI before he or she can log in.

#### Active directory configuration

If you have AD set up, then the configuration will be copied over.

#### AD Users and groups

AD user and group details will be copied over if they don't already exist (or checked for a match if they do). The details included in this are..
* The name
* The role
* The scope (if any).

The AD user passwords are unaffected because they are not held in the Turbonomic instance at all but are configured to the AD service.

### Possible warnings and errors

Possible reasons why migration of a user or group may fail include..
* The user name is duplicated. V6.4 allowed two users with the same name to exist provided at least one of the letters in the name has a different case. So "tommy" and "Tommy" could both exist. XL Does not allow this. If you encounter this problem, you should rename one of the users.
* The scope group cannot be resolved. The reasons why the group could not be migrated should show up when reviewing the groups (see above). You should correct the issue manually and create the user or group by hand.
* The user or group already exists in XL but one or more details (other than the password) differ.

---

## REVIEWING ACTIONS

The tool deliberately disables all actions in XL and so your XL supply chain will be all green. The reason we do this is to ensure that you don't have two different instances managing the same infrastructure at the same time.

Our usual advise is to allow the V6.4 and XL instances to run in parallel for a while BEFORE turning actions off in V6.4 and on in XL. This allows the XL instance to gather the historic metrics needed when considering resize actions. The time period required will depend on your system design, but a month is common. Once this period has elapsed you should disable actions in V6.4 before enabling them in XL. The migration tool documentation describes this in more detail (see Appendix C of the installation guide).

If you want to see the actions that XL would produce while leaving the V6.4 instance managing your estate during this "soaking in" period, you should..
1. First: change all policies in XL to switch modes from AUTOMATED to RECOMMENDED (and possibly, to be safe, from MANUAL to RECOMMENDED too).
2. Only then: turn OFF the "disable all actions" setting in Settings -> Default -> Global.

But please note - you do not need to do this to start the process of collecting historic metrics. We generally do not recommend this because you will have to manually restore the policy action types when you finally cut over to XL.

If you do do this, then don't expect to see the same actions in the two systems. Keep in mind that the system's technology is focussed on bringing the entire estate nearer to the "desired state" of performance, efficiency and compliance. The degree of interconnectedness of the states of the infrastructure entities means that there is not just a single "right answer" to the question of what actions will get you there. Two different instances may well suggest a different set of actions but both sets will take you in the right direction.

Refer to the installation guide for guidance on the process involved in cutting the management over from the V6.4 to the XL instance.