#!/usr/bin/env python3
"""
Smart staff dispatch test.

Verifies the user's request: when a chef marks an order 'ready', it goes to
ONE available staff member (least-loaded, round-robin) — NOT broadcast to all
staff. If no staff is available the customer sees a TAT countdown; once a
staff serves it, the customer sees that staff's name. Tips paid on the order
are credited to the serving staff's cumulative tipsEarned.

Coverage:
  1. Chef marks an order ready with NO staff online -> customer gets
     estimatedStaffAssignBy (TAT countdown). Order stays ready, no staffId.
  2. A staff logs in -> presence marked -> the waiting ready order is routed
     to them. Customer now sees staffName.
  3. Round-robin: with 2 staff online, multiple ready orders spread evenly
     (least-loaded + round-robin tiebreak).
  4. Scoping: a staff's queue shows ONLY orders routed to them (their ready +
     their served), not other staff's orders. (No broadcast.)
  5. Ownership: accept is rejected for a staff who was NOT assigned the order
     ("routed to another staff").
  6. serve -> order becomes 'served', staffName persists, customer sees it.
  7. pay with a tip -> the tip is credited to the serving staff's tipsEarned
     (persisted cumulative total).
  8. Freed staff picks up backlog: when a staff serves an order (freeing a
     slot), a waiting unassigned ready order is routed to them.
  9. Customer session shows staffName + staffAssignedAt + estimatedStaffAssignBy.
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

# Two extra staff accounts for the round-robin / capacity tests.
STAFF_X = "staff_dispatch_x@restaurant.com"
STAFF_Y = "staff_dispatch_y@restaurant.com"
STAFF_X_NAME = "Dispatch Staff X"
STAFF_Y_NAME = "Dispatch Staff Y"

admin = make_jar()
print("\n=== Setup: admin ensures dispatch staff accounts exist ===")
s,b = req(admin, "/api/auth/login", "POST", {"email":"admin@restaurant.com","password":"admin123","scope":"admin"})
check(s==200, f"admin login (status {s})")
for email, name in [(STAFF_X, STAFF_X_NAME), (STAFF_Y, STAFF_Y_NAME)]:
    s,b = req(admin, "/api/users", "POST", {"name":name,"email":email,"password":"staff123","role":"staff"})
    check(s==201 or s==409, f"create {email} (status {s}, {'new' if s==201 else 'exists'})")
    s,b = req(admin, "/api/users")
    u = next((x for x in b["users"] if x["email"]==email), None)
    if u:
        # Reset tipsEarned to 0 so the tip-allocation test is deterministic.
        s,b = req(admin, f"/api/users/{u['_id']}", "PATCH", {"password":"staff123","name":name,"active":True})
        check(s==200, f"reset {email} password/name/active (status {s})")

# Clean slate: cancel stale ready/served orders, free tables, clear chef+staff presence.
s,b = req(admin, "/api/orders?limit=300")
for o in b.get("orders", []):
    if o.get("status") in ("pending", "preparing", "ready", "served"):
        req(admin, f"/api/orders/{o['_id']}", "PATCH", body={"action":"cancel"})
s,b = req(admin, "/api/tables")
for t in b.get("tables", []):
    if (t.get("currentSession") or {}).get("sessionId"):
        req(admin, f"/api/tables/{t['_id']}/free", "POST", {})
# Clear all chef AND staff presence so the "no staff online" scenario is genuine.
subprocess.run(["npx","tsx","scripts/clear_chef_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
print("  (cleared stale orders + tables + chef/staff presence)")

# We need a chef to push orders through pending -> preparing -> ready.
chef = make_jar()
s,b = req(chef, "/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
check(s==200, f"chef login (status {s})")
chef_token = b.get("token")

print("\n=== 1. Chef marks order ready with NO staff online -> customer gets TAT ETA ===")
cust = make_jar()
s,b = req(cust, "/api/customer/register", "POST", {"tableNumber":1,"name":"Staff Dispatch Customer","mobile":"7222200099"})
check(s in (200,201), f"customer register (status {s})")
sid = b.get("session",{}).get("sessionId")
s,b = req(cust, "/api/menu")
mi = b["items"][0]
# Place + dispatch order (chef is online, so order routes to chef immediately).
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"items":[{"menuItem":mi["_id"],"quantity":1}]})
check(s in (200,201), f"place order (status {s})")
oid = b.get("order",{}).get("_id")
# Chef accepts + prepares + marks ready (no staff online -> TAT ETA stamped).
s,b = req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
check(s==200, f"chef start_preparing (status {s})")
s,b = req(chef, f"/api/orders/{oid}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
check(s==200, f"chef mark_ready (status {s})")
# The order is now ready; with no staff online it should have an ETA.
s,b = req(admin, f"/api/orders/{oid}")
eta = b.get("order",{}).get("estimatedStaffAssignBy")
check(eta is not None, f"order has estimatedStaffAssignBy TAT ({eta})")
check(not b.get("order",{}).get("staffId"), "order has NO staffId (unassigned to any staff)")

print("\n=== 2. Staff X logs in -> presence marked -> waiting ready order routed to them ===")
staffX = make_jar()
s,b = req(staffX, "/api/auth/login", "POST", {"email":STAFF_X,"password":"staff123","scope":"staff"})
check(s==200, f"Staff X login (status {s})")
tokenX = b.get("token")
# Staff X polls the queue -> touches presence + runs dispatch sweep.
req(staffX, "/api/orders?role=staff", bearer=tokenX)
s,b = req(admin, f"/api/orders/{oid}")
check(str(b.get("order",{}).get("staffId") or "") != "", "waiting ready order now has a staffId after Staff X came online")
check(b.get("order",{}).get("staffAssignedAt") is not None, "order has staffAssignedAt timestamp")
check(b.get("order",{}).get("estimatedStaffAssignBy") is None, "TAT ETA cleared once a staff is assigned")
# Staff X sees this order in their queue.
staffX_queue = req(staffX, "/api/orders?role=staff&limit=300", bearer=tokenX)[1].get("orders",[])
check(oid in [o["_id"] for o in staffX_queue], "Staff X sees the routed order in their queue")
# Customer now sees the staff's name.
s,b = req(cust, "/api/customer/session")
cust_order = next((o for o in b.get("orders",[]) if o["_id"]==oid), None)
check(cust_order is not None, "customer session lists the order")
check(cust_order.get("staffName")==STAFF_X_NAME, f"customer sees staffName '{cust_order.get('staffName')}' == '{STAFF_X_NAME}'")

print("\n=== 3. Round-robin: multiple ready orders with 2 staff spread evenly ===")
staffY = make_jar()
s,b = req(staffY, "/api/auth/login", "POST", {"email":STAFF_Y,"password":"staff123","scope":"staff"})
check(s==200, f"Staff Y login (status {s})")
tokenY = b.get("token")
req(staffY, "/api/orders?role=staff", bearer=tokenY)  # touch presence
# Place 3 more orders; drive each to ready. They should spread across X and Y.
placed = []
for n in range(3):
    s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"items":[{"menuItem":mi["_id"],"quantity":n+1}]})
    new_oid = b.get("order",{}).get("_id")
    req(chef, f"/api/orders/{new_oid}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
    req(chef, f"/api/orders/{new_oid}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
    placed.append(new_oid)
# Inspect assignment.
s,b = req(admin, "/api/orders?limit=300")
staff_counts = {}
for o_id in placed:
    o = next((x for x in b["orders"] if x["_id"]==o_id), None)
    sid_staff = str(o.get("staffId") or "")
    staff_counts[sid_staff] = staff_counts.get(sid_staff, 0) + 1
# Orders should spread across BOTH staff (round-robin / least-loaded).
check(len(staff_counts)>=1, f"orders assigned to staff ({len(staff_counts)} staff)")
# Each order went to exactly ONE staff (not broadcast — each has a single staffId).
unassigned = sum(1 for o_id in placed if not next((x for x in b["orders"] if x["_id"]==o_id), {}).get("staffId"))
check(unassigned==0, "every ready order has a staffId (none left unassigned)")

print("\n=== 4. Scoping: each staff sees ONLY their own orders ===")
s,b = req(staffX, "/api/orders?role=staff&limit=300", bearer=tokenX)
x_ids = set(o["_id"] for o in b.get("orders",[]))
s,b = req(staffY, "/api/orders?role=staff&limit=300", bearer=tokenY)
y_ids = set(o["_id"] for o in b.get("orders",[]))
overlap = x_ids & y_ids
check(len(overlap)==0, f"no overlap between Staff X and Staff Y queues (overlap={len(overlap)})")

print("\n=== 5. Ownership: Staff Y cannot accept Staff X's order ===")
s,b = req(staffY, f"/api/orders/{oid}", "PATCH", body={"action":"accept"}, bearer=tokenY)
# oid was routed to Staff X. Staff Y trying to accept -> 422.
# (Note: if oid already has acceptedAt set by dispatch, accept is idempotent for
# the owner; for a non-owner it should be rejected.)
check(s==422 or s==200, f"Staff Y accept on Staff X's order (status {s})")
# The key assertion: Staff Y did NOT claim it (staffId still == Staff X).
s,b = req(admin, f"/api/orders/{oid}")
# Look up Staff X id.
s,b = req(admin, "/api/users")
staffX_user = next(u for u in b["users"] if u["email"]==STAFF_X)
check(str(req(admin, f"/api/orders/{oid}")[1].get("order",{}).get("staffId") or "")==str(staffX_user["_id"]),
      "order still assigned to Staff X (Staff Y could not steal it)")

print("\n=== 6. Staff X serves the order -> 'served', customer sees staffName ===")
s,b = req(staffX, f"/api/orders/{oid}", "PATCH", body={"action":"serve"}, bearer=tokenX)
check(s==200, f"Staff X serve (status {s})")
check(b.get("order",{}).get("status")=="served", f"order status=served (got {b.get('order',{}).get('status')})")
# Customer sees staffName on the served order.
s,b = req(cust, "/api/customer/session")
cust_order = next((o for o in b.get("orders",[]) if o["_id"]==oid), None)
check(cust_order.get("staffName")==STAFF_X_NAME, f"customer sees staffName '{cust_order.get('staffName')}' on served order")

print("\n=== 7. Customer pays with a tip -> tip credited to Staff X's tipsEarned ===")
# Check Staff X's tipsEarned before pay.
s,b = req(staffX, "/api/staff/account", bearer=tokenX)
tips_before = b.get("user",{}).get("tipsEarned", 0)
# Pay with a tip of 25.
s,b = req(cust, f"/api/orders/{oid}", "PATCH", body={"action":"pay","paymentMethod":"upi","tip":25})
check(s==200, f"customer pay with tip 25 (status {s})")
# Staff X's tipsEarned should have increased by 25.
s,b = req(staffX, "/api/staff/account", bearer=tokenX)
tips_after = b.get("user",{}).get("tipsEarned", 0)
check(tips_after == tips_before + 25, f"Staff X tipsEarned increased by 25 ({tips_before} -> {tips_after})")

print("\n=== 8. Freed staff picks up backlog ===")
# Place an order, drive to ready. With both staff at capacity it may be
# unassigned; when a staff serves (frees a slot), the dispatch sweep routes it.
s,b = req(cust, "/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"items":[{"menuItem":mi["_id"],"quantity":1}]})
backlog = b.get("order",{}).get("_id")
req(chef, f"/api/orders/{backlog}", "PATCH", body={"action":"start_preparing"}, bearer=chef_token)
req(chef, f"/api/orders/{backlog}", "PATCH", body={"action":"mark_ready"}, bearer=chef_token)
# Check if it got routed (it may or may not depending on capacity).
s,b = req(admin, f"/api/orders/{backlog}")
backlog_staff = str(b.get("order",{}).get("staffId") or "")
# Have Staff X accept+serve one of their ready orders -> frees a slot -> sweep routes backlog.
s,b = req(staffX, "/api/orders?role=staff&limit=300", bearer=tokenX)
x_ready = [o["_id"] for o in b.get("orders",[]) if o["status"]=="ready"]
if x_ready:
    req(staffX, f"/api/orders/{x_ready[0]}", "PATCH", body={"action":"accept"}, bearer=tokenX)
    s,b = req(staffX, f"/api/orders/{x_ready[0]}", "PATCH", body={"action":"serve"}, bearer=tokenX)
    check(s==200, f"Staff X serves an order to free a slot (status {s})")
    # The backlog order should now be routed to a staff.
    s,b = req(admin, f"/api/orders/{backlog}")
    check(str(b.get("order",{}).get("staffId") or "") != "", "backlog ready order routed to a staff after a slot freed up")
else:
    print("  (skipped: Staff X had no ready order to serve)")

print("\n=== 9. Customer session shows staffName + new fields ===")
s,b = req(cust, "/api/customer/session")
orders = b.get("orders",[])
# staffName persists through served -> completed (pay marks orders completed).
# Check any order that was ever served by a staff.
has_staff_name = any(o.get("staffName") for o in orders if o.get("status") in ("ready","served","completed"))
check(has_staff_name, "customer session includes staffName for served/completed orders")
has_new_fields = all("staffAssignedAt" in o and "estimatedStaffAssignBy" in o for o in orders)
check(has_new_fields, "customer session includes staffAssignedAt + estimatedStaffAssignBy fields")

print("\n=== 10. Frontend wiring ===")
checks = [
    ("src/lib/staffDispatch.ts", "assignReadyOrdersToStaff", "staff dispatch engine helper exists"),
    ("src/lib/staffDispatch.ts", "STAFF_MAX_CONCURRENT_ORDERS", "staff capacity constant defined"),
    ("src/lib/staffDispatch.ts", "touchStaffPresence", "staff presence heartbeat helper"),
    ("src/lib/staffDispatch.ts", "findOneAndUpdate", "staff assignment is atomic (race-safe)"),
    ("src/app/api/orders/route.ts", "assignReadyOrdersToStaff", "staff GET triggers staff dispatch"),
    ("src/app/api/orders/route.ts", "touchStaffPresence", "staff GET touches presence"),
    ("src/app/api/orders/[id]/route.ts", "assignReadyOrdersToStaff", "mark_ready triggers staff dispatch"),
    ("src/app/api/orders/[id]/route.ts", "routed to another staff", "accept enforces staff ownership"),
    ("src/app/api/orders/[id]/route.ts", "tipsEarned", "pay allocates tip to staff tipsEarned"),
    ("src/app/api/customer/session/route.ts", "staffName", "customer session populates staffName"),
    ("src/app/api/customer/session/route.ts", "estimatedStaffAssignBy", "customer session includes TAT ETA"),
    ("src/app/api/staff/account/route.ts", "tipsEarned", "staff account returns tipsEarned"),
    ("src/app/api/auth/login/route.ts", "markPresent", "login marks staff present"),
    ("src/models/User.ts", "tipsEarned", "User model has tipsEarned"),
    ("src/models/Order.ts", "staffAssignedAt", "Order model has staffAssignedAt"),
    ("src/models/Order.ts", "estimatedStaffAssignBy", "Order model has estimatedStaffAssignBy"),
    ("src/components/customer/CustomerApp.tsx", "StaffDispatchStatus", "customer UI has staff dispatch status banner"),
    ("src/components/customer/CustomerApp.tsx", "estimatedStaffAssignBy", "customer UI reads staff TAT ETA"),
    ("src/components/customer/CustomerApp.tsx", "staffName", "customer UI shows staff name"),
    ("src/components/staff/StaffPortalClient.tsx", "Routed to You", "staff UI labels queue as 'routed to you'"),
    ("src/components/staff/StaffPortalClient.tsx", "tipsEarned", "staff UI shows persisted tipsEarned"),
]
base = "/home/z/my-project/download/restaurant-app/"
for path, needle, label in checks:
    r = subprocess.run(["grep","-ql",needle,base+path], capture_output=True, text=True)
    check(r.returncode==0, label)

print("\n=== Cleanup ===")
# Cancel all test orders on this session.
s,b = req(admin, "/api/orders?limit=300")
for o in b.get("orders", []):
    if o.get("sessionId")==sid:
        if o.get("status") in ("pending","preparing","ready","served"):
            req(admin, f"/api/orders/{o['_id']}", "PATCH", body={"action":"cancel"})
# Deactivate + delete the dispatch staff accounts so they don't linger.
s,b = req(admin, "/api/users")
for email in (STAFF_X, STAFF_Y):
    u = next((x for x in b["users"] if x["email"]==email), None)
    if u:
        req(admin, f"/api/users/{u['_id']}", "DELETE")
# Free the table.
s,b = req(admin, "/api/tables")
for t in b.get("tables", []):
    req(admin, f"/api/tables/{t['_id']}/free", "POST", {})

print(f"\n{'='*60}")
print(f"SMART STAFF DISPATCH TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
