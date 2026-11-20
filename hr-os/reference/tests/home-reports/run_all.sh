#!/bin/bash
# home-reports tests on a SCRATCH copy of the app (never the delivered folder):
#   HR_APP=<scratch app dir> HR_PORT=3190 bash run_all.sh
# t01 resets the database itself; seed_reports.mjs builds the seeded company (demo seed plus the
# modules' own seeds and reports data) that t02 and the screenshot pass read.
set -e
cd "$(dirname "$0")"
node t01_empty.mjs
node seed_reports.mjs
node t02_seeded.mjs
node t04_globe.mjs
for r in "owner owner@northwind.test" "hr hr@northwind.test" "payroll payroll@northwind.test" "manager eng.lead@northwind.test" "employee sam@northwind.test"; do OUT="${OUT:-shots}/seed" node shots.mjs $r; done
node seed_empty.mjs
for r in "owner owner@northwind.test" "hr hr@northwind.test" "payroll payroll@northwind.test" "manager eng.lead@northwind.test" "employee sam@northwind.test"; do OUT="${OUT:-shots}/empty" node shots.mjs $r; done
