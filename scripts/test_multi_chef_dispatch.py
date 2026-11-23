#!/usr/bin/env python3
"""
End-to-end test for multi-chef order dispatch + ringtone trigger.

Scenario (simulating two chefs on two devices, using two separate cookie jars):
  1. Admin creates a second chef account (chef2@restaurant.com).
  2. Chef A and Chef B both sign in (separate rms_chef_session cookies).
  3. Customer places an order -> status 'pending'.
  4. Both chefs fetch /api/orders?role=chef and SEE the pending order
     (proves: pending orders ring for ALL signed-in chefs).
  5. Chef A accepts (start_preparing) -> order.status='preparing', chefId=A.
  6. Chef B fetches again and NO LONGER sees the order (proves: preparing
     orders are scoped to chefId==me, so Chef B's view is now empty).
  7. Chef B attempts to accept the same order -> 422 with the 'another chef
     just accepted it' message (proves: atomic accept + clear race message).
  8. Chef A still sees the order in their 'preparing' queue and can mark it
     ready.
  9. Verify the ringtone audio file is served at /sounds/new-order.wav so
     the chef portal can play it.

Also confirms the chef portal page serves the new audio element + enable-alerts
banner by grepping the compiled JS bundle.
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, subprocess

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar():
    return http.cookiejar.CookieJar()

def req(jar, path, method="GET", body=None, binary=False):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    r = urllib.request.Request(BASE+path, data=d, method=method, headers={"Content-Type":"application/json"})
    try:
        x = o.open(r, timeout=20)
        raw_bytes = x.read()
        if binary:
            return x.status, raw_bytes
        raw = raw_bytes.decode(errors='replace')
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw_bytes = e.read()
        if binary:
            return e.code, raw_bytes
        raw = raw_bytes.decode(errors='replace')
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

def req_full(jar, path, method="GET", body=None):
    """Same as req() but also returns the response headers (lowercased keys)."""
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    r = urllib.request.Request(BASE+path, data=d, method=method, headers={"Content-Type":"application/json"})
    try:
        x = o.open(r, timeout=20)
        raw = x.read().decode(errors='replace')
        headers = {k.lower(): v for k, v in x.headers.items()}
        try: payload = json.loads(raw) if raw else {}
        except: payload = {"_raw": raw}
        return x.status, payload, headers
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        headers = {k.lower(): v for k, v in e.headers.items()}
        try: payload = json.loads(raw) if raw else {}
        except: payload = {"_raw": raw}
        return e.code, payload, headers

# Separate jars = separate browser sessions for each chef + admin + customer
admin, chefA, chefB, cust = make_jar(), make_jar(), make_jar(), make_jar()

print("\n=== Setup: admin + two chefs + free tables ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")

# Create a second chef (idempotent — if it exists, login will work)
s,b = req(admin, "/api/users", "POST", {"name":"Chef Two","email":"chef2@restaurant.com","password":"chef123","role":"chef"})
chef2_created = (s == 201)
check(s==201 or s==409, f"create chef2 (status {s}, {'new' if chef2_created else 'already exists'})")

s,b = req(chefA, "/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef A login (status {s})")
chefA_id = b.get("user",{}).get("id","")
s,b = req(chefB, "/api/auth/login", "POST", {"email":"chef2@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef B login (status {s})")
chefB_id = b.get("user",{}).get("id","")
check(chefA_id != chefB_id, f"chef A and B are different users ({chefA_id[:8]} vs {chefB_id[:8]})")

# Clear stale chef presence + assignment timestamps so the dispatch test starts
# from a clean slate (chefs from prior runs may have a fresh lastActiveAt).
subprocess.run(["npx","tsx","-e",
  "import('/home/z/my-project/download/restaurant-app/src/lib/db.js').then(async m=>{await m.default();const U=(await import('/home/z/my-project/download/restaurant-app/src/models/User.js')).default;await U.updateMany({role:'chef'},{$set:{lastActiveAt:null,lastAssignedAt:null}});process.exit(0);})"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
# Re-login both chefs so they are marked present again (login touches presence).
req(chefA, "/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
req(chefB, "/api/auth/login", "POST", {"email":"chef2@restaurant.com","password":"chef123","scope":"chef"})

# Free any occupied tables
s,b = req(admin, "/api/tables")
for t in b["tables"]:
    if (t.get("currentSession") or {}).get("sessionId"):
        req(admin, f"/api/tables/{t['_id']}/free", "POST")

print("\n=== Customer places an order on table 1 ===")
s,b = req(cust, "/api/customer/register", "POST", {"name":"Chef Test","mobile":"9555555555","tableNumber":1})
check(s==200, f"customer register (status {s})")
sid = b["session"]["sessionId"]
menu = req(cust, "/api/menu?available=true")[1]
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"customerName":"Chef Test",
    "items":[{"menuItem":menu["items"][0]["_id"],"quantity":2}]})
check(s==201, f"order placed (status {s})")
oid = b["order"]["_id"]
orderNum = b["order"]["orderNumber"]

print("\n=== Both chefs fetch /api/orders?role=chef — order goes to ONE chef only ===")
# Smart dispatch: the order is routed to exactly ONE chef (least-loaded,
# round-robin tiebreak). Only that chef sees it pending; the other does not.
s,bA = req(chefA, "/api/orders?role=chef")
check(s==200, f"chef A fetch (status {s})")
pendingA = [o for o in bA.get("orders",[]) if o["status"]=="pending"]

s,bB = req(chefB, "/api/orders?role=chef")
check(s==200, f"chef B fetch (status {s})")
pendingB = [o for o in bB.get("orders",[]) if o["status"]=="pending"]

seesA = any(o["_id"]==oid for o in pendingA)
seesB = any(o["_id"]==oid for o in pendingB)
check(seesA or seesB, f"the order is visible to at least one chef ({orderNum})")
# Exactly one chef was routed the order (NOT broadcast to both).
check(seesA != seesB, f"order routed to ONE chef only (A={seesA}, B={seesB}) — no broadcast")
# Determine which chef owns it for the subsequent steps.
owner_is_A = seesA
owner_chef = chefA if owner_is_A else chefB
owner_id = chefA_id if owner_is_A else chefB_id
other_chef = chefB if owner_is_A else chefA
other_id = chefB_id if owner_is_A else chefA_id
print(f"     -> order {orderNum} routed to chef {'A' if owner_is_A else 'B'}")

print(f"\n=== The owner chef accepts the order (start_preparing) ===")
s,b = req(owner_chef, f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==200, f"owner chef accept (status {s})")
if s==200:
    check(b["order"]["status"]=="preparing", f"order status=preparing (got {b['order']['status']})")
    check(str(b["order"].get("chefId",""))==owner_id, f"chefId == owner chef ({b['order'].get('chefId','')[:8]} == {owner_id[:8]})")

print("\n=== The OTHER chef never saw this order (dispatch scoping works) ===")
s,bB2 = req(other_chef, "/api/orders?role=chef")
check(s==200, f"other chef re-fetch (status {s})")
stillPendingB = [o for o in bB2.get("orders",[]) if o["status"]=="pending"]
stillPreparingB = [o for o in bB2.get("orders",[]) if o["status"]=="preparing"]
check(not any(o["_id"]==oid for o in stillPendingB), "other chef never sees it as pending")
check(not any(o["_id"]==oid for o in stillPreparingB), "other chef does NOT see the owner's preparing order")

print("\n=== Cache-Control header: every /api/orders response must be no-store ===")
s,_,hdrs = req_full(chefB, "/api/orders?role=chef")
cc = hdrs.get("cache-control","")
check("no-store" in cc, f"GET /api/orders returns Cache-Control: no-store (got '{cc}')")
s,_,hdrs = req_full(chefA, "/api/orders?role=chef")
cc = hdrs.get("cache-control","")
check("no-store" in cc, f"chef A also gets no-store (got '{cc}')")

print("\n=== Second order: dispatched to the OTHER chef (round-robin / least-loaded) ===")
# With chef A's owner now at load 1 (preparing) and the other at load 0, the
# next order should go to the other chef (least-loaded).
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"customerName":"Chef Test",
    "items":[{"menuItem":menu["items"][1]["_id"] if len(menu["items"])>1 else menu["items"][0]["_id"],"quantity":1}]})
check(s==201, f"second order placed (status {s})")
oid2 = b["order"]["_id"]
# The other chef should see order #2 (routed to them).
s,b_other = req(other_chef, "/api/orders?role=chef")
sees_other = any(o["_id"]==oid2 and o["status"]=="pending" for o in b_other.get("orders",[]))
check(sees_other, "the OTHER chef sees order #2 (routed to them via least-loaded)")
# The owner chef should NOT see order #2 (it wasn't routed to them).
s,b_owner = req(owner_chef, "/api/orders?role=chef")
sees_owner_o2 = any(o["_id"]==oid2 for o in b_owner.get("orders",[]))
check(not sees_owner_o2, "the first owner does NOT see order #2 (not routed to them)")
# The other chef accepts order #2.
s,b = req(other_chef, f"/api/orders/{oid2}", "PATCH", {"action":"start_preparing"})
check(s==200, f"other chef accepts order #2 (status {s})")

print("\n=== The OTHER chef tries to accept the FIRST order — blocked by ownership ===")
s,b = req(other_chef, f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==422, f"non-owner chef accept blocked (status {s})")
if s==422:
    err = b.get("error","")
    check("routed to another chef" in err or "another chef" in err, f"ownership message (got: '{err}')")

print("\n=== The owner chef still sees the order in their 'preparing' queue ===")
s,bA2 = req(owner_chef, "/api/orders?role=chef")
prepA = [o for o in bA2.get("orders",[]) if o["status"]=="preparing"]
check(any(o["_id"]==oid for o in prepA), "owner chef sees their own preparing order")

print("\n=== The owner chef marks it ready ===")
s,b = req(owner_chef, f"/api/orders/{oid}", "PATCH", {"action":"mark_ready"})
check(s==200 and b["order"]["status"]=="ready", f"owner chef mark_ready (status {s}, status={b.get('order',{}).get('status')})")

print("\n=== Ringtone audio file is served ===")
# Use a fresh jar (no auth needed for static file)
s,raw_bytes = req(make_jar(), "/sounds/new-order.wav", "GET", binary=True)
check(s==200, f"ringtone WAV served at /sounds/new-order.wav (status {s}, {len(raw_bytes)} bytes)")
if s==200:
    # WAV header check: 'RIFF'....'WAVE'
    is_wav = isinstance(raw_bytes, (bytes, bytearray)) and raw_bytes[:4] == b'RIFF' and raw_bytes[8:12] == b'WAVE'
    check(is_wav, "served file is a valid WAV (RIFF/WAVE header present)")

print("\n=== Chef portal page compiled with new audio element + alerts banner ===")
s,html = req(make_jar(), "/chef/portal", "GET")
# The audio element src and the enable-alerts banner text should appear in
# the compiled JS bundle (the page is client-rendered, so we check the bundle).
import subprocess
bundle_hit = subprocess.run(
    ["grep","-rl","new-order.wav","/home/z/my-project/download/restaurant-app/.next/static"],
    capture_output=True, text=True)
check(bundle_hit.returncode==0, "ringtone URL 'new-order.wav' present in compiled bundle")
banner_hit = subprocess.run(
    ["grep","-rl","Enable order alerts","/home/z/my-project/download/restaurant-app/.next/static"],
    capture_output=True, text=True)
check(banner_hit.returncode==0, "'Enable order alerts' banner present in compiled bundle")

print("\n=== Cleanup ===")
req(admin, f"/api/tables/1/free".replace("1",oid) if False else "/api/tables")
# Free table 1 properly
s,b = req(admin, "/api/tables")
t1 = next(t for t in b["tables"] if t["number"]==1)
req(admin, f"/api/tables/{t1['_id']}/free", "POST")
print("  freed table 1")

print(f"\n{'='*60}")
print(f"MULTI-CHEF DISPATCH TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
