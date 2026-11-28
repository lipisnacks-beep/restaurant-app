# Vercel Deployment Guide — Step by Step

Your code is now on GitHub:
**https://github.com/lipisnacks-beep/restaurant-app**

Follow these steps to deploy to Vercel (all free, ~5 minutes).

---

## Step 1 — Import the project into Vercel

1. Go to **https://vercel.com/new**
2. Sign in with GitHub (use the `lipisnacks-beep` account).
3. Under "Import Git Repository", find **`lipisnacks-beep/restaurant-app`** and click **Import**.
   - If you don't see it, click "Adjust GitHub App Permissions" and grant access to that repository.
4. Vercel auto-detects **Next.js** — leave all build settings as default.

---

## Step 2 — Add Environment Variables (CRITICAL)

Before clicking Deploy, scroll down to **"Environment Variables"** and add each of these:

| Name | Value | Environments |
|---|---|---|
| `MONGODB_URI` | `mongodb+srv://YOUR_ATLAS_USER:YOUR_ATLAS_PASSWORD@cluster0.YOUR_CLUSTER.mongodb.net/restaurant?retryWrites=true&w=majority` | Production, Preview, Development |
| `CLOUDINARY_CLOUD_NAME` | `jj7yxhr5` | Production, Preview, Development |
| `CLOUDINARY_API_KEY` | `YOUR_CLOUDINARY_API_KEY` | Production, Preview, Development |
| `CLOUDINARY_API_SECRET` | `YOUR_CLOUDINARY_API_SECRET` | Production, Preview, Development |
| `JWT_SECRET` | `YOUR_LONG_RANDOM_JWT_SECRET` | Production, Preview, Development |
| `NEXT_PUBLIC_BASE_URL` | (leave empty for now — set in Step 4) | Production |
| `GOOGLE_REVIEW_URL` | `https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID` | Production, Preview |

> Tip: Vercel lets you check "All Environments" so you only paste each value once.

---

## Step 3 — Click "Deploy"

Wait ~2 minutes. You'll get a URL like:
```
https://restaurant-app-<random>.vercel.app
```

---

## Step 4 — Set `NEXT_PUBLIC_BASE_URL` (so QR codes work)

1. Copy your new deployment URL (e.g. `https://restaurant-app-abc123.vercel.app`).
2. In Vercel: **your project → Settings → Environment Variables**.
3. Edit `NEXT_PUBLIC_BASE_URL` and paste your URL (no trailing slash).
4. Click **Save**.
5. Go to **Deployments → ⋯ menu → Redeploy** (don't change anything, just confirm).

---

## Step 5 — Seed the production database

This creates the admin/chef/staff accounts, 8 tables and the **full 33-item restaurant menu** (8 categories, Indian pricing, real food photos hosted on Cloudinary) in MongoDB. Open this URL in your browser:

```
https://YOUR-DEPLOYMENT-URL.vercel.app/api/seed
```

You should see a JSON response like:
```json
{
  "users": [
    "admin@restaurant.com (created)",
    "chef@restaurant.com (created)",
    "staff@restaurant.com (created)"
  ],
  "tables": "Created 8 tables (Table 1 .. Table 8).",
  "menu": {
    "created": [ "...33 dish names..." ],
    "skipped": 0,
    "total": 33
  }
}
```

> If you see "(already exists)" messages, that's fine — it means a previous seed already ran.

### Menu categories seeded

| Category | Count | Price range |
|---|---|---|
| Starters | 6 items | ₹60 – ₹280 |
| Main | 6 items | ₹200 – ₹380 |
| Rice | 5 items | ₹110 – ₹320 |
| Breads | 3 items | ₹30 – ₹60 |
| South Indian | 3 items | ₹90 – ₹140 |
| Combos | 1 item | ₹280 |
| Beverages | 5 items | ₹40 – ₹110 |
| Desserts | 4 items | ₹90 – ₹130 |

### Refresh the menu later

If you add or change dishes in `src/lib/menuData.ts` and want to push those changes to the database without deleting everything, call the seed endpoint with the `?menu=1` flag:

```
https://YOUR-DEPLOYMENT-URL.vercel.app/api/seed?menu=1
```

This updates existing menu items (preserving their `_id`) and creates any new ones.

---

## Step 6 — Log in and verify

| Panel | URL | Email | Password |
|---|---|---|---|
| Admin | `https://YOUR-URL.vercel.app/admin/login` | admin@restaurant.com | admin123 |
| Chef | `https://YOUR-URL.vercel.app/chef/login` | chef@restaurant.com | chef123 |
| Staff | `https://YOUR-URL.vercel.app/staff/login` | staff@restaurant.com | staff123 |
| Customer | `https://YOUR-URL.vercel.app/customer?table=1` | — | — |

**Change all default passwords immediately** via Admin → Staff & Chef.

---

## Step 7 — (Optional) Set your Google review link

1. Find your restaurant's Google Place ID at https://developers.google.com/maps/documentation/places/web-service/place-id
2. Update `GOOGLE_REVIEW_URL` in Vercel → Settings → Environment Variables:
   ```
   https://search.google.com/local/writereview?placeid=ChIJ...your-id...
   ```
3. Redeploy.

---

## Troubleshooting

- **"MongoDB connection failed"** → Go to MongoDB Atlas → Network Access → Add `0.0.0.0/0` (allow from anywhere).
- **QR code points to localhost** → `NEXT_PUBLIC_BASE_URL` not set; redo Step 4.
- **Build fails** → check Vercel build logs; most common cause is a missing env var.
- **Customer can't find table** → make sure admin created that table number; QR encodes `?table=N`.
- **Customer sees "No items available right now"** → the menu has not been seeded yet. Run `/api/seed` (Step 5) once. If you previously seeded before the menu was added (Nov 22, 2026), run `/api/seed?menu=1` to refresh.

---

## ⚠️ Security: revoke the GitHub PAT

The GitHub PAT you shared in chat is now exposed. **Revoke it immediately**:
1. Go to https://github.com/settings/tokens
2. Find the token and click **Delete**.
3. Create a new one if needed (use fine-grained tokens with repo-only scope).

You do NOT need a PAT for normal use — Vercel pulls code directly from GitHub via its own integration.
