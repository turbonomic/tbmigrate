#! /bin/bash

. ./.env

bin/tbutil "$xl_cred" delete target `bin/tbutil "$xl_cred" list targets`