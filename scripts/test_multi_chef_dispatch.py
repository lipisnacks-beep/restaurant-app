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
import json, urllib.request, urllib.error, http.cookiejar, sys

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

# Free any occupied tables
s,b = req(admin, "/api/tables")
for t in b["tables"]:
    if t.get("currentSession",{}).get("sessionId"):
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

print("\n=== Both chefs fetch /api/orders?role=chef — both should SEE the pending order ===")
s,bA = req(chefA, "/api/orders?role=chef")
check(s==200, f"chef A fetch (status {s})")
pendingA = [o for o in bA.get("orders",[]) if o["status"]=="pending"]
check(any(o["_id"]==oid for o in pendingA), f"chef A sees pending order {orderNum}")

s,bB = req(chefB, "/api/orders?role=chef")
check(s==200, f"chef B fetch (status {s})")
pendingB = [o for o in bB.get("orders",[]) if o["status"]=="pending"]
check(any(o["_id"]==oid for o in pendingB), f"chef B sees pending order {orderNum}")

print("\n=== Chef A accepts the order (start_preparing) ===")
s,b = req(chefA, f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==200, f"chef A accept (status {s})")
if s==200:
    check(b["order"]["status"]=="preparing", f"order status=preparing (got {b['order']['status']})")
    check(str(b["order"].get("chefId",""))==chefA_id, f"chefId == chef A ({b['order'].get('chefId','')[:8]} == {chefA_id[:8]})")

print("\n=== Chef B fetches again — should NO LONGER see the order (scoped to chefId==A) ===")
s,bB2 = req(chefB, "/api/orders?role=chef")
check(s==200, f"chef B re-fetch (status {s})")
stillPendingB = [o for o in bB2.get("orders",[]) if o["status"]=="pending"]
stillPreparingB = [o for o in bB2.get("orders",[]) if o["status"]=="preparing"]
check(not any(o["_id"]==oid for o in stillPendingB), "chef B no longer sees it as pending")
check(not any(o["_id"]==oid for o in stillPreparingB), "chef B does NOT see chef A's preparing order (scoping works)")

print("\n=== Cache-Control header: every /api/orders response must be no-store ===")
# This is THE fix for the bug the user reported: without `Cache-Control:
# no-store`, mobile browsers (Safari/Chrome) heuristically cache the GET
# and Chef B keeps seeing Chef A's already-accepted order until the cache
# entry expires. We assert the header is present and forbids caching.
s,_,hdrs = req_full(chefB, "/api/orders?role=chef")
cc = hdrs.get("cache-control","")
check("no-store" in cc, f"GET /api/orders returns Cache-Control: no-store (got '{cc}')")
s,_,hdrs = req_full(chefA, "/api/orders?role=chef")
cc = hdrs.get("cache-control","")
check("no-store" in cc, f"chef A also gets no-store (got '{cc}')")

print("\n=== Rapid re-poll: Chef B's NEXT poll (1s later) reflects Chef A's accept, no stale cache ===")
# Place a SECOND order so chef B has something to see, then have chef A
# accept it, and immediately poll as chef B — must NOT return the stale
# pre-accept snapshot.
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"customerName":"Chef Test",
    "items":[{"menuItem":menu["items"][1]["_id"] if len(menu["items"])>1 else menu["items"][0]["_id"],"quantity":1}]})
check(s==201, f"second order placed (status {s})")
oid2 = b["order"]["_id"]
import time
# Chef B sees it pending first (baseline).
s,bB_pre = req(chefB, "/api/orders?role=chef")
saw_before = any(o["_id"]==oid2 and o["status"]=="pending" for o in bB_pre.get("orders",[]))
check(saw_before, "chef B sees order #2 as pending before accept")
# Chef A accepts it.
s,b = req(chefA, f"/api/orders/{oid2}", "PATCH", {"action":"start_preparing"})
check(s==200, f"chef A accepts order #2 (status {s})")
# Chef B polls immediately — must reflect the new state (not pending),
# proving the response was NOT served from a stale cache.
s,bB_post = req(chefB, "/api/orders?role=chef")
saw_pending_after = any(o["_id"]==oid2 and o["status"]=="pending" for o in bB_post.get("orders",[]))
check(not saw_pending_after, "chef B's immediate re-poll does NOT show order #2 as pending (cache busted)")

print("\n=== Chef B tries to accept the same order — should get the race message ===")
s,b = req(chefB, f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==422, f"chef B accept blocked (status {s})")
if s==422:
    err = b.get("error","")
    check("another chef" in err, f"race message mentions 'another chef' (got: '{err}')")

print("\n=== Chef A still sees the order in their 'preparing' queue ===")
s,bA2 = req(chefA, "/api/orders?role=chef")
prepA = [o for o in bA2.get("orders",[]) if o["status"]=="preparing"]
check(any(o["_id"]==oid for o in prepA), "chef A sees their own preparing order")

print("\n=== Chef A marks it ready ===")
s,b = req(chefA, f"/api/orders/{oid}", "PATCH", {"action":"mark_ready"})
check(s==200 and b["order"]["status"]=="ready", f"chef A mark_ready (status {s}, status={b.get('order',{}).get('status')})")

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
