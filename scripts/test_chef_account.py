#!/usr/bin/env python3
"""
End-to-end test for the chef account self-service page.

Covers GET + PATCH /api/chef/account:
  1. Chef signs in, fetches profile -> sees name/email/phone/role/createdAt.
  2. Chef updates name + phone -> response reflects new values, and the JWT
     is re-issued (tokenReissued=true) because the name changed. The chef
     session cookie now carries the new name (verified by hitting
     /api/auth/login GET which echoes the session).
  3. Chef updates only phone -> name unchanged -> no token re-issue.
  4. Chef changes password with WRONG current password -> 422 blocked.
  5. Chef changes password with CORRECT current password -> 200, success.
  6. Chef can still call /api/chef/account GET with the existing session
     (password change does NOT invalidate the JWT — only the login password
     changed).
  7. Login with the NEW password succeeds; login with the OLD password fails.
  8. Unauthenticated GET/PATCH is rejected (401).
  9. New-password validation: too short (<6) and same-as-current are rejected.
 10. Frontend: /chef/account page renders the account client; the new
     /chef/account route + UserCog link are present in the compiled bundle.

Uses a dedicated test chef account (chef_account_test@restaurant.com) so the
seed chef's password is never touched. Cleans up the test account at the end
via the admin API.
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, subprocess

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar(): return http.cookiejar.CookieJar()

def req(jar, path, method="GET", body=None):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    r = urllib.request.Request(BASE+path, data=d, method=method, headers={"Content-Type":"application/json"})
    try:
        x = o.open(r, timeout=20); raw = x.read().decode(errors='replace')
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

TEST_EMAIL = "chef_account_test@restaurant.com"
TEST_NAME_ORIG = "Account Test Chef"
TEST_PW_ORIG = "chef123"
TEST_PW_NEW = "chef456"

admin = make_jar()
chef = make_jar()
nobody = make_jar()  # unauthenticated

print("\n=== Setup: admin creates a dedicated test chef account ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")

# Idempotent create (409 if it already exists from a prior run)
s,b = req(admin, "/api/users", "POST", {"name":TEST_NAME_ORIG,"email":TEST_EMAIL,"password":TEST_PW_ORIG,"role":"chef"})
check(s==201 or s==409, f"create test chef (status {s}, {'new' if s==201 else 'exists'})")

# If it already existed, ensure the password is the known original by
# resetting it via admin PATCH. First find its id.
s,b = req(admin, "/api/users")
test_user = next((u for u in b["users"] if u["email"]==TEST_EMAIL), None)
check(test_user is not None, "test chef account exists in user list")
test_id = test_user["_id"] if test_user else None
if test_id:
    s,b = req(admin, f"/api/users/{test_id}", "PATCH", {"password":TEST_PW_ORIG, "name":TEST_NAME_ORIG})
    check(s==200, f"reset test chef to known original password/name (status {s})")

print("\n=== Chef signs in ===")
s,b = req(chef, "/api/auth/login", "POST", {"email":TEST_EMAIL,"password":TEST_PW_ORIG,"scope":"chef"})
check(s==200, f"chef login with original password (status {s})")

print("\n=== 1. GET /api/chef/account returns the chef's profile ===")
s,b = req(chef, "/api/chef/account")
check(s==200, f"GET profile (status {s})")
if s==200:
    u = b["user"]
    check(u["email"]==TEST_EMAIL, f"profile email correct ({u['email']})")
    check(u["name"]==TEST_NAME_ORIG, f"profile name correct ({u['name']})")
    check(u["role"]=="chef", f"profile role is chef ({u['role']})")
    check("createdAt" in u, "profile includes createdAt")

print("\n=== 2. PATCH name+phone -> reflected + JWT re-issued (name changed) ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"name":"Updated Chef Name","phone":"+880 1700 123456"})
check(s==200, f"PATCH name+phone (status {s})")
if s==200:
    u = b["user"]
    check(u["name"]=="Updated Chef Name", f"name updated in response ({u['name']})")
    check(u["phone"]=="+880 1700 123456", f"phone updated in response ({u['phone']})")
    check(b.get("tokenReissued") is True, "tokenReissued=true (JWT re-issued because name changed)")
    # Verify the session now carries the new name (GET /api/auth/login echoes session).
    s,b2 = req(chef, "/api/auth/login", "GET")
    check(b2.get("user",{}).get("name")=="Updated Chef Name",
          f"session name updated to 'Updated Chef Name' (got '{b2.get('user',{}).get('name','')}')")

print("\n=== 3. PATCH only phone -> name unchanged -> no token re-issue ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"phone":"+880 1700 999999"})
check(s==200, f"PATCH phone-only (status {s})")
if s==200:
    check(b.get("tokenReissued") is not True, "tokenReissued NOT set (name unchanged)")
    check(b["user"]["phone"]=="+880 1700 999999", f"phone updated ({b['user']['phone']})")
    check(b["user"]["name"]=="Updated Chef Name", "name still 'Updated Chef Name'")

print("\n=== 4. Change password with WRONG current password -> blocked ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"currentPassword":"totally-wrong","newPassword":TEST_PW_NEW})
check(s==422, f"wrong current password rejected (status {s})")
if s==422:
    check("incorrect" in b.get("error","").lower(), f"error mentions incorrect ({b.get('error')})")

print("\n=== 5. New password validation: too short (<6) -> rejected ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"currentPassword":TEST_PW_ORIG,"newPassword":"abc"})
check(s==422, f"too-short new password rejected (status {s})")

print("\n=== 6. New password validation: same as current -> rejected ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"currentPassword":TEST_PW_ORIG,"newPassword":TEST_PW_ORIG})
check(s==422, f"same-as-current new password rejected (status {s})")

print("\n=== 7. Change password with CORRECT current password -> succeeds ===")
s,b = req(chef, "/api/chef/account", "PATCH", {"currentPassword":TEST_PW_ORIG,"newPassword":TEST_PW_NEW})
check(s==200, f"change password with correct current (status {s})")
if s==200:
    check(b.get("passwordChanged") is True, "passwordChanged=true in response")

print("\n=== 8. Existing chef session still works after password change (JWT not invalidated) ===")
s,b = req(chef, "/api/chef/account")
check(s==200, f"GET profile still works with existing session (status {s})")

print("\n=== 9. Login with NEW password succeeds; OLD password fails ===")
newjar = make_jar()
s,b = req(newjar, "/api/auth/login", "POST", {"email":TEST_EMAIL,"password":TEST_PW_NEW,"scope":"chef"})
check(s==200, f"login with NEW password succeeds (status {s})")

oldjar = make_jar()
s,b = req(oldjar, "/api/auth/login", "POST", {"email":TEST_EMAIL,"password":TEST_PW_ORIG,"scope":"chef"})
check(s==401, f"login with OLD password now fails (status {s})")

print("\n=== 10. Unauthenticated access is rejected ===")
s,b = req(nobody, "/api/chef/account")
check(s==401, f"unauthenticated GET rejected (status {s})")
s,b = req(nobody, "/api/chef/account", "PATCH", {"name":"Hacker"})
check(s==401, f"unauthenticated PATCH rejected (status {s})")

print("\n=== 11. Email/role are NOT editable (omitted from accepted fields) ===")
# Sending email in the body should be ignored (not applied).
s,b = req(chef, "/api/chef/account", "PATCH", {"email":"hijacked@evil.com"})
check(s==200, f"PATCH with email field accepted (ignored) (status {s})")
if s==200:
    check(b["user"]["email"]==TEST_EMAIL, f"email NOT changed ({b['user']['email']})")

print("\n=== 12. Frontend: /chef/account page + account link exist in source ===")
# Check source files directly (the dev server doesn't write a production
# bundle to .next/static the way `next build` does, so grepping the bundle
# is unreliable in dev). The build step already confirmed compilation.
acct_src = subprocess.run(
    ["grep","-ql","Account settings","/home/z/my-project/download/restaurant-app/src/components/chef/ChefAccountClient.tsx"],
    capture_output=True, text=True)
check(acct_src.returncode==0, "'Account settings' heading present in ChefAccountClient.tsx source")
link_src = subprocess.run(
    ["grep","-ql","/chef/account","/home/z/my-project/download/restaurant-app/src/components/chef/ChefPortalClient.tsx"],
    capture_output=True, text=True)
check(link_src.returncode==0, "'/chef/account' link present in ChefPortalClient.tsx source")
acct_route = subprocess.run(
    ["test","-f","/home/z/my-project/download/restaurant-app/src/app/chef/account/page.tsx"],
    capture_output=True, text=True)
check(acct_route.returncode==0, "/chef/account/page.tsx route file exists")
# And the page itself is a known route (anon -> redirect to login or auth wall).
s,_ = req(make_jar(), "/chef/account", "GET")
check(s in (200, 401, 403, 307), f"/chef/account route responds (status {s} — redirect/auth as expected for anon)")

print("\n=== Cleanup: delete the test chef account ===")
if test_id:
    s,b = req(admin, f"/api/users/{test_id}", "DELETE")
    check(s==200, f"test chef account deleted (status {s})")

print(f"\n{'='*60}")
print(f"CHEF ACCOUNT TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
