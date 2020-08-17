#! /bin/bash

. ./.env

bin/tbutil "$xl_cred" delete template `bin/tbutil "$xl_cred" list configured templates -jsfilter '($.displayName !== "headroomVM")'`
