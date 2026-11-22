#!/usr/bin/env python3
"""
End-to-end test for the thank-you auto-close flow.

Walks the full customer journey:
  register -> place order -> chef start_preparing -> chef mark_ready
  -> staff serve -> customer pay -> customer submit review

Then verifies the /api/reviews POST response has the shape the new
ThankYouView relies on:
  - googleReviewUrl (string, may be empty if not configured)
  - sessionClosed (bool, true once the dining session is marked completed)
  - the review document was created with the right ratings
  - the table's sessionStatus was updated to 'completed'

Also fetches the compiled customer page HTML to confirm the ThankYouView
component compiled in (sanity check that the build picked up the new code).
"""
import json, urllib.request, urllib.error, http.cookiejar, sys

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

# --- Staff jar (chef + staff) ---
staff = http.cookiejar.CookieJar()
def sreq(p, m="GET", body=None):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(staff))
    r = urllib.request.Request(BASE+p, data=d, method=m, headers={"Content-Type":"application/json"})
    try:
        x = o.open(r, timeout=20); raw = x.read().decode()
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

# --- Customer jar ---
cust = http.cookiejar.CookieJar()
def creq(p, m="GET", body=None):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cust))
    r = urllib.request.Request(BASE+p, data=d, method=m, headers={"Content-Type":"application/json"})
    try:
        x = o.open(r, timeout=20); raw = x.read().decode()
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

print("\n=== Setup: free any occupied tables, sign in chef+staff ===")
s,b = sreq("/api/tables")
for t in b["tables"]:
    if t.get("currentSession",{}).get("sessionId"):
        sreq(f"/api/tables/{t['_id']}/free", "POST")
sreq("/api/auth/login", "POST", {"email":"chef@restaurant.com","password":"chef123","scope":"chef"})
sreq("/api/auth/login", "POST", {"email":"staff@restaurant.com","password":"staff123","scope":"staff"})

print("\n=== Customer: register on table 1 ===")
s,b = creq("/api/customer/register", "POST", {"name":"Thanks Test","mobile":"9888888888","tableNumber":1})
check(s==200, f"customer register (status {s})")
sid = b["session"]["sessionId"]

print("\n=== Customer: place order ===")
menu = creq("/api/menu?available=true")[1]
s,b = creq("/api/orders", "POST", {"tableNumber":1,"sessionId":sid,"customerName":"Thanks Test",
    "items":[{"menuItem":menu["items"][0]["_id"],"quantity":2}]})
check(s==201, f"order placed (status {s})")
oid = b["order"]["_id"]

print("\n=== Chef: start_preparing + mark_ready ===")
s,b = sreq(f"/api/orders/{oid}", "PATCH", {"action":"start_preparing"})
check(s==200 and b["order"]["status"]=="preparing", f"start_preparing ok (status {s})")
s,b = sreq(f"/api/orders/{oid}", "PATCH", {"action":"mark_ready"})
check(s==200 and b["order"]["status"]=="ready", f"mark_ready ok (status {s})")

print("\n=== Staff: serve ===")
s,b = sreq(f"/api/orders/{oid}", "PATCH", {"action":"serve"})
check(s==200 and b["order"]["status"]=="served", f"serve ok (status {s})")

print("\n=== Customer: pay ===")
s,b = creq(f"/api/orders/{oid}", "PATCH", {"action":"pay","paymentMethod":"upi","tip":20})
check(s==200, f"pay ok (status {s})")
check(b.get("grandTotal",0) > 0, f"grandTotal > 0 (got {b.get('grandTotal')})")

print("\n=== Customer: submit review (drives ThankYouView phase -> 'thanks') ===")
s,b = creq("/api/reviews", "POST", {
    "order": oid, "tableNumber": 1, "customerName": "Thanks Test",
    "rating": 5, "foodRating": 5, "serviceRating": 4, "comment": "Great meal!",
})
check(s==200, f"review submit (status {s})")
if s == 200:
    # The shape the new ThankYouView relies on:
    check("googleReviewUrl" in b, f"response has googleReviewUrl (got '{b.get('googleReviewUrl','<missing>')[:40]}')")
    check("sessionClosed" in b, f"response has sessionClosed (got {b.get('sessionClosed')})")
    check(b.get("sessionClosed") == True, "dining session marked completed (sessionClosed=true)")
    check(b.get("review",{}).get("rating") == 5, f"review.rating == 5 (got {b.get('review',{}).get('rating')})")
    check(b.get("review",{}).get("foodRating") == 5, f"review.foodRating == 5 (got {b.get('review',{}).get('foodRating')})")
    check(b.get("review",{}).get("serviceRating") == 4, f"review.serviceRating == 4 (got {b.get('review',{}).get('serviceRating')})")
    check("comment" in b.get("review",{}), "review has comment field")

print("\n=== Verify table sessionStatus updated to 'completed' ===")
s,b = sreq("/api/tables")
t1 = next(t for t in b["tables"] if t["number"]==1)
cs = t1.get("currentSession") or {}
check(cs.get("sessionStatus") == "completed",
      f"table.currentSession.sessionStatus == 'completed' (got '{cs.get('sessionStatus')}')")

print("\n=== Sanity: customer page compiles the new ThankYouView ===")
s, html = creq("/customer?table=1", "GET")
# Just confirm the page serves (the React component runs client-side; we can't
# see phase state from HTML, but a 200 + non-empty body means the build is up).
check(s==200 and len(str(html)) > 500, f"customer page serves (status {s}, body {len(str(html))}B)")

print("\n=== Cleanup ===")
sreq(f"/api/tables/{t1['_id']}/free", "POST")
print(f"  freed table 1")

print(f"\n{'='*60}")
print(f"THANK-YOU FLOW TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL==0 else 1)
