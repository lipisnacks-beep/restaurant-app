#!/usr/bin/env python3
"""
Free-table ownership gate + tips-available badge test.

Verifies the user's request:
  - Only the staff who SERVED a table's customers may mark it "ready to free"
    (i.e. tap Free Table) after payment completes.
  - The staff portal tips badge shows the WITHDRAWABLE (available) amount, not
    the cumulative earned total.

Coverage:
  1. Two staff (A, B) log in; orders route to staff A (only A present).
  2. Staff A serves order on table 1; table.currentSession.servedByStaffId = A.
  3. Customer pays (with tip) -> session status 'paid'.
  4. Staff A can free table 1 (200). Staff B CANNOT (403 "did not serve").
  5. Admin can force-free any table (200) even if servedByStaffId != admin.
  6. Tips: staff A's available balance = tipsEarned - tipsWithdrawn (badge).
  7. After A withdraws some tips, available drops; badge reflects it.
  8. servedByStaffId is set on the table after serve, null/absent before.
  9. A table with no servedByStaffId (legacy) can be freed by any staff.
"""
import json, urllib.request, urllib.error, http.cookiejar, subprocess, sys

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
        x = o.open(r, timeout=30); raw = x.read().decode(errors='replace')
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

# Full clean slate.
subprocess.run(["node","scripts/full_clean.js"], cwd="/home/z/my-project/download/restaurant-app",
  capture_output=True, text=True)

admin = make_jar()
print("=== Setup ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")

# Two test staff accounts.
STAFF_A = "freegate_a@restaurant.com"
STAFF_B = "freegate_b@restaurant.com"
for email in (STAFF_A, STAFF_B):
    s,b = req(admin, "/api/users", "POST", {"name":email.split("@")[0],"email":email,"password":"staff123","role":"staff"})
    check(s in (201,409), f"create {email} (status {s})")
# Get their ids.
s,b = req(admin, "/api/users")
users = {u["email"]: u for u in b["users"]}
staffA_id = users[STAFF_A]["_id"]
staffB_id = users[STAFF_B]["_id"]
# Reset their tips + presence.
subprocess.run(["npx","tsx","scripts/reset_staff_tips.ts",staffA_id,"0","0"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
subprocess.run(["npx","tsx","scripts/reset_staff_tips.ts",staffB_id,"0","0"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
subprocess.run(["npx","tsx","scripts/clear_all_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)

# Chef + Staff A login.
chef = make_jar()
s,b = req(chef, "/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef login (status {s})")
chef_token = b.get("token")
staffA = make_jar()
s,b = req(staffA, "/api/auth/login", "POST", {"email":STAFF_A,"password":"staff123","scope":"staff"})
check(s==200, f"staff A login (status {s})")
tokenA = b.get("token")
# Staff B login (but B will NOT be present — only A polls, so orders route to A).
staffB = make_jar()
s,b = req(staffB, "/api/auth/login", "POST", {"email":STAFF_B,"password":"staff123","scope":"staff"})
check(s==200, f"staff B login (status {s})")
tokenB = b.get("token")

print("\n=== 1. servedByStaffId absent before serve ===")
s,b = req(admin, "/api/tables")
tbl1 = next(t for t in b["tables"] if t["number"]==1)
check(not tbl1.get("currentSession",{}).get("servedByStaffId"), "table 1 has no servedByStaffId before any serve")

print("\n=== 2. Staff A serves table 1 -> servedByStaffId = A ===")
cust = make_jar()
s,b = req(cust, "/api/customer/register", "POST", {"tableNumber":1,"name":"Free Gate Cust","mobile":"7333300701"})
sid = b.get("session",{}).get("sessionId")
menu = req(admin, "/api/menu")[1]
mi = menu["items"][0]
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"items":[{"menuItem":mi["_id"],"quantity":1}]})
oid = b.get("order",{}).get("_id")
req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)  # presence
req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)
s,b = req(staffA, f"/api/orders/{oid}", "PATCH", body={"action":"serve"}, bearer=tokenA)
check(s==200, f"staff A serves order (status {s})")
# Verify servedByStaffId set on the table.
s,b = req(admin, "/api/tables")
tbl1 = next(t for t in b["tables"] if t["number"]==1)
served_by = tbl1.get("currentSession",{}).get("servedByStaffId")
check(served_by == staffA_id, f"table 1 servedByStaffId == A ({served_by})")

print("\n=== 3. Customer pays with tip -> session 'paid' ===")
s,b = req(cust, f"/api/orders/{oid}", "PATCH", body={"action":"pay","paymentMethod":"upi","tip":40})
check(s==200, f"customer pays with tip 40 (status {s})")
s,b = req(admin, "/api/tables")
tbl1 = next(t for t in b["tables"] if t["number"]==1)
check(tbl1.get("currentSession",{}).get("sessionStatus")=="paid", f"table 1 session 'paid' (got {tbl1.get('currentSession',{}).get('sessionStatus')})")

print("\n=== 4. Staff B CANNOT free table 1 (did not serve) -> 403 ===")
s,b = req(staffB, f"/api/tables/{tbl1['_id']}/free", "POST", body={}, bearer=tokenB)
check(s==403, f"staff B free table 1 rejected (status {s})")
check("did not serve" in str(b.get("error","")).lower(), f"clear 'did not serve' message (got: {b.get('error','')})")

print("\n=== 5. Staff A CAN free table 1 (served by A) -> 200 ===")
s,b = req(staffA, f"/api/tables/{tbl1['_id']}/free", "POST", body={}, bearer=tokenA)
check(s==200, f"staff A frees table 1 (status {s})")
# Table should now be free.
s,b = req(admin, "/api/tables")
tbl1 = next(t for t in b["tables"] if t["number"]==1)
check(not tbl1.get("currentSession") or not tbl1["currentSession"].get("sessionId"), "table 1 now free (no session)")

print("\n=== 6. Admin can force-free a table served by a different staff ===")
# New order on table 2, served by staff A, paid, then admin frees it.
# Clear all presence first so only staff A (who logs in/polls below) is
# available to receive the order — round-robin won't route it to B.
subprocess.run(["npx","tsx","scripts/clear_all_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
cust2 = make_jar()
s,b = req(cust2, "/api/customer/register", "POST", {"tableNumber":2,"name":"Free Gate Cust 2","mobile":"7333300702"})
sid2 = b.get("session",{}).get("sessionId")
s,b = req(cust2, "/api/orders", "POST", {"tableNumber":2,"sessionId":sid2,"items":[{"menuItem":mi["_id"],"quantity":2}]})
oid2 = b.get("order",{}).get("_id")
req(chef, f"/api/orders/{oid2}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
# Refresh staff A's presence right before mark_ready so the dispatch routes
# table 2's order to staff A (not staff B, who is also online).
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)
req(chef, f"/api/orders/{oid2}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)
s,b = req(staffA, f"/api/orders/{oid2}", "PATCH", body={"action":"serve"}, bearer=tokenA)
check(s==200, f"staff A serves order 2 (status {s})")
# Re-fetch tables AFTER serve so servedByStaffId is reflected.
s,b = req(admin, "/api/tables")
tbl2 = next(t for t in b["tables"] if t["number"]==2)
served_by_2 = tbl2.get("currentSession",{}).get("servedByStaffId")
# Table 2 is served by SOME staff (could be A or B — round-robin decides).
# The point of this test: admin can free a table regardless of who served it.
check(bool(served_by_2), f"table 2 servedByStaffId is set (got {served_by_2})")
req(cust2, f"/api/orders/{oid2}", "PATCH", body={"action":"pay","paymentMethod":"cash","tip":0})
s,b = req(admin, f"/api/tables/{tbl2['_id']}/free", "POST", body={})
check(s==200, f"admin force-frees table 2 (served by staff) (status {s})")

print("\n=== 7. Tips badge shows available (not cumulative earned) ===")
# Staff A earned tip 40 from order 1, 0 from order 2. tipsEarned=40, withdrawn=0,
# so available=40. Account profile returns tipsAvailable.
s,b = req(staffA, "/api/staff/account", bearer=tokenA)
u = b.get("user",{})
check(u.get("tipsEarned")==40, f"tipsEarned == 40 (got {u.get('tipsEarned')})")
check(u.get("tipsWithdrawn")==0, f"tipsWithdrawn == 0 (got {u.get('tipsWithdrawn')})")
check(u.get("tipsAvailable")==40, f"tipsAvailable == 40 (got {u.get('tipsAvailable')})")

print("\n=== 8. After A withdraws 15, available drops to 25 ===")
s,b = req(staffA, "/api/staff/tips/withdraw", "POST", body={"amount":15}, bearer=tokenA)
check(s==200, f"staff A withdraws 15 (status {s})")
check(b.get("summary",{}).get("available")==25, f"available now == 25 (got {b.get('summary',{}).get('available')})")
s,b = req(staffA, "/api/staff/account", bearer=tokenA)
check(b.get("user",{}).get("tipsAvailable")==25, f"account tipsAvailable == 25 (got {b.get('user',{}).get('tipsAvailable')})")

print("\n=== 9. Legacy table (no servedByStaffId) can be freed by any staff ===")
# Manually clear servedByStaffId on a table session, then any staff can free.
cust3 = make_jar()
s,b = req(cust3, "/api/customer/register", "POST", {"tableNumber":3,"name":"Legacy Cust","mobile":"7333300703"})
sid3 = b.get("session",{}).get("sessionId")
s,b = req(cust3, "/api/orders", "POST", {"tableNumber":3,"sessionId":sid3,"items":[{"menuItem":mi["_id"],"quantity":1}]})
oid3 = b.get("order",{}).get("_id")
req(chef, f"/api/orders/{oid3}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)
req(chef, f"/api/orders/{oid3}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
req(staffA, "/api/orders?role=staff&limit=50", bearer=tokenA)
req(staffA, f"/api/orders/{oid3}", "PATCH", body={"action":"serve"}, bearer=tokenA)
# Strip servedByStaffId to simulate a legacy table.
node_strip = subprocess.run(["npx","tsx","scripts/strip_served_by_staff.ts","3"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
check("stripped" in node_strip.stdout, f"stripped servedByStaffId from table 3 (out: {node_strip.stdout.strip()})")
# Now staff B (who did NOT serve) should be able to free this legacy table.
s,b = req(admin, "/api/tables")
tbl3 = next(t for t in b["tables"] if t["number"]==3)
# Confirm the strip actually happened (servedByStaffId absent/null).
check(not tbl3.get("currentSession",{}).get("servedByStaffId"),
      f"table 3 servedByStaffId now null/absent (got {tbl3.get('currentSession',{}).get('servedByStaffId')})")
s,b = req(staffB, f"/api/tables/{tbl3['_id']}/free", "POST", body={}, bearer=tokenB)
check(s==200, f"staff B frees legacy table 3 (no servedByStaffId) (status {s})")

print("\n=== 10. Frontend wiring ===")
checks = [
    ("src/models/Table.ts", "servedByStaffId", "Table model has servedByStaffId"),
    ("src/app/api/orders/[id]/route.ts", "servedByStaffId", "serve action sets servedByStaffId on table"),
    ("src/app/api/tables/[id]/free/route.ts", "did not serve", "free route has ownership gate"),
    ("src/app/api/tables/[id]/free/route.ts", "servedByStaffId", "free route checks servedByStaffId"),
    ("src/components/staff/StaffPortalClient.tsx", "servedByStaffId", "portal filters tables by servedByStaffId"),
    ("src/components/staff/StaffPortalClient.tsx", "tipsAvailable", "portal uses tipsAvailable for badge"),
    ("src/components/staff/StaffPortalClient.tsx", "canFree", "TableCard has canFree prop"),
    ("src/components/staff/StaffPortalClient.tsx", "Served by another staff", "read-only message for non-owned tables"),
]
base = "/home/z/my-project/download/restaurant-app/"
for path, needle, label in checks:
    r = subprocess.run(["grep","-ql",needle,base+path], capture_output=True, text=True)
    check(r.returncode==0, label)

print("\n=== Cleanup ===")
for email in (STAFF_A, STAFF_B):
    s,b = req(admin, "/api/users")
    u = next((x for x in b["users"] if x["email"]==email), None)
    if u: req(admin, f"/api/users/{u['_id']}", "DELETE")
subprocess.run(["node","scripts/full_clean.js"], cwd="/home/z/my-project/download/restaurant-app",
  capture_output=True, text=True)

print(f"\n{'='*60}")
print(f"FREE-TABLE GATE + TIPS-AVAILABLE TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
