# NetSentry in a cloud network (AWS first)

For a developer or small team whose apps run on cloud instances in a VPC.

NetSentry never asks for cloud keys. Its monitor on each instance uses **that instance's own
role** and only reads (docs/PERMISSIONS.md).

## Set up

1. Run NetSentry on an instance in the VPC (or anywhere the instances reach over https).
2. Create an IAM role for EC2 with the AWS-managed **SecurityAudit** policy and attach it to the
   instances you want watched.
3. **Network → Put a monitor on your servers → On AWS**: allow that role. Then on each instance
   (or in its user data):
   `curl -fsSL https://<netsentry>/api/netsentry/sensor/install.sh | sudo NETSENTRY_KEYLESS=aws sh`
   The instance proves its role to AWS; NetSentry asks AWS who it is. No token, no key.
4. Say who should reach each app (the website: anyone on the internet; the database: only this
   machine), as in the other guides.

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
switch fixing on at that instance (`NETSENTRY_EXECUTOR=on`). *Fix it for me* on an open port
then removes exactly that rule after you approve the plan, puts it back if anything fails, and
checks at AWS that it's gone.

## Status

The AWS path is proven end to end in the lab against moto (an open-source AWS emulator) —
not yet on a real AWS account. GCP and Azure read their firewall rules; their reachability
and checks are proven on the providers' documented formats only (docs/PLATFORM-MATRIX.md).
EOF
