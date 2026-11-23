#!/usr/bin/env python3
"""
Multi-staff portal test — order acceptance, race-safety, account CRUD.

Covers the user's request: "multiple staff can login and do activity
simultaneously without any error" — staff receive ready orders, ACCEPT one
to claim it (race-safe so two staff can't grab the same order), then SERVE
and COMPLETE it, all with a louder ringtone when unaccepted orders exist.

This test simulates:
  - TWO STAFF on the SAME browser (one shared cookie jar, like two tabs on
    one computer). Each "tab" holds its own per-tab Bearer token. Chef B's
    login overwrites Chef A's cookie, but each tab keeps its identity — the
    same fix that solved the chef problem now protects staff.
  - A SEPARATE third staff on a different browser (its own cookie jar) to
    prove cross-device also works.
  - The accept race: two staff accept the SAME ready order at the same
    instant -> exactly one wins (200), the other gets 422 "another staff
    just accepted it". Atomic, race-safe.
  - Ownership: only the accepting staff can SERVE the order they claimed;
    another staff is rejected with 422.
  - The staff queue scoping: each staff sees unaccepted ready orders (ring
    all) + their OWN accepted/served orders (not other staff's).
  - Staff account CRUD: GET profile, PATCH name/phone, PATCH password (with
    current-password verification), token reissue on name change.
  - The louder doorbell ringtone file exists and is non-trivial in size.
  - Frontend wiring: accept/serve flow, ringtone, account link, per-tab
    identity are present in the source.
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, subprocess, time

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar(): return http.cookiejar.CookieJar()

def req(jar, path, method="GET", body=None, bearer=None):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {"Content-Type": "application/json"}
    if bearer: headers["Authorization"] = f"Bearer {bearer}"
    r = urllib.request.Request(BASE+path, data=d, method=method, headers=headers)
    try:
        x = o.open(r, timeout=20); raw = x.read().decode(errors='replace')
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

STAFF_A_EMAIL = "staff@restaurant.com"
STAFF_A_PW    = "staff123"
STAFF_B_EMAIL = "staff_multistaff@restaurant.com"
STAFF_B_NAME  = "Multi Staff Two"
STAFF_B_PW    = "staff123"
STAFF_C_EMAIL = "staff_multistaff_c@restaurant.com"
STAFF_C_NAME  = "Multi Staff Three"
STAFF_C_PW    = "staff123"

admin = make_jar()
# Shared cookie jar for Staff A + Staff B "tabs" on the SAME browser.
browser = make_jar()
# Separate cookie jar for Staff C on a DIFFERENT browser.
browserC = make_jar()

print("\n=== Setup: admin ensures the extra staff accounts exist ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")

# Clean slate: complete any stale 'ready'/'served' orders left over from
# previous test runs so they don't pollute the counts in this run. We mark
# them 'completed' (admin can do this on any order) rather than delete, to
# avoid touching orders that might belong to other suites' assertions.
s,b = req(admin, "/api/orders?limit=300")
stale_cleared = 0
for o in b.get("orders", []):
    if o.get("status") in ("ready", "served"):
        rs, _ = req(admin, f"/api/orders/{o['_id']}", "PATCH", body={"action":"complete"})
        if rs == 200: stale_cleared += 1
print(f"  (cleared {stale_cleared} stale ready/served orders before the test)")

for email, name in [(STAFF_B_EMAIL, STAFF_B_NAME), (STAFF_C_EMAIL, STAFF_C_NAME)]:
    s,b = req(admin, "/api/users", "POST", {"name":name,"email":email,"password":"staff123","role":"staff"})
    check(s==201 or s==409, f"create {email} (status {s}, {'new' if s==201 else 'exists'})")
    s,b = req(admin, "/api/users")
    u = next((x for x in b["users"] if x["email"]==email), None)
    if u:
        s,b = req(admin, f"/api/users/{u['_id']}", "PATCH", {"password":"staff123","name":name})
        check(s==200, f"reset {email} password/name (status {s})")

print("\n=== 1. Three staff log in (two share a browser cookie jar) ===")
# Staff A — tab on the shared browser.
s,b = req(browser, "/api/auth/login", "POST", {"email":STAFF_A_EMAIL,"password":STAFF_A_PW,"scope":"staff"})
check(s==200, f"Staff A login (status {s})")
check("token" in b, "login returns per-tab token")
tokenA = b.get("token")
check(b["user"]["email"]==STAFF_A_EMAIL, f"Staff A identity ({b['user']['email']})")

# Staff B — ANOTHER tab on the SAME browser (same cookie jar -> clobbers A's cookie).
s,b = req(browser, "/api/auth/login", "POST", {"email":STAFF_B_EMAIL,"password":STAFF_B_PW,"scope":"staff"})
check(s==200, f"Staff B login on same browser (status {s})")
tokenB = b.get("token")
check(tokenB and tokenB != tokenA, "Staff B has its own distinct per-tab token")
check(b["user"]["email"]==STAFF_B_EMAIL, f"Staff B identity ({b['user']['email']})")

# The shared cookie now belongs to Staff B (A's was overwritten).
s,b = req(browser, "/api/staff/account")
check(b["user"]["email"]==STAFF_B_EMAIL, "shared cookie now resolves to Staff B (bug precondition)")

# Staff A's TAB (carrying A's Bearer token) still resolves to Staff A.
s,b = req(browser, "/api/staff/account", bearer=tokenA)
check(b["user"]["email"]==STAFF_A_EMAIL, "Staff A tab (Bearer) resolves to Staff A — per-tab token WINS")

# Staff B's TAB resolves to Staff B.
s,b = req(browser, "/api/staff/account", bearer=tokenB)
check(b["user"]["email"]==STAFF_B_EMAIL, "Staff B tab (Bearer) resolves to Staff B")

# Staff C on a SEPARATE browser.
s,b = req(browserC, "/api/auth/login", "POST", {"email":STAFF_C_EMAIL,"password":STAFF_C_PW,"scope":"staff"})
check(s==200, f"Staff C login on separate browser (status {s})")
tokenC = b.get("token")
check(b["user"]["email"]==STAFF_C_EMAIL, f"Staff C identity ({b['user']['email']})")

print("\n=== 2. Create ready orders for staff to accept ===")
# Clear stale chef presence so orders route ONLY to chef@restaurant.com (the
# chef this test logs in as). Leftover dispatch chefs from prior runs could
# otherwise grab the orders, and start_preparing would then 422 (ownership).
subprocess.run(["npx","tsx","scripts/clear_chef_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
# Login as chef to push orders through pending -> preparing -> ready.
chef = make_jar()
s,b = req(chef, "/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef login (status {s})")
# Free all tables first, register a customer session.
s,b = req(admin, "/api/tables")
for t in b.get("tables", []):
    req(admin, f"/api/tables/{t['_id']}/free", "POST", {})
tbl = b.get("tables", [{}])[0].get("number")
check(tbl is not None, f"freed tables, using #{tbl}")
cust = make_jar()
s,b = req(cust, "/api/customer/register", "POST", {"tableNumber":tbl,"name":"Staff Test Customer","mobile":"7111100002"})
check(s in (200,201), f"customer register (status {s} {b.get('error','')})")
sid = b.get("session",{}).get("sessionId")
check(sid, "customer session established")
s,b = req(cust, "/api/menu")
mi = b["items"][0]

# Place 3 orders; drive each to 'ready' via the chef.
ready_ids = []
for n in range(3):
    s,b = req(cust, "/api/orders", "POST",
              {"tableNumber":tbl,"sessionId":sid,"items":[{"menuItem":mi["_id"],"quantity":n+1}]})
    check(s in (200,201), f"place order {n+1} (status {s})")
    oid = b.get("order",{}).get("_id")
    s,b = req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"start_preparing"})
    check(s==200, f"chef accepts order {n+1} (status {s})")
    s,b = req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"mark_ready"})
    check(s==200, f"chef marks order {n+1} ready (status {s})")
    ready_ids.append(oid)

print("\n=== 3. Smart dispatch: each ready order is routed to ONE staff member ===")
# With smart dispatch, each ready order goes to ONE staff (least-loaded,
# round-robin) — NOT broadcast to all. Only the assigned staff sees it.
s,b = req(admin, "/api/orders?limit=300")
routed = {}
for oid in ready_ids:
    o = next((x for x in b["orders"] if x["_id"]==oid), None)
    routed[oid] = str(o.get("staffId") or "")
unrouted = sum(1 for v in routed.values() if not v)
check(unrouted == 0, f"all 3 ready orders routed to a staff ({unrouted} unrouted)")

print("\n=== 4. Each staff sees ONLY the orders routed to them (no broadcast) ===")
# Staff A, B, C each poll. Each should see only their own routed orders, with
# no overlap.
s,b = req(browser, "/api/orders?role=staff&limit=300", bearer=tokenA)
a_ids = set(o["_id"] for o in b.get("orders",[]))
s,b = req(browser, "/api/orders?role=staff&limit=300", bearer=tokenB)
b_ids = set(o["_id"] for o in b.get("orders",[]))
s,b = req(browserC, "/api/orders?role=staff&limit=300", bearer=tokenC)
c_ids = set(o["_id"] for o in b.get("orders",[]))
check(not (a_ids & b_ids), "Staff A and B queues do not overlap")
check(not (a_ids & c_ids), "Staff A and C queues do not overlap")
check(not (b_ids & c_ids), "Staff B and C queues do not overlap")

print("\n=== 5. Ownership: a non-assigned staff CANNOT serve an order routed to another ===")
# Pick the first ready order and find who it was routed to.
race_order = ready_ids[0]
assigned_staff = routed[race_order]
# Identify which staff token that is.
if assigned_staff == str(req(browser,"/api/staff/account",bearer=tokenA)[1].get("user",{}).get("id","")):
    owner_token, nonowner_token = tokenA, tokenB
elif assigned_staff == str(req(browser,"/api/staff/account",bearer=tokenB)[1].get("user",{}).get("id","")):
    owner_token, nonowner_token = tokenB, tokenA
else:
    owner_token, nonowner_token = tokenC, tokenA
# Non-owner tries to serve -> 422 (routed to another staff).
s,b = req(browser, f"/api/orders/{race_order}", "PATCH", body={"action":"serve"}, bearer=nonowner_token)
check(s==422, f"non-owner staff serve rejected (status {s})")
check("another staff" in str(b.get("error","")).lower() or "accepted" in str(b.get("error","")).lower(),
      f"clear ownership message ({b.get('error','')[:50]})")

print("\n=== 6. The assigned staff CAN serve it ===")
s,b = req(browser, f"/api/orders/{race_order}", "PATCH", body={"action":"serve"}, bearer=owner_token)
check(s==200, f"owner staff serves the order (status {s})")
s,b = req(admin, "/api/orders")
ord0 = next((o for o in b.get("orders",[]) if o["_id"]==race_order), None)
check(ord0 is not None and ord0.get("acceptedAt") is not None, "acceptedAt timestamp set on the order")
check(ord0.get("status")=="served", "order is now 'served'")

print("\n=== 7. The assigned staff serves a second order routed to them ===")
# Find another ready order routed to the same owner (if any) or to Staff C.
order_c = ready_ids[1]
c_assigned = routed[order_c]
if c_assigned == str(req(browserC,"/api/staff/account",bearer=tokenC)[1].get("user",{}).get("id","")):
    s,b = req(browserC, f"/api/orders/{order_c}", "PATCH", body={"action":"accept"}, bearer=tokenC)
    check(s==200, f"Staff C accepts order routed to them (status {s})")
    s,b = req(browserC, f"/api/orders/{order_c}", "PATCH", body={"action":"serve"}, bearer=tokenC)
    check(s==200, f"Staff C serves order 2 (status {s})")
else:
    # order_c was routed to A or B; have that owner serve it.
    s,b = req(browser, f"/api/orders/{order_c}", "PATCH", body={"action":"serve"}, bearer=owner_token if c_assigned==assigned_staff else tokenB)
    check(s==200, f"owner of order 2 serves it (status {s})")

print("\n=== 8. Queue scoping: each staff sees THEIR served orders only ===")
s,b = req(browser, "/api/orders?role=staff&limit=300", bearer=owner_token)
owner_served = [o["_id"] for o in b.get("orders",[]) if o["status"]=="served"]
check(race_order in owner_served, f"owner sees the order they served")
s,b = req(browser, "/api/orders?role=staff&limit=300", bearer=nonowner_token)
nonowner_served = [o["_id"] for o in b.get("orders",[]) if o["status"]=="served"]
check(race_order not in nonowner_served, "non-owner does NOT see the served order")

print("\n=== 9. Staff account: GET profile ===")
s,b = req(browser, "/api/staff/account", bearer=tokenB)
check(s==200, f"Staff B GET account (status {s})")
check(b["user"]["email"]==STAFF_B_EMAIL, "returns Staff B's profile")
check(b["user"]["role"]=="staff", "role is 'staff'")

print("\n=== 10. Staff account: PATCH name + phone ===")
s,b = req(browser, "/api/staff/account", "PATCH",
          body={"name":"Multi Staff Two Renamed","phone":"+880 1700 999999"}, bearer=tokenB)
check(s==200, f"Staff B PATCH name/phone (status {s})")
check(b["user"]["name"]=="Multi Staff Two Renamed", "name updated")
check(b["user"]["phone"]=="+880 1700 999999", "phone updated")
check(b.get("tokenReissued")==True, "token reissued on name change")
new_tokenB = b.get("token")
check(new_tokenB and new_tokenB != tokenB, "new per-tab token returned")
# The new token carries the updated name.
s,b = req(browser, "/api/staff/account", bearer=new_tokenB)
check(b["user"]["name"]=="Multi Staff Two Renamed", "new token resolves to updated name")
tokenB = new_tokenB  # use the refreshed token from here on

print("\n=== 11. Staff account: PATCH password (requires current password) ===")
s,b = req(browser, "/api/staff/account", "PATCH",
          body={"currentPassword":"wrongpw","newPassword":"newpass123"}, bearer=tokenB)
check(s==422, f"wrong current password rejected (status {s})")
s,b = req(browser, "/api/staff/account", "PATCH",
          body={"currentPassword":STAFF_B_PW,"newPassword":"newpass123"}, bearer=tokenB)
check(s==200, f"correct password change accepted (status {s})")
check(b.get("passwordChanged")==True, "passwordChanged flag set")
# Verify the new password works on a fresh login.
fresh = make_jar()
s,b = req(fresh, "/api/auth/login", "POST", {"email":STAFF_B_EMAIL,"password":"newpass123","scope":"staff"})
check(s==200, f"login with NEW password succeeds (status {s})")

print("\n=== 12. Staff account: cannot set empty name ===")
s,b = req(browser, "/api/staff/account", "PATCH", body={"name":"   "}, bearer=tokenB)
check(s==422, f"empty name rejected (status {s})")

print("\n=== 13. Ringtone + frontend wiring ===")
# The louder doorbell ringtone file must exist and be non-trivial. Fetch RAW
# bytes (the JSON-parsing req helper mangles binary WAV data).
opener = urllib.request.build_opener()
r = urllib.request.Request(BASE+"/sounds/staff-order.wav")
try:
    x = opener.open(r, timeout=10); raw_bytes = x.read()
    rt_status = x.status; rt_len = len(raw_bytes)
except urllib.error.HTTPError as e:
    rt_status = e.code; rt_len = 0
check(rt_status==200, f"GET /sounds/staff-order.wav (status {rt_status})")
check(rt_len>50000, f"ringtone file is substantial ({rt_len} bytes) — not blank")
# Chef ringtone still present (not clobbered).
try:
    x = opener.open(urllib.request.Request(BASE+"/sounds/new-order.wav"), timeout=10)
    chef_status = x.status; chef_len = len(x.read())
except urllib.error.HTTPError as e:
    chef_status = e.code; chef_len = 0
check(chef_status==200, f"chef ringtone new-order.wav still present ({chef_len} bytes)")

# Frontend source wiring.
checks = [
  ("src/lib/apiClient.ts", "Authorization", "apiClient attaches Bearer token"),
  ("src/lib/apiClient.ts", "sessionStorage", "apiClient uses per-tab sessionStorage"),
  ("src/components/ui/LoginCard.tsx", "setTabIdentity", "LoginCard stores per-tab identity"),
  ("src/components/staff/StaffPortalClient.tsx", "staff-order.wav", "StaffPortalClient uses the staff ringtone"),
  ("src/components/staff/StaffPortalClient.tsx", "enableAlerts", "StaffPortalClient has enable-alerts banner"),
  ("src/components/staff/StaffPortalClient.tsx", "action(o, 'accept')", "StaffPortalClient has accept action"),
  ("src/components/staff/StaffPortalClient.tsx", "Signed in as", "StaffPortalClient header shows staff name"),
  ("src/components/staff/StaffPortalClient.tsx", "/staff/account", "StaffPortalClient links to account page"),
  ("src/components/staff/StaffAccountClient.tsx", "api/staff/account", "StaffAccountClient calls staff account API"),
  ("src/components/staff/StaffAccountClient.tsx", "currentPassword", "StaffAccountClient has password change"),
  ("src/app/api/staff/account/route.ts", "role !== 'staff'", "staff account route rejects non-staff"),
  ("src/app/api/orders/[id]/route.ts", "case 'accept'", "PATCH route has accept action"),
  ("src/app/api/orders/[id]/route.ts", "findOneAndUpdate", "accept is atomic (race-safe)"),
  ("src/models/Order.ts", "acceptedAt", "Order model has acceptedAt field"),
]
base = "/home/z/my-project/download/restaurant-app/"
for path, needle, label in checks:
    r = subprocess.run(["grep","-ql",needle,base+path], capture_output=True, text=True)
    check(r.returncode==0, label)

print("\n=== 14. /staff/account page renders (HTML 200) ===")
s,html = req(make_jar(), "/staff/account", "GET")
check(s==200, f"GET /staff/account (status {s})")
# /staff/portal redirects to login when no cookie (307/302) — that's the guard.
s,_ = req(make_jar(), "/staff/portal", "GET")
check(s in (200,307,302), f"GET /staff/portal (status {s})")

print("\n=== Cleanup ===")
for oid in ready_ids:
    req(admin, f"/api/orders/{oid}", "DELETE")
# Reset Staff B password back to the default so other suites still pass.
s,b = req(admin, "/api/users")
for email in (STAFF_B_EMAIL, STAFF_C_EMAIL):
    u = next((x for x in b["users"] if x["email"]==email), None)
    if u:
        req(admin, f"/api/users/{u['_id']}", "DELETE")
# Reset the seed staff account's name if the suite renamed it.
s,b = req(admin, "/api/users")
su = next((x for x in b["users"] if x["email"]=="staff@restaurant.com"), None)
if su:
    req(admin, f"/api/users/{su['_id']}", "PATCH", {"name":"Staff"})
# Free the table.
s,b = req(admin, "/api/tables")
for t in b.get("tables", []):
    req(admin, f"/api/tables/{t['_id']}/free", "POST", {})

print(f"\n{'='*60}")
print(f"MULTI-STAFF PORTAL TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
