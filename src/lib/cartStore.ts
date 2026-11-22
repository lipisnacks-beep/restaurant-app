'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  menuItem: string;
  name: string;
  price: number;
  image?: string;
  quantity: number;
  note?: string;
}

interface CartState {
  tableNumber: number | null;
  sessionId: string;
  customerName: string;
  items: CartItem[];
  taxRate: number;
  serviceChargeRate: number;
  setTable: (n: number) => void;
  setSession: (s: string) => void;
  setCustomerName: (n: string) => void;
  add: (item: CartItem) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  setNote: (id: string, note: string) => void;
  clear: () => void;
  subtotal: () => number;
  taxAmount: () => number;
  serviceAmount: () => number;
  total: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      tableNumber: null,
      sessionId: '',
      customerName: '',
      items: [],
      taxRate: 0,           // adjust per restaurant policy
      serviceChargeRate: 0, // adjust per restaurant policy
      setTable: (n) => set({ tableNumber: n }),
      setSession: (s) => set({ sessionId: s }),
      setCustomerName: (n) => set({ customerName: n }),
      add: (item) => {
        const items = [...get().items];
        const idx = items.findIndex((i) => i.menuItem === item.menuItem);
        if (idx >= 0) {
          items[idx] = { ...items[idx], quantity: items[idx].quantity + 1 };
        } else {
          items.push({ ...item, quantity: item.quantity || 1 });
        }
        set({ items });
      },
      remove: (id) => set({ items: get().items.filter((i) => i.menuItem !== id) }),
      setQty: (id, qty) => {
        if (qty < 1) {
          set({ items: get().items.filter((i) => i.menuItem !== id) });
          return;
        }
        set({ items: get().items.map((i) => (i.menuItem === id ? { ...i, quantity: qty } : i)) });
      },
      setNote: (id, note) =>
        set({ items: get().items.map((i) => (i.menuItem === id ? { ...i, note } : i)) }),
      clear: () => set({ items: [] }),
      subtotal: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
      taxAmount: () => Math.round(get().subtotal() * (get().taxRate / 100)),
      serviceAmount: () => Math.round(get().subtotal() * (get().serviceChargeRate / 100)),
      total: () => get().subtotal() + get().taxAmount() + get().serviceAmount(),
    }),
    { name: 'rms-cart' }
  )
);
