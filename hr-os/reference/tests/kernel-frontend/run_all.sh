#!/bin/bash
# The whole kernel-frontend pass on the scratch server (port 3182): empty database, then the demo seed.
cd "$(dirname "$0")"
K="$(cd .. && pwd)"
set -o pipefail
node money.mjs 2>&1 | grep -v Warning
node dates.mjs 2>&1 | grep -v Warning
echo "== empty database"
bash reseed.sh empty
OUT="$K/shots/empty" node setup.mjs || echo "SETUP FAILED"
node empty_members.mjs
OUT="$K/shots/empty" node pass.mjs owner owner@northwind.test owner-pass-1 | tail -3
OUT="$K/shots/empty" node pass.mjs manager lead@northwind.test staff-pass-1 inbox inbox?view=jobs people people/org settings settings/security settings/notifications | tail -3
OUT="$K/shots/empty" node pass.mjs employee staff@northwind.test staff-pass-1 home inbox inbox?view=requests inbox?view=jobs people settings/security settings/notifications | tail -3
echo "== demo seed"
bash reseed.sh
P="inbox inbox?view=proposals inbox?view=requests inbox?view=jobs people people/org people/new people/E0021 people/E0021?tab=job people/E0021?tab=personal people/E0021?tab=bank people/E0021?tab=documents people/E0021?tab=skills print/people/E0021 settings/company settings/entities settings/locations settings/org settings/calendars settings/schedules settings/approvals settings/members settings/roles settings/agent settings/data settings/audit settings/security settings/notifications"
WIDTHS=1440,430,390,360 OUT="$K/shots/seed" node pass.mjs owner owner@northwind.test demo-pass-1 $P | tail -3
OUT="$K/shots/seed" node pass.mjs manager eng.lead@northwind.test demo-pass-1 inbox people people/org people/E0016 "people/E0016?tab=job" "people/E0016?tab=personal" settings/security settings/notifications | tail -3
WIDTHS=1440,430,390,360 OUT="$K/shots/seed" node pass.mjs employee sam@northwind.test demo-pass-1 inbox inbox?view=requests inbox?view=jobs people/E0005 "people/E0005?tab=job" "people/E0005?tab=personal" "people/E0005?tab=bank" "people/E0005?tab=documents" settings/security people | tail -3
OUT="$K/shots/seed" node pass.mjs hr hr@northwind.test demo-pass-1 people people/new settings/org settings/members | tail -3
OUT="$K/shots/seed" node pass.mjs payroll payroll@northwind.test demo-pass-1 people "people/E0021?tab=job" inbox | tail -3
PAGES="people,people/E0021?tab=job,people/E0021?tab=personal,inbox,settings/roles,settings/calendars,settings/members,settings/company,people/new" node audit.mjs | tail -3
OUT="$K/shots/ux" node ux_audit.mjs | tail -8
OUT="$K/shots/preauth" node preauth.mjs | tail -2
node live.mjs | tail -3
OUT="$K/shots/kiosk" node kiosk.mjs | tail -1
OUT="$K/shots/after2" node phonehead.mjs | tail -3
node money_lint.mjs | tail -6
OUT="$K/shots/probe" node shell_probe.mjs | tail -1
node kernel_parts.mjs | tail -1
bash reseed.sh
node timing.mjs | tail -14
OUT="$K/shots/flows" node flows.mjs | tail -14
bash reseed.sh hiring | tail -1 | cut -c1-40
OUT="$K/shots/hire" node hire_prefill.mjs | tail -1
bash reseed.sh | tail -1 | cut -c1-20
OUT="$K/shots/after2" node pay_start.mjs | tail -2
echo "== done"
