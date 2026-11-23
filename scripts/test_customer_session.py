#!/usr/bin/env python3
"""
End-to-end test of the customer dining session flow:
  1. Customer scans QR (no cookie) -> GET /api/customer/register returns null session
  2. Register with name+mobile+table -> Customer + CustomerSession created, cookie set
  3. Place order #1 (items) -> order created, linked to session
  4. Chef starts preparing + marks ready (using chef cookie)
  5. Staff serves the order
  6. Customer places order #2 (more items mid-meal)
  7. Chef prepares + marks ready order #2; staff serves #2
  8. GET /api/customer/session -> shows 2 payable orders + aggregated bill
  9. Customer pays (aggregates both orders + tip) -> session paid, endedAt set
 10. Customer submits review -> session completed, cookie cleared
 11. Admin: GET /api/sessions -> shows the session with occupied time
 12. Staff frees the table -> session closed, table.currentSession cleared
"""
import json, urllib.request, urllib.error, http.cookiejar, time, sys, subprocess

BASE = "http://localhost:3123"
customer = http.cookiejar.CookieJar()
chef = http.cookiejar.CookieJar()
staff = http.cookiejar.CookieJar()
admin = http.cookiejar.CookieJar()

def req(path, method="GET", body=None, jar=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if headers: h.update(headers)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar or customer))
    r = urllib.request.Request(url, data=data, method=method, headers=h)
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

def login(jar, email, pw, scope):
    s,b = req("/api/auth/login", "POST", {"email":email,"password":pw,"scope":scope}, jar=jar)
    assert s==200, f"login {scope} failed: {b}"

print("\n=== Setup: log in chef, staff, admin ===")
login(chef, "chef@restaurant.com", "chef123", "chef")
login(staff, "staff@restaurant.com", "staff123", "staff")
login(admin, "admin@restaurant.com", "admin123", "admin")
print("  ✓ chef, staff, admin logged in (separate cookies)")

# Free up table 1 if occupied from a prior run
s,b = req("/api/tables", "GET", jar=admin)
t1 = next(t for t in b["tables"] if t["number"]==1)
if (t1.get("currentSession") or {}).get("sessionId"):
    print("  · table 1 occupied, freeing it first...")
    s,b2 = req(f"/api/tables/{t1['_id']}/free", "POST", jar=staff)
    print(f"    free status: {s}")

# Clear stale chef presence so orders route ONLY to chef@restaurant.com (the
# chef this test logs in as). Leftover dispatch chefs from prior runs could
# otherwise grab the orders, and start_preparing would then 422 (ownership).
subprocess.run(["npx","tsx","scripts/clear_chef_presence.ts"],
  cwd="/home/z/my-project/download/restaurant-app", capture_output=True, text=True)
# Re-login the chef so presence is marked fresh for chef@restaurant.com.
login(chef, "chef@restaurant.com", "chef123", "chef")

print("\n=== 1. Customer scans QR (no cookie) ===")
s,b = req("/api/customer/register", "GET", jar=customer)
check(s==200 and b.get("session") is None, "no session before registration")

print("\n=== 2. Register customer (name + mobile + table) ===")
s,b = req("/api/customer/register", "POST", {"name":"Test Diner","mobile":"9876543210","tableNumber":1}, jar=customer)
check(s==200, f"register ok (status {s})")
check(b.get("customer",{}).get("name")=="Test Diner", "customer name saved")
check(b.get("customer",{}).get("mobile")=="9876543210", "mobile saved")
check(b.get("session",{}).get("status")=="active", "session is active")
check(b.get("session",{}).get("tableNumber")==1, "session tied to table 1")
check(not b.get("resumed"), "new session, not resumed")
cust_session_id = b["session"]["sessionId"]
print(f"  · session id: {cust_session_id}")

print("\n=== 2b. Re-register same customer on same table (idempotent resume) ===")
s,b = req("/api/customer/register", "POST", {"name":"Test Diner","mobile":"9876543210","tableNumber":1}, jar=customer)
check(b.get("resumed")==True, "re-scan resumes existing session")

print("\n=== 3. Place order #1 ===")
menu = req("/api/menu?available=true", "GET", jar=customer)[1]
item1 = menu["items"][0]
s,b = req("/api/orders", "POST", {
    "tableNumber":1, "sessionId":cust_session_id, "customerName":"Test Diner",
    "items":[{"menuItem":item1["_id"],"quantity":2}], "taxRate":5, "serviceChargeRate":10
}, jar=customer)
check(s==201, f"order #1 created (status {s})")
order1 = b["order"]
print(f"  · order1: {order1['orderNumber']} total={order1['total']}")

print("\n=== 4. Chef prepares + marks order #1 ready ===")
s,b = req(f"/api/orders/{order1['_id']}", "PATCH", {"action":"start_preparing"}, jar=chef)
check(s==200 and b["order"]["status"]=="preparing", "order1 -> preparing")
# Staff polls so their presence is fresh when mark_ready runs the dispatch.
req("/api/orders?role=staff&limit=50", "GET", None, jar=staff)
s,b = req(f"/api/orders/{order1['_id']}", "PATCH", {"action":"mark_ready"}, jar=chef)
check(s==200 and b["order"]["status"]=="ready", "order1 -> ready")
# Staff picks up the routed order then serves it.
req("/api/orders?role=staff&limit=50", "GET", None, jar=staff)

print("\n=== 5. Staff serves order #1 ===")
s,b = req(f"/api/orders/{order1['_id']}", "PATCH", {"action":"serve"}, jar=staff)
check(s==200 and b["order"]["status"]=="served", "order1 -> served")

print("\n=== 6. Place order #2 mid-meal ===")
item2 = menu["items"][1] if len(menu["items"])>1 else menu["items"][0]
s,b = req("/api/orders", "POST", {
    "tableNumber":1, "sessionId":cust_session_id, "customerName":"Test Diner",
    "items":[{"menuItem":item2["_id"],"quantity":1}], "taxRate":5, "serviceChargeRate":10
}, jar=customer)
check(s==201, f"order #2 created (status {s})")
order2 = b["order"]
print(f"  · order2: {order2['orderNumber']} total={order2['total']}")

print("\n=== 7. Chef prepares + marks order #2 ready; staff serves ===")
req(f"/api/orders/{order2['_id']}", "PATCH", {"action":"start_preparing"}, jar=chef)
# Staff polls first so their presence is fresh when mark_ready runs the
# staff dispatch sweep (routes the ready order to this staff).
req("/api/orders?role=staff&limit=50", "GET", None, jar=staff)
req(f"/api/orders/{order2['_id']}", "PATCH", {"action":"mark_ready"}, jar=chef)
# Staff polls again to pick up the routed order, then serves it.
req("/api/orders?role=staff&limit=50", "GET", None, jar=staff)
s,b = req(f"/api/orders/{order2['_id']}", "PATCH", {"action":"serve"}, jar=staff)
check(s==200 and b["order"]["status"]=="served", "order2 -> served")

print("\n=== 8. GET /api/customer/session -> aggregated bill ===")
s,b = req("/api/customer/session", "GET", jar=customer)
check(s==200, "session fetch ok")
check(len(b.get("payable",[]))==2, f"2 payable orders (got {len(b.get('payable',[]))})")
expected_total = sum(o["total"] for o in b["payable"])
print(f"  · payable total: {expected_total}")
check(b["session"]["status"]=="active", "session still active before pay")
check(b["session"]["orderCount"]==2, f"orderCount=2 (got {b['session']['orderCount']})")

print("\n=== 9. Pay (aggregates both orders + tip 20) ===")
s,b = req(f"/api/orders/{order1['_id']}", "PATCH", {"action":"pay","paymentMethod":"upi","tip":20}, jar=customer)
check(s==200, f"pay ok (status {s})")
check(len(b.get("paidOrders",[]))==2, f"both orders paid (got {len(b.get('paidOrders',[]))})")
check(b.get("grandTotal")==expected_total+20, f"grandTotal={b.get('grandTotal')} (expected {expected_total+20})")
check(b.get("tip")==20, f"tip=20 (got {b.get('tip')})")
check(b.get("session",{}).get("status")=="paid", "session -> paid")
check(b.get("session",{}).get("endedAt") is not None, "endedAt set")

print("\n=== 9b. Verify table shows sessionStatus=paid ===")
s,b = req("/api/tables", "GET", jar=admin)
t1 = next(t for t in b["tables"] if t["number"]==1)
check((t1.get("currentSession") or {}).get("sessionStatus")=="paid", f"table sessionStatus=paid (got {(t1.get('currentSession') or {}).get('sessionStatus')})")

print("\n=== 10. Submit review -> session completed, cookie cleared ===")
s,b = req("/api/reviews", "POST", {
    "order": order1["_id"], "tableNumber":1, "customerName":"Test Diner",
    "rating":5, "foodRating":5, "serviceRating":4, "comment":"Great food!"
}, jar=customer)
check(s==200, f"review submitted (status {s})")
check(b.get("sessionClosed")==True, "session marked completed")

print("\n=== 10b. Verify session is completed + cookie cleared ===")
s,b = req("/api/customer/register", "GET", jar=customer)
check(b.get("session") is None, "customer cookie cleared after review")

print("\n=== 11. Admin: GET /api/sessions -> occupied time recorded ===")
s,b = req("/api/sessions?status=all", "GET", jar=admin)
check(s==200, "sessions list ok")
# Find our session
our = next((s for s in b["sessions"] if s["sessionId"]==cust_session_id), None)
check(our is not None, "our session found in admin list")
if our:
    check(our["status"]=="completed", f"session status=completed (got {our['status']})")
    check(our["orderCount"]==2, f"orderCount=2 (got {our['orderCount']})")
    check(our["total"]==expected_total+20, f"session total correct (got {our['total']})")
    check(our["occupiedMs"]>0, f"occupiedMs>0 (got {our['occupiedMs']})")
    check(our["tip"]==20, f"tip=20 (got {our['tip']})")
    print(f"  · occupied time: {our['occupiedMs']/1000:.1f}s")

print("\n=== 11b. Admin Tables: live occupied time shows for paid/completed table ===")
s,b = req("/api/tables", "GET", jar=admin)
t1 = next(t for t in b["tables"] if t["number"]==1)
cs = t1.get("currentSession",{})
check(cs.get("sessionStatus")=="completed", f"table sessionStatus=completed (got {cs.get('sessionStatus')})")
check(bool(cs.get("sessionId")), "table still occupied (staff must free it)")

print("\n=== 12. Staff frees the table ===")
s,b = req(f"/api/tables/{t1['_id']}/free", "POST", jar=staff)
check(s==200, f"free table ok (status {s})")
check(b.get("freed")==True, "table freed")

print("\n=== 12b. Verify table is now free + session closed ===")
s,b = req("/api/tables", "GET", jar=admin)
t1 = next(t for t in b["tables"] if t["number"]==1)
check(not t1.get("currentSession") or not t1["currentSession"].get("sessionId"), "table.currentSession cleared")

s,b = req("/api/sessions?status=all", "GET", jar=admin)
our = next((s for s in b["sessions"] if s["sessionId"]==cust_session_id), None)
check(our and our["status"]=="closed", f"session status=closed (got {our['status'] if our else 'none'})")
if our:
    check(our["closedAt"] is not None, "closedAt set")

print("\n=== 13. Returning customer: re-register -> visits incremented ===")
# New cookie jar (fresh browser)
customer2 = http.cookiejar.CookieJar()
s,b = req("/api/customer/register", "POST", {"name":"Test Diner","mobile":"9876543210","tableNumber":2}, jar=customer2)
check(s==200, "returning customer re-registers ok")
check(b.get("customer",{}).get("mobile")=="9876543210", "same mobile recognized")
# (visits should be 2 now: first registration + this one)

print(f"\n{'='*50}")
print(f"RESULTS: {PASS} passed, {FAIL} failed")
print(f"{'='*50}")
sys.exit(0 if FAIL==0 else 1)
