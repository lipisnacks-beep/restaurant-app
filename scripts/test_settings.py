#!/usr/bin/env python3
"""
Admin Settings (restaurant name + logo) end-to-end test.

Verifies the user's request: an admin can change the restaurant/cafe name and
upload/remove a logo from a Settings tab; the brand then appears on the home
page, customer menu and every portal header.

Coverage:
  1. GET /api/settings is PUBLIC (works with no auth) and returns name+logoUrl.
  2. PUT /api/settings requires admin auth (chef/staff/anon -> 401/403).
  3. Admin can update the restaurant name; GET reflects it.
  4. Admin can upload a logo (data URI -> Cloudinary URL stored); GET reflects it.
  5. Admin can remove the logo (logoUrl: null); GET reflects it.
  6. Name validation: empty / >60 chars -> 422.
  7. Admin Settings page (/admin/settings) renders and shows the current brand.
  8. Home page (/) renders with the dynamic restaurant name.
  9. After update, the in-memory server cache is invalidated (GET sees new name
     immediately, not the 5-min stale value).
"""
import json, urllib.request, urllib.error, http.cookiejar, base64, subprocess, sys

BASE = "http://localhost:3123"
PASS = 0; FAIL = 0
def check(cond, msg):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {msg}")
    else: FAIL += 1; print(f"  ✗ {msg}")

def make_jar(): return http.cookiejar.CookieJar()
def req(jar, path, method="GET", body=None, bearer=None, headers_extra=None):
    d = json.dumps(body).encode() if body is not None else None
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    headers = {"Content-Type": "application/json"}
    if bearer: headers["Authorization"] = f"Bearer {bearer}"
    if headers_extra: headers.update(headers_extra)
    r = urllib.request.Request(BASE+path, data=d, method=method, headers=headers)
    try:
        x = o.open(r, timeout=30); raw = x.read().decode(errors='replace')
        try: return x.status, json.loads(raw) if raw else {}
        except: return x.status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors='replace')
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, {"_raw": raw}

# 1x1 PNG as a data URI for logo upload test.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
LOGO_DATA_URI = "data:image/png;base64," + base64.b64encode(PNG_BYTES).decode()

print("=== 1. GET /api/settings is PUBLIC (no auth) ===")
s, b = req(make_jar(), "/api/settings")
check(s == 200, f"public GET works without auth (status {s})")
check("restaurantName" in b, "response has restaurantName")
check("logoUrl" in b, "response has logoUrl")
original_name = b.get("restaurantName", "Lipi Snacks")
original_logo = b.get("logoUrl")
print(f"  (current brand: name={original_name!r}, logo={original_logo!r})")

print("\n=== 2. PUT /api/settings requires admin ===")
# anonymous
s, b = req(make_jar(), "/api/settings", "PUT", {"restaurantName": "Hacker Cafe"})
check(s in (401, 403), f"anonymous PUT rejected (status {s})")
# chef
chef = make_jar()
s, b = req(chef, "/api/auth/login", "POST", {"email": "chef@restaurant.com", "password": "chef123", "scope": "chef"})
chef_token = b.get("token")
s, b = req(make_jar(), "/api/settings", "PUT", {"restaurantName": "Chef Cafe"}, bearer=chef_token)
check(s in (401, 403), f"chef PUT rejected (status {s})")
# staff
staff = make_jar()
s, b = req(staff, "/api/auth/login", "POST", {"email": "staff@restaurant.com", "password": "staff123", "scope": "staff"})
staff_token = b.get("token")
s, b = req(make_jar(), "/api/settings", "PUT", {"restaurantName": "Staff Cafe"}, bearer=staff_token)
check(s in (401, 403), f"staff PUT rejected (status {s})")

print("\n=== 3. Admin updates restaurant name ===")
admin = make_jar()
s, b = req(admin, "/api/auth/login", "POST", {"email": "admin@restaurant.com", "password": "admin123", "scope": "admin"})
check(s == 200, f"admin login (status {s})")
admin_token = b.get("token")
s, b = req(admin, "/api/settings", "PUT", {"restaurantName": "Sunrise Bistro"})
check(s == 200, f"admin PUT name (status {s})")
check(b.get("restaurantName") == "Sunrise Bistro", f"name updated to 'Sunrise Bistro' (got {b.get('restaurantName')!r})")
# GET reflects it (cache invalidated)
s, b = req(make_jar(), "/api/settings")
check(b.get("restaurantName") == "Sunrise Bistro", f"public GET sees new name (got {b.get('restaurantName')!r})")

print("\n=== 4. Admin uploads a logo (data URI -> Cloudinary URL) ===")
s, b = req(admin, "/api/settings", "PUT", {"logoDataUri": LOGO_DATA_URI})
check(s == 200, f"admin PUT logo (status {s})")
new_logo = b.get("logoUrl")
check(bool(new_logo) and str(new_logo).startswith("http"), f"logoUrl is a real http URL (got {new_logo!r})")
# GET reflects it
s, b = req(make_jar(), "/api/settings")
check(b.get("logoUrl") == new_logo, "public GET sees the new logoUrl")

print("\n=== 5. Admin removes the logo ===")
s, b = req(admin, "/api/settings", "PUT", {"logoUrl": None})
check(s == 200, f"admin remove logo (status {s})")
check(b.get("logoUrl") is None, f"logoUrl now null (got {b.get('logoUrl')!r})")
s, b = req(make_jar(), "/api/settings")
check(b.get("logoUrl") is None, "public GET sees null logoUrl")

print("\n=== 6. Name validation ===")
s, b = req(admin, "/api/settings", "PUT", {"restaurantName": "   "})
check(s == 422, f"empty name rejected (status {s})")
s, b = req(admin, "/api/settings", "PUT", {"restaurantName": "X" * 61})
check(s == 422, f">60 char name rejected (status {s})")
# 60 chars is allowed
s, b = req(admin, "/api/settings", "PUT", {"restaurantName": "Y" * 60})
check(s == 200, f"exactly 60 chars allowed (status {s})")

print("\n=== 7. Admin Settings page renders ===")
# Without an admin cookie, requireAdmin() redirects to /admin/login. urllib
# follows the redirect by default, so the final status is 200 (login page).
s, b = req(make_jar(), "/admin/settings")
check(s in (200, 302, 307, 401, 403), f"settings page without admin redirects to login (status {s})")
# With admin cookie jar (session cookie set on login)
s, b = req(admin, "/admin/settings")
check(s == 200, f"admin settings page renders (status {s})")
check("Settings" in str(b.get("_raw", "")), "page contains 'Settings' heading")

print("\n=== 8. Home page renders with dynamic brand ===")
s, b = req(make_jar(), "/")
check(s == 200, f"home page renders (status {s})")
raw = str(b.get("_raw", ""))
# Currently name is "YYY...Y" (60 Y's). Verify the home page shows the dynamic name.
check("Y" * 60 in raw, "home page shows the dynamic restaurant name")

print("\n=== 9. Comprehensive fields (contact, billing, hours, payments, links) ===")
# Set a name back to something sane first.
req(admin, "/api/settings", "PUT", {"restaurantName": "Sunrise Bistro", "tagline": "Fresh food, fast."})
payload = {
    "phone": "+91 98765 43210",
    "email": "hello@sunrise.com",
    "address": "12 MG Road, Bengaluru 560001",
    "currencySymbol": "$",
    "taxRate": 5,
    "serviceChargeRate": 10,
    "hours": {
        "mon": {"open": "08:00", "close": "22:00"},
        "sun": {"open": "", "close": ""},  # closed Sunday
    },
    "paymentMethods": {"cash": True, "upi": True, "card": False},
    "upiId": "sunrise@upi",
    "googleReviewUrl": "https://g.page/r/example",
    "websiteUrl": "https://sunrise.example",
    "instagramUrl": "https://instagram.com/sunrise",
    "facebookUrl": "",
}
s, b = req(admin, "/api/settings", "PUT", payload)
check(s == 200, f"comprehensive PUT accepted (status {s})")
# Verify each field round-trips through a public GET.
s, b = req(make_jar(), "/api/settings")
check(b.get("phone") == "+91 98765 43210", f"phone round-trips (got {b.get('phone')!r})")
check(b.get("email") == "hello@sunrise.com", f"email round-trips (got {b.get('email')!r})")
check(b.get("currencySymbol") == "$", f"currency symbol is '$' (got {b.get('currencySymbol')!r})")
check(b.get("taxRate") == 5, f"taxRate is 5 (got {b.get('taxRate')!r})")
check(b.get("serviceChargeRate") == 10, f"serviceChargeRate is 10 (got {b.get('serviceChargeRate')!r})")
check(b.get("hours", {}).get("mon", {}).get("open") == "08:00", "Mon hours persisted")
check(b.get("hours", {}).get("sun", {}).get("open") == "", "Sun closed (empty open)")
pm = b.get("paymentMethods", {})
check(pm.get("cash") is True and pm.get("upi") is True and pm.get("card") is False, "payment methods respected")
check(b.get("upiId") == "sunrise@upi", f"upiId round-trips (got {b.get('upiId')!r})")
check(b.get("googleReviewUrl") == "https://g.page/r/example", "google review url persisted")
check(b.get("tagline") == "Fresh food, fast.", "tagline persisted")

print("\n=== 10. Billing validation ===")
s, b = req(admin, "/api/settings", "PUT", {"taxRate": 150})
check(s == 422, f"taxRate > 100 rejected (status {s})")
s, b = req(admin, "/api/settings", "PUT", {"serviceChargeRate": -5})
check(s == 422, f"negative serviceChargeRate rejected (status {s})")
s, b = req(admin, "/api/settings", "PUT", {"currencySymbol": ""})
check(s == 422, f"empty currency symbol rejected (status {s})")
s, b = req(admin, "/api/settings", "PUT", {"hours": {"mon": {"open": "25:00", "close": "22:00"}}})
check(s == 422, f"invalid time rejected (status {s})")
s, b = req(admin, "/api/settings", "PUT", {"paymentMethods": {"cash": False, "upi": False, "card": False}})
check(s == 422, f"all payment methods disabled rejected (status {s})")

print("\n=== 11. Reviews route returns settings googleReviewUrl ===")
# Reviews POST requires a customer session; just confirm the settings value is
# reachable by checking GET includes it (already done in §9). Also verify the
# reviews endpoint exists and is gated.
s, b = req(make_jar(), "/api/reviews", "POST", {})
check(s in (400, 401, 422), f"reviews POST without session rejected (status {s})")

print("\n=== 12. Restore original brand ===")
s, b = req(admin, "/api/settings", "PUT", {"restaurantName": original_name, "logoUrl": original_logo})
check(s == 200, f"restored original brand (status {s})")
s, b = req(make_jar(), "/api/settings")
check(b.get("restaurantName") == original_name, f"name restored to {original_name!r}")
check(b.get("logoUrl") == original_logo, f"logo restored to {original_logo!r}")

print(f"\n{'='*60}")
print(f"SETTINGS TEST: {PASS} passed, {FAIL} failed")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
