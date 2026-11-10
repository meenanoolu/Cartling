import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { money, productById } from "./catalog";
import { buildOrder, cartTotal, interpret, newTurn, type CartLine, type Order, type Turn } from "./desk-engine";

type DeskState = {
  ready: boolean;
  budget: number;
  lines: CartLine[];
  orders: Order[];
  turns: Turn[];
  focusId: string | null;
  focusStore: string | null;
  setReady: (ready: boolean) => void;
  setBudget: (budget: number) => void;
  send: (text: string, display?: string) => {
    polish: boolean;
    brief: string;
    turnId: string | null;
    webQuery?: string;
    recommendId?: string;
    stores?: Record<string, string>;
    paypalRefundId?: string;
  };
  replaceTurn: (id: string, text: string, patch?: Partial<Turn>) => void;
  setQty: (productId: string, qty: number) => void;
  setStore: (productId: string, store: string) => boolean;
  pay: () => string | null;
  note: (text: string) => void;
  recordPaid: (order: Order, clearCart: boolean) => void;
  refund: (id: string, quiet?: boolean) => void;
};

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      ready: false,
      budget: 100,
      lines: [],
      orders: [],
      turns: [],
      focusId: null,
      focusStore: null,
      setReady: (ready) => set({ ready }),
      setBudget: (budget) => set({ budget: clampBudget(budget) }),
      send: (text, display) => {
        const clean = text.trim();
        if (!clean) return { polish: false, brief: "", turnId: null };
        const desk = get();
        const result = interpret(clean, {
          budget: desk.budget,
          lines: desk.lines,
          orders: desk.orders,
          focusId: desk.focusId,
          focusStore: desk.focusStore,
        });
        const reply = newTurn("cartling", result.say, {
          productIds: result.products,
          recommendId: result.recommendId,
          recommendStore: result.recommendStore,
          stores: result.stores,
          actions: result.actions,
        });
        const paypalRefund = (result.orders ?? []).find((order) => {
          const prev = desk.orders.find((row) => row.id === order.id);
          return order.status === "refunded" && prev?.status === "paid" && Boolean(prev.paypalOrderId);
        });
        if (paypalRefund) {
          const pending = newTurn("cartling", `Sending ${paypalRefund.id} back through PayPal.`);
          set({
            turns: [...desk.turns, newTurn("you", display?.trim() || clean), pending].slice(-40),
          });
          return {
            polish: false,
            brief: "",
            turnId: pending.id,
            paypalRefundId: paypalRefund.id,
          };
        }
        set({
          budget: result.budget ?? desk.budget,
          lines: result.lines ?? desk.lines,
          orders: result.orders ?? desk.orders,
          focusId: result.focusId === undefined ? desk.focusId : result.focusId,
          focusStore: result.focusStore === undefined ? desk.focusStore : result.focusStore,
          turns: [...desk.turns, newTurn("you", display?.trim() || clean), reply].slice(-40),
        });
        return {
          polish: result.polish,
          brief: result.say,
          turnId: reply.id,
          webQuery: result.webQuery,
          recommendId: result.recommendId,
          stores: result.stores,
        };
      },
      replaceTurn: (id, text, patch) =>
        set({
          turns: get().turns.map((turn) => (turn.id === id ? { ...turn, ...patch, text } : turn)),
        }),
      setQty: (productId, qty) => {
        const current = get().lines;
        const lines = current.flatMap((line) => {
          if (line.productId !== productId) return [line];
          if (qty <= 0) return [];
          return [{ ...line, qty }];
        });
        const growing = qty > (current.find((line) => line.productId === productId)?.qty ?? 0);
        if (growing && cartTotal(lines) > get().budget + 0.001) return;
        set({ lines });
      },
      setStore: (productId, store) => {
        const product = productById(productId);
        if (!product || !product.offers.some((offer) => offer.store === store)) return false;
        const lines = get().lines.map((line) => (line.productId === productId ? { ...line, store } : line));
        if (cartTotal(lines) > get().budget + 0.001) return false;
        set({ lines, focusId: productId, focusStore: store });
        return true;
      },
      pay: () => {
        const { lines, budget, orders, turns } = get();
        const total = cartTotal(lines);
        if (lines.length === 0 || total > budget + 0.001) return null;
        const order = buildOrder(lines);
        const stores = [...new Set(order.lines.map((line) => line.store))];
        const reply = newTurn(
          "cartling",
          `Paid ${order.id} for ${money(total)}. ${stores.length} package${stores.length === 1 ? "" : "s"}: ${stores.join(", ")}. Say refund if it is wrong.`,
        );
        set({
          lines: [],
          orders: [...orders, order],
          turns: [...turns, reply].slice(-40),
        });
        return order.id;
      },
      note: (text) => set({ turns: [...get().turns, newTurn("cartling", text)].slice(-40) }),
      recordPaid: (order, clearCart) => {
        const stores = [...new Set(order.lines.map((line) => line.store))];
        const packs = `${stores.length} package${stores.length === 1 ? "" : "s"}: ${stores.join(", ")}`;
        set({
          lines: clearCart ? [] : get().lines,
          orders: [...get().orders.filter((row) => row.id !== order.id), order],
          turns: [
            ...get().turns,
            newTurn("cartling", `Paid ${order.id} for ${money(order.total)} through PayPal. ${packs}. Refund sends it back through PayPal.`),
          ].slice(-40),
        });
      },
      refund: (id, quiet) => {
        const order = get().orders.find((row) => row.id === id && row.status === "paid");
        if (!order) return;
        set({
          orders: get().orders.map((row) => (row.id === id ? { ...row, status: "refunded" as const } : row)),
          turns: quiet
            ? get().turns
            : [...get().turns, newTurn("cartling", `Refunded ${id}${order.paypalOrderId ? " through PayPal" : ""}. ${money(order.total)} is released.`)].slice(-40),
        });
      },
    }),
    {
      name: "cartling-desk",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        budget: state.budget,
        lines: state.lines,
        orders: state.orders,
        turns: state.turns,
        focusId: state.focusId,
        focusStore: state.focusStore,
      }),
    },
  ),
);

function clampBudget(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(2000, Math.max(10, Math.round(value * 100) / 100));
}

export function useCartTotal(): number {
  return useDesk((state) => cartTotal(state.lines));
}
