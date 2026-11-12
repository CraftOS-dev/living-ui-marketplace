# NetSentry in a cloud network (AWS first)

For a developer or small team whose apps run on cloud instances in a VPC.

NetSentry never asks for cloud keys. Its monitor on the instance uses **that instance's own
role** and only reads (docs/PERMISSIONS.md).

## Set up

1. Run NetSentry on the instance it should look after: it looks after the one server it runs on,
   so run it on each instance you want watched.
2. Create an IAM role for EC2 with the AWS-managed **SecurityAudit** policy and attach it to the
   instance.
3. **Setup** (*Let NetSentry look after this server*) → **Install the monitor on this server** →
   **Show me the command**, and run it on the instance:
   `curl -fsSL <netsentry>/api/netsentry/sensor/install.sh | sudo NETSENTRY_JOIN=… NETSENTRY_MANAGE=yes sh`
   The monitor finds out it is on AWS and reads with the instance's role. No cloud key.
4. **Who should reach your apps → Answer for each app** (the website: *anyone on the internet*;
   the database: *only this server*), as in the other guides.

## What NetSentry checks there

- **Who can really reach each app**: the instance's public address, the subnet's route to the
  internet, the network ACL (first matching rule) and the security groups — so "reachable by
  everyone in your VPC" and "reachable from the internet" are what AWS would actually allow.
- **Admin and database ports open to the whole internet** (SSH, RDP, PostgreSQL, MySQL, Redis,
  MongoDB, Elasticsearch, Docker), with the console, AWS CLI and Terraform steps to close them.
- **Metadata service without session tokens (IMDSv1)**, **unencrypted disks**, **no disk
  snapshot in 7 days** (backups).
- **NetSentry's own access**: what it can't read (NS-CLOUD-ACCESS), and whether its role could
  change more than it needs (NS-IDENTITY-TOO-BROAD — asked with an AWS dry run).

## Letting NetSentry close a port itself (optional)

Add `ec2:RevokeSecurityGroupIngress` and `ec2:AuthorizeSecurityGroupIngress` to the role and
allow changes at that instance (Setup's command does, with `NETSENTRY_MANAGE=yes`; if they are
off, Settings → Monitor → **Allow changes** shows the command). **Fix it** on an open port
(Home → Needs you) then removes exactly that rule after an admin confirms the plan, puts it back
if anything fails, and checks at AWS that it's gone.

## Status

The AWS path is proven end to end in the lab against moto (an open-source AWS emulator) —
not yet on a real AWS account. GCP and Azure read their firewall rules; their reachability
and checks are proven on the providers' documented formats only (docs/PLATFORM-MATRIX.md).
EOF
