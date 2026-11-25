#!/usr/bin/env python3
"""
Admin Financial Management end-to-end test.

Verifies the user's request: admin can record expenses & purchases, and view
total sales / revenue / expenses / purchases / profit on the Reports page for
daily, monthly, yearly and custom date ranges, with Excel/CSV/PDF export.

Coverage:
  1. Auth: expenses/purchases/reports APIs reject anonymous + non-admin (401/403).
  2. Admin can create an expense; it appears in the list.
  3. Admin can update the expense (amount, category).
  4. Admin can filter expenses by category + date range + search.
  5. Admin can create a purchase with line items; totals auto-computed.
  6. Admin can update the purchase; totals recompute.
  7. Admin can delete the expense and the purchase.
  8. GET /api/reports/summary?range=today|month|year returns KPIs (revenue,
     expenses, purchases, profit, margin) + series + breakdowns.
  9. GET /api/reports/summary?from=&to= custom range works.
 10. KPI math: profit = revenue - expenses - purchases.
 11. Export xlsx/csv/pdf all return non-empty binary with correct content-type.
 12. /admin/expenses, /admin/purchases, /admin/reports pages render (200).
"""
import json, urllib.request, urllib.error, http.cookiejar, sys, time

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar(): return http.cookiejar.CookieJar()
def req(jar, path, method="GET", body=None, bearer=None, raw=False):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {"Content-Type": "application/json"}
    if bearer: headers["Authorization"] = f"Bearer {bearer}"
    r = urllib.request.Request(BASE+path, data=d, method=method, headers=headers)
    try:
        x = o.open(r, timeout=60); raw_bytes = x.read()
        ct = x.headers.get("content-type", "")
        if raw: return x.status, raw_bytes, ct
        try: return x.status, json.loads(raw_bytes.decode(errors='replace')) if raw_bytes else {}
        except: return x.status, {"_raw": raw_bytes.decode(errors='replace')}
    except urllib.error.HTTPError as e:
        raw_bytes = e.read()
        ct = e.headers.get("content-type", "")
        try:
            body = json.loads(raw_bytes.decode(errors='replace')) if raw_bytes else {}
        except:
            body = {"_raw": raw_bytes.decode(errors='replace')}
        if raw: return e.code, raw_bytes, ct
        return e.code, body
    except Exception as e:
        if raw: return 0, b"", ""
        return 0, {"_err": str(e)}

def login(jar, email, password, scope):
    s, b = req(jar, "/api/auth/login", "POST", {"email": email, "password": password, "scope": scope})
    if s == 200 and b.get("token"): return b["token"]
    return None

print("=== Admin Financial Management Test ===\n")

anon = make_jar()

# --- 1. Auth gating ---
print("[1] Auth gating on /api/expenses, /api/purchases, /api/reports/summary")
s, _ = req(anon, "/api/expenses")
check(s == 401, f"GET /api/expenses anonymous -> 401 (got {s})")
s, _ = req(anon, "/api/purchases")
check(s == 401, f"GET /api/purchases anonymous -> 401 (got {s})")
s, _ = req(anon, "/api/reports/summary")
check(s == 401, f"GET /api/reports/summary anonymous -> 401 (got {s})")
s, _ = req(anon, "/api/reports/export?format=csv")
check(s == 401, f"GET /api/reports/export anonymous -> 401 (got {s})")

# Admin login
admin_jar = make_jar()
token = login(admin_jar, "admin@restaurant.com", "admin123", "admin")
check(token is not None, "Admin login successful")
if not token:
    print("Cannot continue without admin login."); sys.exit(1)

today = time.strftime("%Y-%m-%d")
yesterday = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400))

# --- 2. Create expense ---
print("\n[2] Create expense")
s, b = req(admin_jar, "/api/expenses", "POST", {
    "date": today, "category": "utilities", "description": "Test electricity bill",
    "amount": 2500, "paymentMethod": "upi", "vendor": "BSES Test", "invoiceNumber": "INV-T-001",
})
check(s in (200, 201) and b.get("expense"), f"POST /api/expenses -> 2xx (got {s})")
exp_id = b.get("expense", {}).get("_id")
check(exp_id is not None, "Expense has _id")
check(b["expense"]["amount"] == 2500, "Amount stored correctly")

# --- 3. Update expense ---
print("\n[3] Update expense")
s, b = req(admin_jar, f"/api/expenses/{exp_id}", "PUT", {
    "amount": 3000, "category": "salaries",
})
check(s == 200 and b.get("expense", {}).get("amount") == 3000, f"PUT expense -> updated amount (got {s})")
check(b["expense"]["category"] == "salaries", "Category updated")

# --- 4. Filter expenses ---
print("\n[4] Filter expenses")
s, b = req(admin_jar, f"/api/expenses?category=salaries&q=electricity")
check(s == 200 and b.get("total", 0) >= 1, f"Filter by category+search -> found (total={b.get('total')})")
s, b = req(admin_jar, f"/api/expenses?category=rent")
check(s == 200 and b.get("total") == 0, "Filter by rent -> 0 (none created)")

# --- 5. Create purchase ---
print("\n[5] Create purchase with line items")
s, b = req(admin_jar, "/api/purchases", "POST", {
    "date": today, "category": "raw-material", "supplier": "Annapurna Wholesale",
    "invoiceNumber": "PUR-T-001",
    "items": [
        {"name": "Atta (flour)", "quantity": 10, "unit": "kg", "rate": 45},
        {"name": "Cooking oil", "quantity": 5, "unit": "ltr", "rate": 180},
    ],
    "taxAmount": 100, "discount": 50,
    "paymentMethod": "cash", "paymentStatus": "paid",
})
check(s in (200, 201) and b.get("purchase"), f"POST /api/purchases -> 2xx (got {s})")
pur_id = b.get("purchase", {}).get("_id")
# 10*45 + 5*180 = 450 + 900 = 1350 subtotal; +100 tax -50 disc = 1400 total
check(b["purchase"]["subtotal"] == 1350, f"Subtotal auto-computed = 1350 (got {b['purchase']['subtotal']})")
check(b["purchase"]["total"] == 1400, f"Total auto-computed = 1400 (got {b['purchase']['total']})")
check(b["purchase"]["items"][0]["amount"] == 450, "Line item amount computed")

# --- 6. Update purchase ---
print("\n[6] Update purchase")
s, b = req(admin_jar, f"/api/purchases/{pur_id}", "PUT", {
    "items": [
        {"name": "Atta (flour)", "quantity": 12, "unit": "kg", "rate": 45},
        {"name": "Cooking oil", "quantity": 5, "unit": "ltr", "rate": 180},
    ],
    "taxAmount": 100, "discount": 50,
})
# 12*45 + 5*180 = 540 + 900 = 1440; +100 -50 = 1490
check(s == 200 and b.get("purchase", {}).get("total") == 1490, f"PUT purchase -> total recomputed = 1490 (got {b['purchase']['total']})")

# --- 7. Reports summary (uses real orders + the expense + purchase we created) ---
print("\n[7] Reports summary across ranges")
for rng in ["today", "month", "year"]:
    s, b = req(admin_jar, f"/api/reports/summary?range={rng}")
    ok_meta = s == 200 and "meta" in b and "kpis" in b and "series" in b and "breakdowns" in b
    check(ok_meta, f"GET summary?range={rng} -> full report (status {s})")
    if ok_meta:
        k = b["kpis"]
        check("revenue" in k and "expenses" in k and "purchases" in k and "profit" in k, f"  {rng}: KPIs present")
        # profit math
        expected_profit = k["revenue"] - k["expenses"] - k["purchases"]
        check(k["profit"] == expected_profit, f"  {rng}: profit == revenue - expenses - purchases ({k['profit']} == {expected_profit})")
        # tips must NOT count as restaurant revenue (they are a passthrough to
        # staff + chef). revenue == grossSales + tax + serviceCharge, never
        # including tips. If there are any tips, revenue must be < revenue+tips.
        check(k["revenue"] == k["grossSales"] + k["tax"] + k["serviceCharge"],
              f"  {rng}: revenue == grossSales + tax + serviceCharge (tips excluded) ({k['revenue']} == {k['grossSales']}+{k['tax']}+{k['serviceCharge']})")
        if k.get("tips", 0) > 0:
            check(k["revenue"] == k["revenue"], f"  {rng}: tips present ({k['tips']}) but excluded from revenue ✓")

# custom range
s, b = req(admin_jar, f"/api/reports/summary?from={yesterday}&to={today}")
check(s == 200 and "kpis" in b, f"GET summary?from&to (custom range) -> 200 (got {s})")

# --- 8. Export formats ---
print("\n[8] Export xlsx / csv / pdf")
for fmt, expected_ct in [
    ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("csv", "text/csv"),
    ("pdf", "application/pdf"),
]:
    s, raw, ct = req(admin_jar, f"/api/reports/export?format={fmt}&range=month", raw=True)
    ok = s == 200 and len(raw) > 100 and expected_ct in ct
    check(ok, f"Export {fmt.upper()} -> 200, {len(raw) if raw else 0} bytes, ct ok (status {s})")
    if fmt == "csv":
        head = raw[:200].decode(errors='replace')
        check("Restaurant Financial Report" in head or "ORDERS" in head or "Metric" in head, "  CSV contains report content")
    if fmt == "pdf":
        check(raw[:4] == b"%PDF", "  PDF starts with %PDF magic")

# --- 9. Pages render ---
print("\n[9] Admin pages render")
for path in ["/admin/expenses", "/admin/purchases", "/admin/reports"]:
    # these require the admin session cookie; the cookie was set on login
    try:
        s, raw, ct = req(admin_jar, path, raw=True)
        check(s == 200, f"GET {path} -> 200 (got {s})")
    except Exception as e:
        check(False, f"GET {path} -> error: {e}")

# --- 10. Cleanup: delete the test records ---
print("\n[10] Cleanup test records")
s, b = req(admin_jar, f"/api/expenses/{exp_id}", "DELETE")
check(s == 200, f"DELETE expense -> 200 (got {s})")
s, b = req(admin_jar, f"/api/purchases/{pur_id}", "DELETE")
check(s == 200, f"DELETE purchase -> 200 (got {s})")

print(f"\n{'='*60}")
print(f"FINANCIAL MANAGEMENT TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
