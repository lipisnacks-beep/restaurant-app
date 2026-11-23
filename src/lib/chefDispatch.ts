import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import User from '@/models/User';
import { Types } from 'mongoose';

/**
 * Smart chef dispatch engine.
 *
 * Goal: when a customer places an order, it goes to ONE available chef (not
 * broadcast to all). The chosen chef accepts and prepares it; the others never
 * even see it. This keeps the kitchen orderly and lets us show the customer
 * exactly which chef is handling their order.
 *
 * Availability model
 *   A chef is "available" iff ALL of:
 *     - role === 'chef'
 *     - active === true
 *     - lastActiveAt within the last PRESENCE_TTL_MS (i.e. the chef's portal
 *       tab is open and polling — a chef who closed the tab is not available)
 *     - current load (preparing orders assigned to them) < MAX_CONCURRENT_ORDERS
 *
 * Selection
 *   Orders are routed FIFO (oldest unassigned pending order first). For each
 *   order we pick the available chef with the FEWEST current preparing orders;
 *   ties are broken by lastAssignedAt ascending (round-robin) so orders spread
 *   evenly across equally-loaded chefs instead of always hammering the same
 *   one. The assignment is atomic (findOneAndUpdate with a status+unassigned
 *   guard) so two concurrent polls can't both route the same order to two
 *   different chefs.
 *
 * No chef available
 *   The order stays 'pending' with no chefId. The order carries an
 *   estimatedChefAssignBy timestamp so the customer sees a TAT countdown
 *   ("a chef will pick this up shortly") instead of a bare "pending".
 */

/** A chef is considered present if their portal polled within this window. */
export const PRESENCE_TTL_MS = 90 * 1000; // 90 seconds
/** Max preparing orders a single chef is routed at once. */
export const MAX_CONCURRENT_ORDERS = 3;
/**
 * When no chef is available, we tell the customer an order will be picked up
 * within this many seconds. The countdown is bounded so it never looks stuck.
 */
export const NO_CHEF_TAT_SECONDS = 120;

/**
 * Throttled presence heartbeat. Called on every chef queue poll; only writes
 * to the DB when the stored lastActiveAt is older than the throttle window,
 * so a 3-second poll does not cause a 3-second write burst.
 */
export async function touchChefPresence(userId: string | Types.ObjectId): Promise<void> {
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
 * Returns the list of currently-available chefs (present + under capacity).
 * Used to decide whether a freshly-placed order can be routed immediately.
 */
export async function getAvailableChefs() {
  await dbConnect();
  const presenceSince = new Date(Date.now() - PRESENCE_TTL_MS);
  const chefs = await User.find({
    role: 'chef',
    active: true,
    lastActiveAt: { $gte: presenceSince },
  }).lean();
  // Count each chef's current load. "Load" = orders the chef is responsible for
  // but hasn't finished: BOTH pending (assigned but not yet started) AND
  // preparing. Counting only 'preparing' would let a chef accumulate unlimited
  // routed-but-unstarted orders; counting both respects the capacity cap so
  // orders actually spread across chefs.
  const loads = await Order.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        status: { $in: ['pending', 'preparing'] },
        chefId: { $in: chefs.map((c) => c._id) },
      },
    },
    { $group: { _id: '$chefId', count: { $sum: 1 } } },
  ]);
  const loadMap = new Map<string, number>();
  for (const l of loads) loadMap.set(String(l._id), l.count);
  // Re-shape to a plain object with a `load` field so the consumer (the sort
  // comparator) can read chef fields (name, lastAssignedAt, …) without TS
  // narrowing the aggregate projection onto the spread result.
  const result: Array<{
    _id: Types.ObjectId;
    name: string;
    lastActiveAt?: Date | null;
    lastAssignedAt?: Date | null;
    load: number;
  }> = chefs.map((c) => ({
    _id: c._id as Types.ObjectId,
    name: c.name,
    lastActiveAt: (c as any).lastActiveAt ?? null,
    lastAssignedAt: (c as any).lastAssignedAt ?? null,
    load: loadMap.get(String(c._id)) || 0,
  }));
  return result.filter((c) => c.load < MAX_CONCURRENT_ORDERS);
}

interface AssignResult {
  assigned: number;     // how many orders got routed to a chef this call
  stillPending: number; // how many remain unassigned (no chef available)
}

/**
 * Route every unassigned pending order to an available chef, oldest first.
 * Safe to call from: order placement, chef queue poll, mark_ready, complete.
 * Each assignment is atomic — concurrent calls cannot double-assign.
 */
export async function assignPendingOrdersToChefs(): Promise<AssignResult> {
  await dbConnect();

  // Unassigned pending orders, oldest first. (chefId missing => not routed.)
  const pending = await Order.find({
    status: 'pending',
    chefId: { $exists: false },
  }).sort({ createdAt: 1 }).lean();

  if (pending.length === 0) return { assigned: 0, stillPending: 0 };

  const available = await getAvailableChefs();
  if (available.length === 0) {
    // No chef available: stamp a TAT on every still-unassigned order so the
    // customer sees a countdown instead of an indefinite "pending".
    const eta = new Date(Date.now() + NO_CHEF_TAT_SECONDS * 1000);
    await Order.updateMany(
      { _id: { $in: pending.map((o) => o._id) }, estimatedChefAssignBy: { $exists: false } },
      { $set: { estimatedChefAssignBy: eta } },
    );
    return { assigned: 0, stillPending: pending.length };
  }

  // Build a live load map we mutate as we hand out orders.
  const loadMap = new Map<string, number>();
  for (const c of available) loadMap.set(String(c._id), c.load);

  let assigned = 0;
  for (const order of pending) {
    // Re-derive the candidate list each iteration (load changes as we assign).
    const candidates = available
      .filter((c) => (loadMap.get(String(c._id)) || 0) < MAX_CONCURRENT_ORDERS)
      .sort((a, b) => {
        const la = loadMap.get(String(a._id)) || 0;
        const lb = loadMap.get(String(b._id)) || 0;
        if (la !== lb) return la - lb; // fewest preparing first
        // tie-break: least-recently-assigned chef (round-robin)
        const ta = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
        const tb = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
        return ta - tb;
      });

    if (candidates.length === 0) {
      // All available chefs are now at capacity. Stamp a TAT on the rest.
      const eta = new Date(Date.now() + NO_CHEF_TAT_SECONDS * 1000);
      await Order.updateOne(
        { _id: order._id, estimatedChefAssignBy: { $exists: false } },
        { $set: { estimatedChefAssignBy: eta } },
      );
      continue;
    }

    const chosen = candidates[0];

    // Atomic claim: only assign if the order is STILL pending and unassigned.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: 'pending', chefId: { $exists: false } },
      {
        $set: {
          chefId: chosen._id,
          assignedAt: new Date(),
        },
        // Clear any prior no-chef ETA — a chef HAS it now. (Cannot combine
        // $set and $unset on the same field, so we unset here.)
        $unset: { estimatedChefAssignBy: '' },
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

  const stillPending = pending.length - assigned;
  return { assigned, stillPending };
}
