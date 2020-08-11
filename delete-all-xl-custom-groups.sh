#! /bin/bash

. ./.env

bin/tbutil "$xl_cred" delete group `bin/tbutil "$xl_cred" list my groups`
