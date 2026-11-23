import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import User from '@/models/User';
import { Types } from 'mongoose';

/**
 * Smart staff dispatch engine — the serving-side mirror of chefDispatch.ts.
 *
 * Goal: when a chef marks an order 'ready', it goes to ONE available staff
 * member (not broadcast to all of them). The chosen staff accepts and serves
 * it; the others never even see it. This keeps the floor orderly and lets us
 * show the customer exactly which staff is bringing their order — and route
 * any tip to that staff's earnings.
 *
 * Availability model
 *   A staff member is "available" iff ALL of:
 *     - role === 'staff'
 *     - active === true
 *     - lastActiveAt within the last PRESENCE_TTL_MS (their portal tab is
 *       open and polling — a staff who closed the tab is not available)
 *     - current load (ready + served orders assigned to them) < MAX_CONCURRENT_ORDERS
 *
 * Selection
 *   Ready orders are routed FIFO (oldest ready order first). For each order we
 *   pick the available staff with the FEWEST current ready+served orders;
 *   ties are broken by lastAssignedAt ascending (round-robin) so orders
 *   spread evenly across equally-loaded staff. The assignment is atomic
 *   (findOneAndUpdate with a status+unassigned guard) so two concurrent polls
 *   can't both route the same order to two different staff.
 *
 * No staff available
 *   The order stays 'ready' with no staffId. The order carries an
 *   estimatedStaffAssignBy timestamp so the customer sees a TAT countdown
 *   ("a staff will serve this shortly") instead of a bare "ready".
 */

/** A staff member is considered present if their portal polled within this window. */
export const STAFF_PRESENCE_TTL_MS = 90 * 1000; // 90 seconds
/** Max ready+served orders a single staff is routed at once. */
export const STAFF_MAX_CONCURRENT_ORDERS = 4;
/**
 * When no staff is available, we tell the customer an order will be served
 * within this many seconds. Bounded so it never looks stuck.
 */
export const NO_STAFF_TAT_SECONDS = 120;

/**
 * Throttled presence heartbeat. Called on every staff queue poll; only writes
 * to the DB when the stored lastActiveAt is older than the throttle window,
 * so a 3-second poll does not cause a 3-second write burst.
 */
export async function touchStaffPresence(userId: string | Types.ObjectId): Promise<void> {
  if (!userId) return;
  await dbConnect();
  const id = new Types.ObjectId(String(userId));
  const cutoff = new Date(Date.now() - 10 * 1000); // only update if older than 10s
  await User.updateOne(
    { _id: id, $or: [{ lastActiveAt: { $lt: cutoff } }, { lastActiveAt: null }] },
    { $set: { lastActiveAt: new Date() } },
  );
}

/**
 * Returns the list of currently-available staff (present + under capacity).
 */
export async function getAvailableStaff() {
  await dbConnect();
  const presenceSince = new Date(Date.now() - STAFF_PRESENCE_TTL_MS);
  const staff = await User.find({
    role: 'staff',
    active: true,
    lastActiveAt: { $gte: presenceSince },
  }).lean();
  // Count each staff's current load = ready (assigned, not yet served) +
  // served (delivered, awaiting payment) orders. Both count because the staff
  // is responsible for them until they are paid/completed.
  const loads = await Order.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        status: { $in: ['ready', 'served'] },
        staffId: { $in: staff.map((s) => s._id) },
      },
    },
    { $group: { _id: '$staffId', count: { $sum: 1 } } },
  ]);
  const loadMap = new Map<string, number>();
  for (const l of loads) loadMap.set(String(l._id), l.count);
  const result: Array<{
    _id: Types.ObjectId;
    name: string;
    lastActiveAt?: Date | null;
    lastAssignedAt?: Date | null;
    load: number;
  }> = staff.map((s) => ({
    _id: s._id as Types.ObjectId,
    name: s.name,
    lastActiveAt: (s as any).lastActiveAt ?? null,
    lastAssignedAt: (s as any).lastAssignedAt ?? null,
    load: loadMap.get(String(s._id)) || 0,
  }));
  return result.filter((s) => s.load < STAFF_MAX_CONCURRENT_ORDERS);
}

interface AssignResult {
  assigned: number;     // how many ready orders got routed to a staff this call
  stillPending: number;  // how many remain unassigned (no staff available)
}

/**
 * Route every unassigned ready order to an available staff member, oldest
 * (earliest readyAt) first. Safe to call from: mark_ready, staff queue poll.
 * Each assignment is atomic — concurrent calls cannot double-assign.
 */
export async function assignReadyOrdersToStaff(): Promise<AssignResult> {
  await dbConnect();

  // Ready orders that have NOT been routed to a staff yet (staffId missing).
  // Oldest first so the order that's been waiting longest is served first.
  const ready = await Order.find({
    status: 'ready',
    staffId: { $exists: false },
  }).sort({ readyAt: 1, createdAt: 1 }).lean();

  if (ready.length === 0) return { assigned: 0, stillPending: 0 };

  const available = await getAvailableStaff();
  if (available.length === 0) {
    // No staff available: stamp a TAT on every still-unassigned ready order so
    // the customer sees a countdown instead of an indefinite "ready".
    const eta = new Date(Date.now() + NO_STAFF_TAT_SECONDS * 1000);
    await Order.updateMany(
      { _id: { $in: ready.map((o) => o._id) }, estimatedStaffAssignBy: { $exists: false } },
      { $set: { estimatedStaffAssignBy: eta } },
    );
    return { assigned: 0, stillPending: ready.length };
  }

  // Build a live load map we mutate as we hand out orders.
  const loadMap = new Map<string, number>();
  for (const s of available) loadMap.set(String(s._id), s.load);

  let assigned = 0;
  for (const order of ready) {
    // Re-derive the candidate list each iteration (load changes as we assign).
    const candidates = available
      .filter((s) => (loadMap.get(String(s._id)) || 0) < STAFF_MAX_CONCURRENT_ORDERS)
      .sort((a, b) => {
        const la = loadMap.get(String(a._id)) || 0;
        const lb = loadMap.get(String(b._id)) || 0;
        if (la !== lb) return la - lb; // fewest ready+served first
        // tie-break: least-recently-assigned staff (round-robin)
        const ta = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
        const tb = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
        return ta - tb;
      });

    if (candidates.length === 0) {
      // All available staff are now at capacity. Stamp a TAT on the rest.
      const eta = new Date(Date.now() + NO_STAFF_TAT_SECONDS * 1000);
      await Order.updateOne(
        { _id: order._id, estimatedStaffAssignBy: { $exists: false } },
        { $set: { estimatedStaffAssignBy: eta } },
      );
      continue;
    }

    const chosen = candidates[0];

    // Atomic claim: only route if the order is STILL ready and unassigned.
    // staffId is set on the order (routing), and acceptedAt is set too so the
    // staff portal treats it as "claimed" (the assigned staff just needs to
    // physically serve it). This matches the existing accept() flow which
    // checks acceptedAt.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: 'ready', staffId: { $exists: false } },
      {
        $set: {
          staffId: chosen._id,
          staffAssignedAt: new Date(),
          acceptedAt: new Date(),
        },
        $unset: { estimatedStaffAssignBy: '' },
      },
      { new: true },
    );

    if (updated) {
      assigned++;
      loadMap.set(String(chosen._id), (loadMap.get(String(chosen._id)) || 0) + 1);
      // Record round-robin timestamp (fire-and-forget; not load-bearing).
      await User.updateOne(
        { _id: chosen._id },
        { $set: { lastAssignedAt: new Date() } },
      );
    }
    // If updated is null, another concurrent caller already routed this order;
    // move on to the next one.
  }

  const stillPending = ready.length - assigned;
  return { assigned, stillPending };
}
