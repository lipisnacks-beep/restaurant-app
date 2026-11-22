# Lipi Snacks — Restaurant / Cafe Management System

A complete full-stack restaurant & cafe management application built with **Next.js 14 (App Router)**, **MongoDB Atlas**, **Cloudinary**, and **Tailwind CSS**. It ships with four panels — Admin, Chef, Staff and Customer — and is designed to deploy free on **Vercel** using only free-tier tools.

## Features

### Admin panel (`/admin`)
- Live dashboard: today's orders, revenue, tips, active tables, average rating, top-selling items.
- **Tables & QR**: add / remove / enable-disable tables, generate a printable QR PNG for each table.
- **Menu management**: create / edit / delete dishes, upload images to Cloudinary, toggle availability, mark veg.
- **Orders**: filter today's orders by status, cancel pending orders.
- **Staff & Chef accounts**: create accounts for chefs, service staff and other admins; reset passwords; enable/disable.
- **Reviews**: see all customer reviews with food/service/ambiance breakdown and Google-post status.

### Chef panel (`/chef`)
- Live kitchen display of new (`pending`) and `preparing` orders, auto-refresh every 8 seconds.
- One-tap "Start cooking" and "Mark ready".
- Soft audio beep when a new order arrives.

### Staff panel (`/staff`)
- Delivery queue of `ready` orders and `served` (awaiting payment) orders.
- One-tap "Mark served" and "Complete & free table".
- Today's tips summary.

### Customer flow (`/customer?table=N`)
- Reaches the menu by scanning the QR on the table.
- Adds dishes to a cart with quantity controls.
- Places the order — it goes **straight to the chef**.
- Tracks order status (Received → Preparing → Ready → Served) live.
- Pays the bill with **Cash / UPI / Card**, optionally adds a tip.
- Leaves a rating (overall + food + service) and is redirected to **Google Reviews**.

## Tech stack (all free)

| Layer | Tool | Free tier |
|---|---|---|
| Frontend + API | Next.js 14 (App Router, TypeScript) | Vercel Hobby |
| Database | MongoDB Atlas | M0 free cluster |
| Image storage | Cloudinary | Free plan |
| Auth | JWT in an httpOnly cookie | — |
| Hosting | Vercel | Hobby (free) |

## Project structure

```
restaurant-app/
├── src/
│   ├── app/
│   │   ├── api/                  # Route handlers (auth, tables, menu, orders, reviews, upload, stats, users)
│   │   ├── admin/                # Admin login + dashboard + tables + menu + orders + staff + reviews
│   │   ├── chef/                 # Chef login + portal
│   │   ├── staff/                # Staff login + portal
│   │   ├── customer/             # Customer menu flow
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing page
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                   # LoginCard, PanelShell
│   │   ├── admin/                # Admin client components
│   │   ├── chef/                # Chef portal client
│   │   ├── staff/               # Staff portal client
│   │   └── customer/            # CustomerApp
│   ├── lib/                      # db, cloudinary, auth, utils, apiClient, cartStore, seed
│   └── models/                   # User, Table, MenuItem, Order, Review
├── public/
├── .env.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.js
└── README.md
```

## Local development

1. Install Node.js 18+ and npm.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in the values (the values provided by the client are already in `.env` — adjust if needed):
   ```env
   MONGODB_URI=mongodb+srv://.../restaurant?retryWrites=true&w=majority
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   JWT_SECRET=...long random string...
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   GOOGLE_REVIEW_URL=https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID
   ```
4. Run the seed script to create default accounts and 8 tables:
   ```bash
   npx tsx src/lib/seed.ts
   ```
   (If `tsx` is not installed, `npm i -g tsx` or use `npx tsx`.)
5. Start the dev server:
   ```bash
   npm run dev
   ```
6. Open http://localhost:3000.

### Default logins (created by the seed script)

| Panel | Email | Password |
|---|---|---|
| Admin | admin@restaurant.com | admin123 |
| Chef | chef@restaurant.com | chef123 |
| Staff | staff@restaurant.com | staff123 |

**Change these passwords immediately** in the Admin → Staff page after first login.

## Deployment to Vercel (free)

### 1. Push the code to GitHub
1. Create a new empty repository on GitHub (e.g. `lipisnacks-app`).
2. From the `restaurant-app/` directory:
   ```bash
   git init
   git add .
   git commit -m "Initial restaurant management app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/lipisnacks-app.git
   git push -u origin main
   ```

### 2. Import into Vercel
1. Go to https://vercel.com/new and sign in with GitHub.
2. Import the `lipisnacks-app` repository.
3. Vercel auto-detects Next.js — leave defaults (Framework: Next.js, Build: `next build`).
4. Open **Environment Variables** and add **every** key from `.env`:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | `mongodb+srv://lipisnacks_db_user:FvI56MGM36UYSSOr@cluster0.3d3qxj8.mongodb.net/restaurant?retryWrites=true&w=majority` |
   | `CLOUDINARY_CLOUD_NAME` | `jj7yxhr5` |
   | `CLOUDINARY_API_KEY` | `388693268456166` |
   | `CLOUDINARY_API_SECRET` | `ptk1zcooc8k3JT9NaxgKFZK93_8` |
   | `JWT_SECRET` | a long random string |
   | `NEXT_PUBLIC_BASE_URL` | `https://<your-vercel-app>.vercel.app` (set after first deploy) |
   | `GOOGLE_REVIEW_URL` | `https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID` |

5. Click **Deploy**. Wait ~2 minutes for the build to finish.

### 3. Set `NEXT_PUBLIC_BASE_URL`
After the first deploy Vercel gives you a URL like `https://lipisnacks-app.vercel.app`. Go back to **Settings → Environment Variables**, set `NEXT_PUBLIC_BASE_URL` to that exact URL, and **Redeploy**. This is what the QR codes encode — without it the printed QRs would point to `localhost`.

### 4. Run the seed on production (creates admin + 8 tables)
Vercel does not run one-off scripts, so we trigger the seed through a tiny API. From your laptop:
```bash
# Replace with your deployed URL
curl -X POST https://lipisnacks-app.vercel.app/api/seed
```
Or open the URL in a browser. (If you prefer, you can also run the seed locally before deploying — the same MongoDB Atlas cluster is used, so accounts created locally are available in production.)

> The `/api/seed` route is intentionally minimal and idempotent; it only creates the admin/chef/staff accounts and the 8 tables if they don't already exist. Delete or comment out `src/app/api/seed/route.ts` after seeding if you want to lock it down.

### 5. Find your Google Place ID
1. Open https://developers.google.com/maps/documentation/places/web-service/place-id
2. Enter your restaurant name/address and copy the `ChIJ...` place ID.
3. Put it into `GOOGLE_REVIEW_URL`:
   `https://search.google.com/local/writereview?placeid=ChIJ...your-id...`
4. Redeploy.

## Using the system day-to-day

1. **Admin** logs in → Tables & QR → downloads a PNG QR for each table → prints and places them on the tables.
2. **Admin** → Menu → adds dishes with Cloudinary images.
3. **Admin** → Staff & Chef → creates accounts for the kitchen team.
4. **Chef** opens `/chef/login` on a kitchen tablet.
5. **Service staff** opens `/staff/login` on a phone or tablet.
6. **Customer** scans the table QR, browses the menu, orders, pays, tips, rates, and lands on Google Reviews.

## Security notes

- Passwords are hashed with bcrypt (10 rounds).
- Sessions are JWT tokens stored in an **httpOnly** cookie — not readable by JavaScript.
- Admin-only routes verify `role === 'admin'` server-side.
- Image uploads are restricted to admin.
- Order prices are recomputed server-side from the menu — the client cannot spoof a price.
- **Rotate `JWT_SECRET`** regularly and never commit `.env` to git (it's in `.gitignore`).

## Customization

- **Restaurant name / colors**: edit `src/app/page.tsx` (landing), `src/app/layout.tsx` (title) and `tailwind.config.ts` (the `brand` color scale).
- **Tax / service charge**: change `taxRate` / `serviceChargeRate` defaults in `src/lib/cartStore.ts`.
- **Currency symbol**: `formatCurrency` in `src/lib/utils.ts` defaults to `৳` (Taka). Change to `₹`, `$`, etc.
- **UPI handle**: edit the placeholder text in `src/components/customer/CustomerApp.tsx` (`PayView`).

## Troubleshooting

- **"MongoDB connection failed"** — check the IP allowlist on Atlas. For Vercel, set the network access to `0.0.0.0/0` (Atlas → Network Access → Add IP → Allow from anywhere).
- **Image upload fails** — confirm Cloudinary env vars are set in Vercel.
- **QR points to localhost** — `NEXT_PUBLIC_BASE_URL` is not set to the production URL.
- **Customer cannot find a table** — make sure the admin created that table number and the QR encodes `?table=N`.
- **Chef portal doesn't beep** — browsers block audio until the user interacts with the page; tap the screen once.

## License

Proprietary — built for Lipi Snacks. All rights reserved.
