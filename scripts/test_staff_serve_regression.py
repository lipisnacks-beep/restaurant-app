#!/usr/bin/env python3
"""
Regression test for the bug:
  "Only staff or admin can serve an order (your role: chef)" in the staff portal.

Root cause: when a browser is signed in as both chef AND staff (separate scoped
cookies rms_chef_session + rms_staff_session), the orders PATCH endpoint called
resolveSession(req) with scope 'any', which returns the FIRST cookie in
declaration order (admin -> chef -> staff). So the chef cookie won, and every
staff-portal action authenticated as 'chef' and was rejected.

Fix: resolveSessionForRoles(req, allowedRoles, preferredRole) scans every cookie
and returns the first one whose role is in the allow-list. Each action passes
its own allow-list (serve -> ['admin','staff'] preferred 'staff').

This test signs in as both chef and staff on the SAME cookie jar (simulating one
browser), places an order, prepares it as chef, then serves it as staff — and
verifies the serve succeeds (previously returned 403 'your role: chef').
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, subprocess

BASE = "http://localhost:3133"
# ONE cookie jar simulating ONE browser signed in as chef + staff + admin
both = http.cookiejar.CookieJar()

def req(path, method="GET", body=None, jar=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar or both))
    r = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        resp = opener.open(r, timeout=20)
        raw = resp.read().decode()
        try: return resp.status, json.loads(raw) if raw else {}
        except: return resp.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

PASS=0; FAIL=0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS+=1; print(f"  ✓ {msg}")
    else: FAIL+=1; print(f"  ✗ {msg}")

print("\n=== Sign in as chef, staff AND admin on the SAME browser ===")
# Clear stale chef presence so orders route ONLY to chef@restaurant.com (the
# chef this test logs in as). Leftover dispatch chefs from prior runs could
# otherwise grab the orders, and start_preparing would then 422 (ownership).
subprocess.run(["npx","tsx","scripts/clear_chef_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
s,b = req("/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef login (status {s})")
s,b = req("/api/auth/login", "POST", {"email":"staff@restaurant.com","password":"staff123","scope":"staff"})
check(s==200, f"staff login (status {s})")
s,b = req("/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")
print("  · all three scoped cookies now present in one jar")

# Count the scoped cookies
cookie_names = [c.name for c in both]
print(f"  · cookies: {sorted(cookie_names)}")
check("rms_chef_session" in cookie_names, "chef cookie present")
check("rms_staff_session" in cookie_names, "staff cookie present")

print("\n=== Register a customer + place an order ===")
cust = http.cookiejar.CookieJar()
def creq(p, m="GET", body=None):
    d = json.dumps(body).encode() if body else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cust))
    r = urllib.request.Request(BASE+p, data=d, method=m, headers={"Content-Type":"application/json"})
    try:
        x=o.open(r,timeout=20); return x.status, json.loads(x.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# Free table 1 first if occupied
s,b = req("/api/tables")
for t in b["tables"]:
    if (t.get("currentSession") or {}).get("sessionId"):
        req(f"/api/tables/{t['_id']}/free", "POST")

s,b = creq("/api/customer/register", "POST", {"name":"Reg Test","mobile":"9777777777","tableNumber":1})
check(s==200, f"customer register (status {s})")
sid = b["session"]["sessionId"]
menu = creq("/api/menu?available=true")[1]
s,b = creq("/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"customerName":"Reg Test",
    "items":[{"menuItem":menu["items"][0]["_id"],"quantity":1}]})
check(s==201, f"order placed (status {s})")
oid = b["order"]["_id"]

print("\n=== Chef starts preparing (using the same jar with all cookies) ===")
s,b = req(f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==200 and b["order"]["status"]=="preparing", f"start_preparing ok (status {s}, role-resolved)")

print("\n=== Chef marks ready (same jar) ===")
# Staff polls first so their presence is fresh when mark_ready runs the staff
# dispatch sweep — the order routes to THIS staff, who can then serve it.
req("/api/orders?role=staff&limit=50", "GET", None, jar=both)
s,b = req(f"/api/orders/{oid}", "PATCH", {"action":"mark_ready"})
check(s==200 and b["order"]["status"]=="ready", f"mark_ready ok (status {s})")
# Staff picks up the routed order.
req("/api/orders?role=staff&limit=50", "GET", None, jar=both)

print("\n=== THE KEY TEST: staff serves order from staff portal ===")
print("  (previously returned 403 'Only staff or admin can serve (your role: chef)')")
s,b = req(f"/api/orders/{oid}", "PATCH", {"action":"serve"})
check(s==200, f"serve HTTP 200 (got {s})")
if s != 200:
    print(f"    error body: {b}")
else:
    check(b["order"]["status"]=="served", f"order status=served (got {b['order']['status']})")

print("\n=== Staff completes order (same jar) ===")
s,b = req(f"/api/orders/{oid}", "PATCH", {"action":"complete"})
check(s==200 and b["order"]["status"]=="completed", f"complete ok (status {s})")

print("\n=== Staff frees the table (same jar) ===")
s,b = req("/api/tables")
t1 = next(t for t in b["tables"] if t["number"]==1)
s,b = req(f"/api/tables/{t1['_id']}/free", "POST")
check(s==200, f"free table ok (status {s})")

print("\n=== Cross-check: chef action from the same jar still works ===")
# Re-register a fresh customer (the previous session was closed when the table was freed)
cust2 = http.cookiejar.CookieJar()
def creq2(p, m="GET", body=None):
    d = json.dumps(body).encode() if body else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cust2))
    r = urllib.request.Request(BASE+p, data=d, method=m, headers={"Content-Type":"application/json"})
    try:
        x=o.open(r,timeout=20); return x.status, json.loads(x.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")
s,b = creq2("/api/customer/register", "POST", {"name":"Reg Test 2","mobile":"9666666666","tableNumber":2})
check(s==200, f"second customer register (status {s})")
sid2 = b["session"]["sessionId"]
s,b = creq2("/api/orders", "POST", {"tableNumber":2,"sessionId":sid2,"customerName":"Reg Test 2",
    "items":[{"menuItem":menu["items"][0]["_id"],"quantity":1}]})
check(s==201, f"order placed (status {s})")
oid2 = b["order"]["_id"]
# Refresh chef presence (poll touches it) so oid2 routes to THIS chef.
req("/api/orders?role=chef&limit=50", "GET", None, jar=both)
s,b = req(f"/api/orders/{oid2}", "PATCH", {"action":"start_preparing"})
check(s==200, f"chef start_preparing still works from same jar (status {s})")
# cleanup
s,b = req("/api/tables")
for t in b["tables"]:
    if (t.get("currentSession") or {}).get("sessionId"):
        req(f"/api/tables/{t['_id']}/free", "POST")

print(f"\n{'='*60}")
print(f"REGRESSION TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
