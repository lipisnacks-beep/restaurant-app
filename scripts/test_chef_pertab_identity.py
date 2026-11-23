#!/usr/bin/env python3
"""
Per-tab chef identity test — the 'two chefs on one browser' bug.

THE BUG (before the fix):
  There is a single rms_chef_session cookie per browser. When Chef B logs in
  on a second tab of the same browser, that cookie is overwritten with Chef
  B's identity. Chef A's still-open first tab then silently becomes Chef B —
  any order Chef A accepts gets recorded against Chef B, and the portal
  header shows Chef B's name on Chef A's screen. On separate devices it
  already worked (each device has its own cookie jar).

THE FIX:
  Each browser tab now carries its own per-tab Bearer token (sessionStorage on
  the client, attached as `Authorization: Bearer ...` on every request).
  resolveSessionForRoles prefers the Bearer token over the shared cookie, so
  each tab resolves to the chef who actually signed in on that tab — even
  though both tabs share the same single rms_chef_session cookie.

This test simulates TWO TABS on the SAME browser:
  - ONE shared cookie jar (both logins land in the same cookie store, exactly
    like two tabs on one browser — Chef B's login overwrites Chef A's cookie).
  - Each "tab" holds its own Bearer token from its own login response.
  - We prove:
      1. After both logins, the shared cookie belongs to Chef B (login B
         overwrote login A's cookie) — reproducing the bug's precondition.
      2. Tab A's requests carry Tab A's Bearer token -> /api/chef/account
         returns Chef A (NOT Chef B). The per-tab token wins.
      3. Tab B's requests carry Tab B's Bearer token -> returns Chef B.
      4. Tab A accepts an order -> order.chefId == Chef A.
      5. Tab B accepts a different order -> order.chefId == Chef B.
      6. Tab A sees only its own preparing orders (chefId == Chef A),
         not Chef B's.
      7. Cookie-only requests (no Bearer) resolve to whoever's cookie is
         present — i.e. Chef B (the last login). This confirms the bug
         exists WITHOUT the per-tab token, and that the token is what fixes it.
      8. A Bearer token from a LOGGED-OUT tab (cookie cleared but token kept)
         still authenticates -> confirms the token is self-sufficient.

Uses a dedicated second test chef (chef_pertab@restaurant.com); cleaned up.
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, subprocess

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar(): return http.cookiejar.CookieJar()

def req(jar, path, method="GET", body=None, bearer=None):
    """If `bearer` is given, send Authorization: Bearer (simulating a per-tab
    token) AND still use the shared cookie jar (simulating same-browser tabs).
    If `bearer` is None, the request is cookie-only (the buggy old behavior)."""
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

CHEF_A_EMAIL = "chef@restaurant.com"            # seed chef
CHEF_A_PW    = "chef123"
CHEF_B_EMAIL = "chef_pertab@restaurant.com"     # dedicated second chef
CHEF_B_NAME  = "Pertab Chef Two"
CHEF_B_PW    = "chef123"

admin = make_jar()
# THE KEY: one shared cookie jar for BOTH "tabs" — exactly like two tabs on
# one browser. Chef B's login will overwrite Chef A's cookie in this jar.
browser = make_jar()

print("\n=== Setup: admin ensures the second chef account exists ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")
s,b = req(admin, "/api/users", "POST", {"name":CHEF_B_NAME,"email":CHEF_B_EMAIL,"password":CHEF_B_PW,"role":"chef"})
check(s==201 or s==409, f"create second chef (status {s}, {'new' if s==201 else 'exists'})")
# If it existed, reset its password+name to known values so the test is stable.
s,b = req(admin, "/api/users")
chef_b = next((u for u in b["users"] if u["email"]==CHEF_B_EMAIL), None)
check(chef_b is not None, "second chef present in user list")
if chef_b:
    s,b = req(admin, f"/api/users/{chef_b['_id']}", "PATCH", {"password":CHEF_B_PW,"name":CHEF_B_NAME})
    check(s==200, f"reset second chef password/name (status {s})")

print("\n=== Tab A: Chef A logs in (shared cookie jar) ===")
# Clear stale chef presence so orders route ONLY to chef A or B (the chefs
# this test logs in as). Leftover dispatch chefs from prior runs could
# otherwise grab the orders, and start_preparing would then 422 (ownership).
subprocess.run(["npx","tsx","scripts/clear_chef_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
s,b = req(browser, "/api/auth/login", "POST", {"email":CHEF_A_EMAIL,"password":CHEF_A_PW,"scope":"chef"})
check(s==200, f"Chef A login (status {s})")
check("token" in b, "login response includes per-tab token")
tokenA = b.get("token")
check(b["user"]["email"]==CHEF_A_EMAIL, f"Chef A identity in response ({b['user']['email']})")

print("\n=== Tab B: Chef B logs in on the SAME browser (same cookie jar) ===")
s,b = req(browser, "/api/auth/login", "POST", {"email":CHEF_B_EMAIL,"password":CHEF_B_PW,"scope":"chef"})
check(s==200, f"Chef B login (status {s})")
tokenB = b.get("token")
check(tokenB and tokenB != tokenA, "Chef B has its own distinct per-tab token")
check(b["user"]["email"]==CHEF_B_EMAIL, f"Chef B identity in response ({b['user']['email']})")

print("\n=== 1. The shared cookie now belongs to Chef B (Chef A's cookie was overwritten) ===")
# Cookie-only request (no Bearer) -> resolves to whoever owns the cookie now.
s,b = req(browser, "/api/chef/account")
check(s==200, f"cookie-only GET /api/chef/account (status {s})")
check(b["user"]["email"]==CHEF_B_EMAIL,
      f"shared cookie now resolves to Chef B ({b['user']['email']}) — reproduces the bug precondition")
print("     (^^ This confirms that WITHOUT a per-tab token, Chef A's tab would now be Chef B.)")

print("\n=== 2. Tab A (carrying Chef A's Bearer token) still resolves to Chef A ===")
s,b = req(browser, "/api/chef/account", bearer=tokenA)
check(s==200, f"Tab A GET /api/chef/account with its Bearer token (status {s})")
check(b["user"]["email"]==CHEF_A_EMAIL,
      f"Tab A resolves to Chef A ({b['user']['email']}) — per-tab token WINS over shared cookie")
check(b["user"]["name"]!="Pertab Chef Two", "Tab A is NOT showing Chef B's name")

print("\n=== 3. Tab B (carrying Chef B's Bearer token) resolves to Chef B ===")
s,b = req(browser, "/api/chef/account", bearer=tokenB)
check(s==200, f"Tab B GET /api/chef/account with its Bearer token (status {s})")
check(b["user"]["email"]==CHEF_B_EMAIL, f"Tab B resolves to Chef B ({b['user']['email']})")

print("\n=== 4. Tab A accepts an order -> recorded under Chef A ===")
# Place a customer order first so there's something to accept.
cust = make_jar()
s,b = req(admin, "/api/tables")
# free every table first so we can register cleanly
for t in b.get("tables", []):
    req(admin, f"/api/tables/{t['_id']}/free", "POST", {})
free_table = b.get("tables", [{}])[0].get("number") if b.get("tables") else None
check(free_table is not None, f"freed tables, using #{free_table}")

# Valid Indian mobile: 10 digits starting 6-9. Use a unique-ish number.
s,b = req(cust, "/api/customer/register", "POST",
          {"tableNumber":free_table,"name":"PerTab Customer","mobile":"7000000042"})
check(s in (200,201), f"customer register (status {s} {b.get('error','')})")
session_id = b.get("session",{}).get("sessionId")
check(session_id, f"customer session established (sessionId present)")
s,b = req(cust, "/api/menu")
check("items" in b, "menu fetched")
menu_item = b["items"][0]
s,b = req(cust, "/api/orders", "POST",
          {"tableNumber":free_table,"sessionId":session_id,"items":[{"menuItem":menu_item["_id"],"quantity":1}]})
check(s in (200,201), f"customer places order A (status {s} {b.get('error','')})")
orderA = b.get("order") or b.get("orders",[None])[0]
orderA_id = orderA["_id"] if orderA else None
check(orderA_id, f"order A created ({orderA.get('orderNumber') if orderA else 'NONE'})")

# Place a SECOND order for Chef B to accept.
s,b = req(cust, "/api/orders", "POST",
          {"tableNumber":free_table,"sessionId":session_id,"items":[{"menuItem":menu_item["_id"],"quantity":2}]})
check(s in (200,201), f"customer places order B (status {s} {b.get('error','')})")
orderB = b.get("order") or b.get("orders",[None])[0]
orderB_id = orderB["_id"] if orderB else None
check(orderB_id, f"order B created ({orderB.get('orderNumber') if orderB else 'NONE'})")

# Tab A accepts order A.
s,b = req(browser, f"/api/orders/{orderA_id}", "PATCH",
          body={"action":"start_preparing"}, bearer=tokenA)
check(s==200, f"Tab A accepts order A (status {s})")
# Confirm via DB: fetch orders as admin and check chefId == Chef A.
s,b = req(admin, "/api/orders", "GET")
ord_a = next((o for o in b.get("orders",[]) if o["_id"]==orderA_id), None)
if ord_a is None:
    # admin GET only returns today's; retry with role=chef won't help admin.
    ord_a = next((o for o in b.get("orders",[]) if o.get("_id")==orderA_id), None)
chef_a_id = None
s,bu = req(admin, "/api/users")
chef_a_user = next((u for u in bu["users"] if u["email"]==CHEF_A_EMAIL), None)
chef_a_id = chef_a_user["_id"] if chef_a_user else None
check(ord_a is not None and ord_a.get("chefId")==chef_a_id,
      f"order A recorded under Chef A (chefId={ord_a.get('chefId') if ord_a else '??'}, expected {chef_a_id})")

print("\n=== 5. Tab B accepts order B -> recorded under Chef B ===")
s,b = req(browser, f"/api/orders/{orderB_id}", "PATCH",
          body={"action":"start_preparing"}, bearer=tokenB)
check(s==200, f"Tab B accepts order B (status {s})")
s,b = req(admin, "/api/orders")
ord_b = next((o for o in b.get("orders",[]) if o["_id"]==orderB_id), None)
check(ord_b is not None and ord_b.get("chefId")==chef_b["_id"],
      f"order B recorded under Chef B (chefId={ord_b.get('chefId') if ord_b else '??'}, expected {chef_b['_id']})")

print("\n=== 6. Tab A sees only ITS OWN preparing orders (not Chef B's) ===")
s,b = req(browser, "/api/orders?role=chef", bearer=tokenA)
seen_ids = [o["_id"] for o in b.get("orders",[])]
prep_a = [o for o in b.get("orders",[]) if o["status"]=="preparing"]
check(orderA_id in seen_ids, "Tab A sees its own accepted order A")
check(orderB_id not in seen_ids or all(o.get("chefId")!=chef_b["_id"] for o in prep_a),
      "Tab A does NOT see Chef B's preparing order B")
print(f"     Tab A sees orders: {seen_ids}")

print("\n=== 7. Tab B sees only ITS OWN preparing orders (not Chef A's) ===")
s,b = req(browser, "/api/orders?role=chef", bearer=tokenB)
seen_ids_b = [o["_id"] for o in b.get("orders",[])]
check(orderB_id in seen_ids_b, "Tab B sees its own accepted order B")
check(orderA_id not in seen_ids_b, "Tab B does NOT see Chef A's preparing order A")
print(f"     Tab B sees orders: {seen_ids_b}")

print("\n=== 8. Per-tab token is self-sufficient (cookie cleared, token kept) ===")
# Simulate a tab whose cookie expired/was cleared but the per-tab token is still
# in sessionStorage. The Bearer token alone must authenticate.
tokenOnlyJar = make_jar()  # fresh jar, no cookies at all
s,b = req(tokenOnlyJar, "/api/chef/account", bearer=tokenA)
check(s==200, f"Bearer-only (no cookie) still authenticates as Chef A (status {s})")
check(b["user"]["email"]==CHEF_A_EMAIL, f"Bearer-only resolves to Chef A ({b['user']['email']})")

print("\n=== 9. Frontend: per-tab identity wiring present in source ===")
apiclient = "/home/z/my-project/download/restaurant-app/src/lib/apiClient.ts"
r1 = subprocess.run(["grep","-ql","Authorization",apiclient], capture_output=True, text=True)
check(r1.returncode==0, "apiClient attaches Authorization: Bearer")
r2 = subprocess.run(["grep","-ql","sessionStorage",apiclient], capture_output=True, text=True)
check(r2.returncode==0, "apiClient uses sessionStorage (per-tab, not localStorage)")
r3 = subprocess.run(["grep","-ql","setTabIdentity","/home/z/my-project/download/restaurant-app/src/components/ui/LoginCard.tsx"], capture_output=True, text=True)
check(r3.returncode==0, "LoginCard calls setTabIdentity on login")
r4 = subprocess.run(["grep","-ql","getTabToken","/home/z/my-project/download/restaurant-app/src/components/chef/ChefPortalClient.tsx"], capture_output=True, text=True)
check(r4.returncode==0, "ChefPortalClient reads per-tab token on mount")
r5 = subprocess.run(["grep","-ql","Signed in as","/home/z/my-project/download/restaurant-app/src/components/chef/ChefPortalClient.tsx"], capture_output=True, text=True)
check(r5.returncode==0, "ChefPortalClient header shows signed-in chef name")
r6 = subprocess.run(["grep","-ql","Bearer","/home/z/my-project/download/restaurant-app/src/lib/auth.ts"], capture_output=True, text=True)
check(r6.returncode==0, "auth.ts resolveSessionForRoles checks Bearer token")

print("\n=== Cleanup ===")
# Clean up the two test orders + the second chef account.
for oid in [orderA_id, orderB_id]:
    if oid:
        req(admin, f"/api/orders/{oid}", "DELETE")
if chef_b:
    s,b = req(admin, f"/api/users/{chef_b['_id']}", "DELETE")
    check(s==200, f"second chef account deleted (status {s})")
# Free the table we used.
if free_table is not None:
    s,b = req(admin, "/api/tables")
    for t in b.get("tables",[]):
        if t["number"]==free_table:
            req(admin, f"/api/tables/{t['_id']}/free", "POST", {})

print(f"\n{'='*60}")
print(f"PER-TAB CHEF IDENTITY TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
