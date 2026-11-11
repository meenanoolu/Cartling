import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { money, productById } from "./catalog";
import { buildOrder, cartTotal, interpret, newTurn, type CartLine, type Order, type ShipTo, type Turn } from "./desk-engine";

export type Chat = {
  id: string;
  title: string;
  turns: Turn[];
  updated: number;
};

type DeskState = {
  ready: boolean;
  budget: number;
  lines: CartLine[];
  orders: Order[];
  turns: Turn[];
  chats: Chat[];
  activeId: string;
  focusId: string | null;
  focusStore: string | null;
  shipTo: ShipTo | null;
  setReady: (ready: boolean) => void;
  setBudget: (budget: number) => void;
  setShipTo: (shipTo: ShipTo) => void;
  ensureChats: () => void;
  newChat: () => void;
  openChat: (id: string) => void;
  send: (text: string, display?: string) => {
    polish: boolean;
    brief: string;
    turnId: string | null;
    webQuery?: string;
    recommendId?: string;
    stores?: Record<string, string>;
    paypalRefundId?: string;
    needAddress?: boolean;
    statusIds?: string[];
  };
  replaceTurn: (id: string, text: string, patch?: Partial<Turn>) => void;
  setQty: (productId: string, qty: number) => void;
  setStore: (productId: string, store: string) => boolean;
  pay: () => string | null;
  note: (text: string, steps?: string[]) => void;
  recordPaid: (order: Order, clearCart: boolean) => void;
  syncPaypal: (id: string, status: string, paypalTotal?: number) => void;
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
      chats: [],
      activeId: "",
      focusId: null,
      focusStore: null,
      shipTo: null,
      setReady: (ready) => set({ ready }),
      setBudget: (budget) => set({ budget: clampBudget(budget) }),
      setShipTo: (shipTo) => set({ shipTo }),
      ensureChats: () => {
        const desk = get();
        if (desk.activeId && desk.chats.some((chat) => chat.id === desk.activeId)) return;
        const id = desk.activeId || chatId();
        if (!desk.turns.length) {
          set({ activeId: id });
          return;
        }
        set({
          activeId: id,
          chats: [{ id, title: titleOf(desk.turns), turns: desk.turns, updated: Date.now() }],
        });
      },
      newChat: () => {
        const desk = get();
        if (!desk.turns.length) return;
        const id = chatId();
        set({
          ...saved(desk, desk.turns),
          activeId: id,
          turns: [],
        });
      },
      openChat: (id) => {
        const desk = get();
        const next = saved(desk, desk.turns);
        const chat = next.chats.find((row) => row.id === id);
        if (!chat) return;
        set({ ...next, activeId: id, turns: chat.turns });
      },
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
          shipTo: desk.shipTo,
        });
        if (desk.shipTo && !result.needAddress && namesADay(clean)) {
          result.say = `Shipping to ${desk.shipTo.city}, ${desk.shipTo.postal}. ${result.say}`;
        }
        const reply = newTurn("cartling", result.say, {
          productIds: result.products,
          recommendId: result.recommendId,
          recommendStore: result.recommendStore,
          stores: result.stores,
          actions: result.actions,
          steps: result.steps ?? agentSteps(result, clean),
        });
        const paypalRefund = (result.orders ?? []).find((order) => {
          const prev = desk.orders.find((row) => row.id === order.id);
          return order.status === "refunded" && prev?.status === "paid" && Boolean(prev.paypalOrderId);
        });
        if (paypalRefund) {
          const pending = newTurn("cartling", `Sending ${paypalRefund.id} back through PayPal.`, {
            steps: ["Asked PayPal to refund the capture", paypalRefund.id],
          });
          const turns = [...desk.turns, newTurn("you", display?.trim() || clean), pending].slice(-40);
          set(saved(desk, turns));
          return {
            polish: false,
            brief: "",
            turnId: pending.id,
            paypalRefundId: paypalRefund.id,
          };
        }
        const turns = [...desk.turns, newTurn("you", display?.trim() || clean), reply].slice(-40);
        set({
          ...saved(desk, turns),
          budget: result.budget ?? desk.budget,
          lines: result.lines ?? desk.lines,
          orders: result.orders ?? desk.orders,
          focusId: result.focusId === undefined ? desk.focusId : result.focusId,
          focusStore: result.focusStore === undefined ? desk.focusStore : result.focusStore,
        });
        return {
          polish: result.polish,
          brief: result.say,
          turnId: reply.id,
          webQuery: result.webQuery,
          recommendId: result.recommendId,
          stores: result.stores,
          needAddress: result.needAddress,
          statusIds: result.statusIds,
        };
      },
      replaceTurn: (id, text, patch) => {
        const desk = get();
        const turns = desk.turns.map((turn) => (turn.id === id ? { ...turn, ...patch, text } : turn));
        set(saved(desk, turns));
      },
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
        const desk = get();
        const total = cartTotal(desk.lines);
        if (desk.lines.length === 0 || total > desk.budget + 0.001) return null;
        const order = buildOrder(desk.lines);
        const stores = [...new Set(order.lines.map((line) => line.store))];
        const turns = [
          ...desk.turns,
          newTurn(
            "cartling",
            `Paid ${order.id} for ${money(total)}. ${stores.length} package${stores.length === 1 ? "" : "s"}: ${stores.join(", ")}. Say refund if it is wrong.`,
          ),
        ].slice(-40);
        set({ ...saved(desk, turns), lines: [], orders: [...desk.orders, order] });
        return order.id;
      },
      note: (text, steps) => {
        const desk = get();
        set(saved(desk, [...desk.turns, newTurn("cartling", text, steps ? { steps } : undefined)].slice(-40)));
      },
      recordPaid: (order, clearCart) => {
        const desk = get();
        const stores = [...new Set(order.lines.map((line) => line.store))];
        const packs = `${stores.length} package${stores.length === 1 ? "" : "s"}: ${stores.join(", ")}`;
        const turns = [
          ...desk.turns,
          newTurn("cartling", `Paid ${order.id} for ${money(order.total)} through PayPal. ${packs}. Refund sends it back through PayPal.`, {
            steps: [
              "Captured the PayPal order",
              order.paypalCaptureId ? `Capture ${order.paypalCaptureId} is COMPLETED` : "PayPal status COMPLETED",
              ...(order.paypalTotal == null ? [] : [`PayPal captured ${money(order.paypalTotal)}`]),
            ],
          }),
        ].slice(-40);
        set({
          ...saved(desk, turns),
          lines: clearCart ? [] : desk.lines,
          orders: [...desk.orders.filter((row) => row.id !== order.id), order],
        });
      },
      syncPaypal: (id, status, paypalTotal) => {
        const desk = get();
        const order = desk.orders.find((row) => row.id === id);
        if (!order) return;
        const nextStatus = status === "REFUNDED" ? "refunded" : order.status;
        const sameTotal = paypalTotal == null || (order.paypalTotal != null && Math.abs(order.paypalTotal - paypalTotal) < 0.001);
        if (sameTotal && nextStatus === order.status) return;
        const becameRefunded = order.status === "paid" && nextStatus === "refunded";
        const turns = becameRefunded
          ? [...desk.turns, newTurn("cartling", `PayPal refunded ${id}. ${money(order.total)} went back.`, { steps: ["PayPal reported REFUNDED"] })].slice(-40)
          : desk.turns;
        set({
          ...saved(desk, turns),
          orders: desk.orders.map((row) =>
            row.id === id ? { ...row, status: nextStatus, paypalTotal: paypalTotal ?? row.paypalTotal } : row,
          ),
        });
      },
      refund: (id, quiet) => {
        const desk = get();
        const order = desk.orders.find((row) => row.id === id && row.status === "paid");
        if (!order) return;
        const turns = quiet
          ? desk.turns
          : [...desk.turns, newTurn("cartling", `Refunded ${id}${order.paypalOrderId ? " through PayPal" : ""}. ${money(order.total)} is released.`, {
              steps: order.paypalOrderId ? ["Refunded the PayPal capture", "PayPal status REFUNDED"] : ["Marked the order refunded"],
            })].slice(-40);
        set({
          ...saved(desk, turns),
          orders: desk.orders.map((row) => (row.id === id ? { ...row, status: "refunded" as const } : row)),
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
        chats: state.chats,
        activeId: state.activeId,
        focusId: state.focusId,
        focusStore: state.focusStore,
        shipTo: state.shipTo,
      }),
    },
  ),
);

function chatId(): string {
  return `chat-${Date.now().toString(36)}`;
}

function titleOf(turns: Turn[]): string {
  const first = turns.find((turn) => turn.role === "you")?.text.trim();
  if (!first) return "New chat";
  return first.length > 42 ? `${first.slice(0, 42)}...` : first;
}

function saved(desk: { chats: Chat[]; activeId: string; turns: Turn[] }, turns: Turn[]) {
  const id = desk.activeId || chatId();
  const chat: Chat = { id, title: titleOf(turns), turns, updated: Date.now() };
  const rest = desk.chats.filter((row) => row.id !== id);
  const chats = turns.length ? [chat, ...rest].slice(0, 30) : rest;
  return { activeId: id, turns, chats };
}

function agentSteps(result: { needAddress?: boolean; webQuery?: string; products?: string[]; recommendStore?: string; say: string }, text: string): string[] {
  const steps: string[] = [];
  if (result.needAddress) steps.push("Stopped. A day window needs a ship-to address");
  if (result.products?.length) {
    steps.push("Checked the catalog");
    if (namesADay(text)) steps.push("Dropped stores that miss the named day");
    if (result.recommendStore) steps.push(`Kept ${result.recommendStore}`);
  }
  if (/did not add|over the ceiling|break the ceiling/i.test(result.say)) steps.push("Refused the add. It is over the ceiling");
  if (result.webQuery) steps.push("Nothing in the aisle matched");
  return steps;
}

function namesADay(text: string): boolean {
  return /\b(?:in|within)\s+\d+\s+days?\b|\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(tomorrow|overnight|this weekend|asap|rush)\b/.test(
    text.toLowerCase(),
  );
}

function clampBudget(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(2000, Math.max(10, Math.round(value * 100) / 100));
}

export function useCartTotal(): number {
  return useDesk((state) => cartTotal(state.lines));
}
