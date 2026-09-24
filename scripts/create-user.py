#!/usr/bin/env python3
"""
create-user.py — manage tenant-scoped users for the energy platform.

Users live in the `el-users` Cognito pool with a custom:tenant_id claim
that the API enforces on every request. tenant_id "*" is the platform-operator
wildcard (sees all tenants) — use it for your own NOC login only.

Usage (CloudShell):
  # INVITE a user (Cognito emails them a temporary password; on first sign-in
  # they set their own password and enrol MFA in the Beacon login — recommended)
  python3 create-user.py customer@acme.co --tenant acme --invite

  # Create with a known password (still walks MFA enrolment at first sign-in)
  python3 create-user.py you@example.com --tenant '*' --password 'YourPass123!'

  # Reset (emails a code; user completes via "Forgot password?" on the login)
  python3 create-user.py customer@acme.co --reset

  # Disable / re-enable access immediately
  python3 create-user.py leaver@acme.co --disable
  python3 create-user.py rejoiner@acme.co --enable

  # List users
  python3 create-user.py --list

NOTE: with MFA enforced, --login (CLI token helper) no longer completes —
tokens for curl testing come from the dashboard after sign-in:
DevTools -> Application/Storage -> sessionStorage -> noc_token.
"""

import argparse
import getpass
import sys

REGION = "eu-west-1"
STACK_NAME = "beacon"


def stack_outputs(cfn):
    out = {}
    stacks = cfn.describe_stacks(StackName=STACK_NAME)["Stacks"]
    for o in stacks[0].get("Outputs", []):
        out[o["OutputKey"]] = o["OutputValue"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email", nargs="?")
    ap.add_argument("--tenant", help="tenant_id claim ('*' = platform operator)")
    ap.add_argument("--password", help="password (prompted securely if omitted)")
    ap.add_argument("--login", action="store_true", help="fetch an ID token (pre-MFA pools only)")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--invite", action="store_true", help="email an invitation with a temporary password")
    ap.add_argument("--reset", action="store_true", help="send a password-reset code by email")
    ap.add_argument("--disable", action="store_true", help="disable the user immediately")
    ap.add_argument("--enable", action="store_true", help="re-enable a disabled user")
    args = ap.parse_args()

    import boto3
    cfn = boto3.client("cloudformation", region_name=REGION)
    idp = boto3.client("cognito-idp", region_name=REGION)

    outs = stack_outputs(cfn)
    pool_id = outs.get("UserPoolId")
    client_id = outs.get("UserPoolClientId")
    api_url = outs.get("DataApiEndpoint", "<DataApiEndpoint output missing>")
    if not pool_id or not client_id:
        sys.exit("UserPoolId/UserPoolClientId not in stack outputs - deploy the updated template first")

    if args.list:
        resp = idp.list_users(UserPoolId=pool_id)
        for u in resp.get("Users", []):
            attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            print(f"  {attrs.get('email','?'):35s} tenant={attrs.get('custom:tenant_id','-'):8s} "
                  f"status={u.get('UserStatus')}")
        if not resp.get("Users"):
            print("  (no users)")
        return

    if not args.email:
        ap.error("email required (or --list)")

    if args.reset:
        idp.admin_reset_user_password(UserPoolId=pool_id, Username=args.email)
        print(f"Reset code emailed to {args.email}. They complete it via")
        print("'Forgot password?' on the Beacon sign-in screen.")
        return
    if args.disable:
        idp.admin_disable_user(UserPoolId=pool_id, Username=args.email)
        print(f"{args.email} disabled — sign-in blocked immediately.")
        return
    if args.enable:
        idp.admin_enable_user(UserPoolId=pool_id, Username=args.email)
        print(f"{args.email} re-enabled.")
        return

    if args.invite:
        if not args.tenant:
            ap.error("--tenant required when inviting a user")
        idp.admin_create_user(
            UserPoolId=pool_id,
            Username=args.email,
            UserAttributes=[
                {"Name": "email", "Value": args.email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "custom:tenant_id", "Value": args.tenant},
            ],
            DesiredDeliveryMediums=["EMAIL"],
        )
        print(f"Invitation emailed to {args.email} (tenant: {args.tenant}).")
        print("First sign-in walks them through: temp password -> own password -> MFA enrolment.")
        print(f"Dashboard: {outs.get('DashboardUrl', '<DashboardUrl output>')}")
        return

    password = args.password or getpass.getpass("Password: ")

    if args.login:
        resp = idp.admin_initiate_auth(
            UserPoolId=pool_id,
            ClientId=client_id,
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": args.email, "PASSWORD": password},
        )
        token = resp["AuthenticationResult"]["IdToken"]
        print(f"""ID token (valid 8h):

{token}

Try it:
  TOKEN='{token[:24]}...paste full token...'
  curl -s '{api_url}/api/sites' -H "Authorization: Bearer $TOKEN"
""")
        return

    if not args.tenant:
        ap.error("--tenant required when creating a user")

    idp.admin_create_user(
        UserPoolId=pool_id,
        Username=args.email,
        UserAttributes=[
            {"Name": "email", "Value": args.email},
            {"Name": "email_verified", "Value": "true"},
            {"Name": "custom:tenant_id", "Value": args.tenant},
        ],
        MessageAction="SUPPRESS",
    )
    idp.admin_set_user_password(
        UserPoolId=pool_id, Username=args.email, Password=password, Permanent=True
    )
    print(f"Created {args.email} (tenant: {args.tenant}).")
    print(f"Get a token:  python3 scripts/create-user.py {args.email} --login")
    print(f"API base URL: {api_url}")


if __name__ == "__main__":
    main()
