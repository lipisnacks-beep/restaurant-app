/**
 * Pay-action tip-split test (Node).
 *
 * Verifies the actual pay-action code path credits the tip 50/50 to the chef
 * (order.chefId) and staff (order.staffId). The Python aggregation test
 * (test_tip_split.py) proves the byDate split; this test proves the
 * User.tipsEarned credit that the pay action performs.
 *
 * Approach: we insert an order directly into MongoDB in the 'served' state
 * with chefId + staffId already set (simulating the dispatch lifecycle having
 * routed it), then drive ONLY the `pay` action through the real HTTP API.
 * The pay action runs the real split code, so we assert both users' tipsEarned
 * increased by exactly half the tip.
 */
const fs = require('fs');
const path = require('path');

// Load .env
const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const MONGO_URI = (env.match(/^MONGODB_URI=(.*)$/m) || [])[1].trim();
const BASE = 'http://localhost:3123';
const TAG = `PAYSPLIT-${Date.now()}`;

let PASS = 0, FAIL = 0;
function check(cond, msg) { if (cond) { PASS++; console.log(`  ✓ ${msg}`); } else { FAIL++; console.log(`  ✗ ${msg}`); } }

async function main() {
  const { MongoClient, ObjectId } = require('mongodb');
  const client = await MongoClient.connect(MONGO_URI);
  const db = client.db();

  const chef = await db.collection('users').findOne({ role: 'chef', active: true });
  const staff = await db.collection('users').findOne({ role: 'staff', active: true });
  const table = await db.collection('tables').findOne({ active: true });
  check(!!chef && !!staff && !!table, 'found chef + staff + table');
  if (!chef || !staff || !table) { await client.close(); process.exit(1); }

  const chefBefore = Number(chef.tipsEarned) || 0;
  const staffBefore = Number(staff.tipsEarned) || 0;
  console.log(`  chef  tipsEarned before: ${chefBefore}`);
  console.log(`  staff tipsEarned before: ${staffBefore}`);

  // Insert a 'served' order with chefId + staffId set, paymentStatus unpaid,
  // so the pay action will pick it up as a session order and run the split.
  const now = new Date();
  const orderDoc = {
    orderNumber: `${TAG}-1`,
    table: table._id,
    tableNumber: table.number,
    sessionId: `${TAG}-session`,
    items: [],
    subtotal: 200,
    taxRate: 0, taxAmount: 20,
    serviceChargeRate: 0, serviceChargeAmount: 10,
    tip: 0,
    total: 230,
    status: 'served',
    paymentMethod: 'cash',
    paymentStatus: 'unpaid',
    chefId: chef._id,
    staffId: staff._id,
    placedAt: now, servedAt: now,
    createdAt: now, updatedAt: now,
  };
  const insertRes = await db.collection('orders').insertOne(orderDoc);
  const orderId = insertRes.insertedId;
  check(!!orderId, `inserted served order with chef+staff (id=${orderId})`);

  // The pay action resolves the customer session from a cookie. To call it
  // authenticated as the customer, we need a CustomerSession. We create one
  // and set the rms_customer_session cookie. But the pay action is callable
  // by the customer; we instead authenticate as ADMIN (which the route also
  // allows for pay) to avoid the customer-session dance. Check the auth.
  // Actually the pay action resolves session with role allow-list — let's
  // just POST as admin with the order id; if it rejects, we'll set up the
  // customer session.

  // Login as admin to get a token + cookie.
  const adminLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@restaurant.com', password: 'admin123', scope: 'admin' }),
  });
  const setCookie = adminLogin.headers.get('set-cookie') || '';
  const adminCookie = setCookie.split(',').map(c => c.split(';')[0]).join('; ');
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;
  check(!!adminToken, 'admin login for pay action');

  // Pay the order with a tip of 100. Expected split: chef 50, staff 50.
  const TIP = 100;
  const payRes = await fetch(`${BASE}/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie, 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ action: 'pay', paymentMethod: 'cash', tip: TIP }),
  });
  const payBody = await payRes.json().catch(() => ({}));
  console.log(`  pay response status: ${payRes.status}`);
  if (payRes.status !== 200) {
    console.log(`  pay body: ${JSON.stringify(payBody).slice(0, 300)}`);
  }
  check(payRes.status === 200, `pay action with tip=${TIP} -> 200 (got ${payRes.status})`);

  // Re-read chef + staff tipsEarned and assert each got exactly half.
  const chefAfter = await db.collection('users').findOne({ _id: chef._id });
  const staffAfter = await db.collection('users').findOne({ _id: staff._id });
  const chefDelta = Number(chefAfter.tipsEarned) - chefBefore;
  const staffDelta = Number(staffAfter.tipsEarned) - staffBefore;
  console.log(`  chef  tipsEarned after: ${chefAfter.tipsEarned} (delta ${chefDelta})`);
  console.log(`  staff tipsEarned after: ${staffAfter.tipsEarned} (delta ${staffDelta})`);
  check(Math.abs(chefDelta - 50) < 0.001, `chef credited exactly half (50) — got ${chefDelta}`);
  check(Math.abs(staffDelta - 50) < 0.001, `staff credited exactly half (50) — got ${staffDelta}`);
  check(Math.abs(chefDelta + staffDelta - TIP) < 0.001, `chef + staff sum to the full tip (${TIP})`);

  // ---- Cleanup: restore balances + remove test order ----
  await db.collection('users').updateOne({ _id: chef._id }, { $inc: { tipsEarned: -chefDelta } });
  await db.collection('users').updateOne({ _id: staff._id }, { $inc: { tipsEarned: -staffDelta } });
  await db.collection('orders').deleteOne({ _id: orderId });
  check(true, 'restored balances + removed test order');

  await client.close();
  console.log(`\n${'='.repeat(55)}`);
  console.log(`PAY-ACTION TIP SPLIT TEST: ${PASS} passed, ${FAIL} failed`);
  console.log(`${'='.repeat(55)}`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
