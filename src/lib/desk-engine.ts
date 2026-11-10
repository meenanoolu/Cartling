import {
  PRODUCTS,
  bestOffer,
  chosenOffer,
  money,
  productById,
  soonestOffer,
  type Offer,
  type Product,
} from "./catalog";

export type CartLine = { productId: string; qty: number; store?: string };

export type OrderLine = {
  productId: string;
  name: string;
  qty: number;
  store: string;
  price: number;
  ships: string;
};

export type Order = {
  id: string;
  created: number;
  lines: OrderLine[];
  total: number;
  status: "paid" | "refunded";
  paypalOrderId?: string;
  paypalCaptureId?: string;
};

export type TurnAction = { label: string; run: string };

export type Turn = {
  id: string;
  role: "you" | "cartling";
  text: string;
  productIds?: string[];
  recommendId?: string;
  recommendStore?: string;
  stores?: Record<string, string>;
  actions?: TurnAction[];
};

export type DeskSnapshot = {
  budget: number;
  lines: CartLine[];
  orders: Order[];
  focusId: string | null;
  focusStore: string | null;
};

export type EngineResult = {
  say: string;
  products?: string[];
  recommendId?: string;
  recommendStore?: string;
  stores?: Record<string, string>;
  actions?: TurnAction[];
  budget?: number;
  lines?: CartLine[];
  orders?: Order[];
  focusId?: string | null;
  focusStore?: string | null;
  polish: boolean;
  webQuery?: string;
};

const SETS: { test: RegExp; ids: string[]; name: string }[] = [
  { test: /\b(desk|wfh|work from home|setup)\b/, ids: ["laptop-stand", "mouse"], name: "desk set" },
  { test: /\b(travel|trip|flight|commute kit)\b/, ids: ["earbuds-nc", "power-bank", "usb-c-cable"], name: "travel kit" },
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function lineCost(line: CartLine): number {
  const product = productById(line.productId);
  if (!product) return 0;
  return chosenOffer(product, line.store).price * line.qty;
}

export function cartTotal(lines: CartLine[]): number {
  return round(lines.reduce((sum, line) => sum + lineCost(line), 0));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function within(lines: CartLine[], budget: number): boolean {
  return cartTotal(lines) <= budget + 0.001;
}

function ownedIds(orders: Order[]): Set<string> {
  const ids = new Set<string>();
  for (const order of orders) {
    if (order.status !== "paid") continue;
    for (const line of order.lines) ids.add(line.productId);
  }
  return ids;
}

function scored(text: string): { product: Product; score: number }[] {
  return PRODUCTS.map((product) => {
    let score = 0;
    for (const alias of product.aliases) {
      if (text.includes(alias)) score += alias.length > 4 ? 2 : 1;
    }
    if (text.includes(product.name.toLowerCase())) score += 3;
    return { product, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

function readBudget(text: string): number | null {
  const labeled = text.match(
    /(?:under|below|max(?:imum)?|budget|ceiling|less than|within|up to|only)\s*\$?\s*(\d+(?:\.\d{1,2})?)/,
  );
  if (labeled) return Number(labeled[1]);
  const dollar = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollar) return Number(dollar[1]);
  return null;
}

function daysUntil(name: string): number {
  const target = WEEKDAYS.indexOf(name);
  if (target < 0) return 7;
  const delta = (target - new Date().getDay() + 7) % 7;
  return delta === 0 ? 7 : delta;
}

function rushLimit(text: string): number | null {
  const by = text.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (by) return daysUntil(by[1]!);
  if (/\b(tomorrow|overnight)\b/.test(text)) return 1;
  const counted = text.match(/\b(?:in|within)\s+(\d+)\s+days?\b/);
  if (counted) return Number(counted[1]);
  if (/\bthis weekend\b/.test(text)) return daysUntil("saturday");
  if (/\b(asap|rush)\b/.test(text)) return 2;
  return null;
}

function offerForAsk(product: Product, limit: number | null): { offer: Offer; missed: boolean } {
  if (limit == null) return { offer: bestOffer(product), missed: false };
  const ok = product.offers.filter((offer) => offer.days <= limit).sort((a, b) => a.price - b.price || a.days - b.days);
  if (ok[0]) return { offer: ok[0], missed: false };
  return { offer: soonestOffer(product), missed: true };
}

function storeInText(product: Product, text: string): Offer | null {
  return product.offers.find((offer) => text.includes(offer.store.toLowerCase())) ?? null;
}

function project(lines: CartLine[], productId: string, store: string, addQty = true): CartLine[] {
  const existing = lines.find((line) => line.productId === productId);
  if (!existing) return [...lines, { productId, qty: 1, store }];
  const switching = (existing.store ?? chosenOffer(productById(productId)!).store) !== store;
  const qty = switching || !addQty ? existing.qty : existing.qty + 1;
  return lines.map((line) => (line.productId === productId ? { ...line, qty, store } : line));
}

function packageCount(lines: CartLine[]): number {
  return new Set(lines.map((line) => chosenOffer(productById(line.productId)!, line.store).store)).size;
}

function overCopy(product: Product, offer: Offer, budget: number, lines: CartLine[]): { say: string; actions: TurnAction[] } {
  const projected = project(lines, product.id, offer.store);
  const need = cartTotal(projected);
  const actions: TurnAction[] = [
    { label: `Raise ceiling to ${money(need)} and add it`, run: `raise ceiling to ${need} and add ${product.id} from ${offer.store}` },
  ];
  const fattest = [...lines].sort((a, b) => lineCost(b) - lineCost(a))[0];
  if (fattest && fattest.productId !== product.id) {
    const other = productById(fattest.productId);
    if (other) actions.push({ label: `Drop ${other.name}`, run: `remove ${other.id}` });
  }
  const room = round(Math.max(0, budget - cartTotal(lines)));
  return {
    say: `${product.name} is ${money(offer.price)} at ${offer.store}, ${offer.ships}. You have ${money(room)} left of ${money(budget)}, so I did not add it.`,
    actions,
  };
}

function pairAction(product: Product, lines: CartLine[], budget: number, owned: Set<string>): TurnAction | null {
  for (const id of product.pairs) {
    const extra = productById(id);
    if (!extra) continue;
    if (lines.some((line) => line.productId === id) || owned.has(id)) continue;
    const offer = bestOffer(extra);
    const next = project(lines, extra.id, offer.store);
    if (!within(next, budget)) continue;
    return { label: `Add the missing ${extra.name}`, run: `add ${extra.id} from ${offer.store}` };
  }
  return null;
}

function pairSentence(action: TurnAction | null): string {
  if (!action) return "";
  return ` ${action.label.replace("Add the missing ", "You will also need the ")}. It still fits.`;
}

export function interpret(raw: string, desk: DeskSnapshot): EngineResult {
  const text = raw.trim().toLowerCase();
  const stated = readBudget(text);
  const nextBudget = stated ?? desk.budget;
  const owned = ownedIds(desk.orders);
  const limit = rushLimit(text);

  const refundId = text.match(/\b(c-[a-z0-9]+)\b/);
  if (/\b(refund|return it|send it back)\b/.test(text)) {
    const last =
      (refundId && desk.orders.find((order) => order.id.toLowerCase() === refundId[1] && order.status === "paid")) ||
      [...desk.orders].reverse().find((order) => order.status === "paid");
    if (!last) return { say: "Nothing paid is sitting here to refund.", polish: false };
    return {
      say: `Refunded ${last.id}. ${money(last.total)} goes back. Those things no longer count as yours.`,
      orders: desk.orders.map((order) => (order.id === last.id ? { ...order, status: "refunded" as const } : order)),
      polish: false,
    };
  }

  if (/\b(status|where is|tracking|track|receipts?)\b/.test(text)) {
    if (desk.orders.length === 0) return { say: "No receipts yet. The cart is the only thing in motion.", polish: false };
    const lines = desk.orders
      .slice(-3)
      .map((order) => {
        const packs = new Set(order.lines.map((line) => line.store)).size;
        return `${order.id} · ${order.status} · ${money(order.total)} · ${packs} package${packs === 1 ? "" : "s"}`;
      })
      .join(" ");
    return { say: lines, polish: false };
  }

  if (/\b(what(?:'s| is) in (?:my )?cart|show (?:my )?cart)\b/.test(text)) {
    if (desk.lines.length === 0) return { say: "The cart is empty.", polish: false };
    const names = desk.lines
      .map((line) => {
        const product = productById(line.productId);
        if (!product) return line.productId;
        const offer = chosenOffer(product, line.store);
        return `${line.qty} × ${product.name} (${offer.store}, ${offer.ships})`;
      })
      .join(", ");
    return {
      say: `${names}. Total ${money(cartTotal(desk.lines))} of a ${money(desk.budget)} ceiling, in ${packageCount(desk.lines)} package${packageCount(desk.lines) === 1 ? "" : "s"}.`,
      polish: false,
    };
  }

  if (/\b(clear cart|empty (?:the )?cart)\b/.test(text)) {
    return { say: "Cart cleared. The ceiling stays.", lines: [], polish: false };
  }

  if (/\b(what can you|how do you|help)\b/.test(text)) {
    return {
      say: "Name the thing and a ceiling. I show every store, keep the cheap option and the fast one separate, and I refuse a cart that blows the ceiling. You can compare two, ask for a desk or a travel kit, name a day you need it, and refund a receipt.",
      polish: false,
    };
  }

  const raise = text.match(/raise ceiling to\s+(\d+(?:\.\d{1,2})?)\s+and add\s+([a-z0-9-]+)(?:\s+from\s+([a-z0-9]+))?/);
  if (raise) {
    const product = productById(raise[2]!);
    const ceiling = Number(raise[1]);
    if (!product) return { say: "I lost that item. Name it again.", polish: false };
    const offer = chosenOffer(product, raise[3] ?? undefined);
    return {
      say: `Ceiling is ${money(ceiling)}. ${product.name} is in the cart at ${money(offer.price)} from ${offer.store}, ${offer.ships}.`,
      budget: ceiling,
      lines: project(desk.lines, product.id, offer.store),
      focusId: product.id,
      focusStore: offer.store,
      polish: false,
    };
  }

  if (/\b(remove|drop|take off)\b/.test(text)) {
    const idMatch = text.match(/\b(?:remove|drop|take off)\s+([a-z0-9-]+)\b/);
    const product = (idMatch && productById(idMatch[1]!)) || scored(text)[0]?.product;
    if (product && desk.lines.some((line) => line.productId === product.id)) {
      const lines = desk.lines.filter((line) => line.productId !== product.id);
      return {
        say: `${product.name} is out. ${money(round(nextBudget - cartTotal(lines)))} left of ${money(nextBudget)}.`,
        lines,
        budget: stated ?? undefined,
        polish: false,
      };
    }
  }

  const addSet = text.match(/^add set\s+(.+)/);
  if (addSet) {
    const tokens = addSet[1]!
      .split(/\s+/)
      .map((token) => {
        const [id, store] = token.split("@");
        return { id: id ?? "", store };
      })
      .filter((token) => productById(token.id));
    let lines = desk.lines;
    const added: string[] = [];
    let blocked: { product: Product; offer: Offer } | null = null;
    for (const token of tokens) {
      const product = productById(token.id)!;
      if (lines.some((line) => line.productId === product.id)) {
        added.push(`${product.name} (already in the cart)`);
        continue;
      }
      const offer = token.store ? chosenOffer(product, token.store) : offerForAsk(product, limit).offer;
      const next = project(lines, product.id, offer.store);
      if (!within(next, nextBudget)) {
        blocked = { product, offer };
        break;
      }
      lines = next;
      added.push(`${product.name} (${offer.store}, ${offer.ships})`);
    }
    if (blocked && added.length === 0) {
      return { ...overCopy(blocked.product, blocked.offer, nextBudget, desk.lines), budget: stated ?? undefined, polish: false };
    }
    const packs = packageCount(lines);
    return {
      say: added.length
        ? `Added ${added.join(", ")}. Cart is ${money(cartTotal(lines))} of ${money(nextBudget)}, ${packs} package${packs === 1 ? "" : "s"}.`
        : "Nothing in that set fit.",
      lines,
      budget: stated ?? undefined,
      polish: false,
    };
  }

  if (/\b(checkout|check out|pay now|place the order|i(?:'|’)ll take it)\b/.test(text)) {
    if (desk.lines.length === 0) return { say: "Nothing to pay for yet.", polish: false };
    if (!within(desk.lines, desk.budget)) {
      return {
        say: `The cart is ${money(cartTotal(desk.lines))}, over ${money(desk.budget)}. Drop something or raise the ceiling first.`,
        polish: false,
      };
    }
    const packs = packageCount(desk.lines);
    return {
      say: `The cart is inside the ceiling, in ${packs} package${packs === 1 ? "" : "s"}. Use Pay when the stores and the days look right.`,
      polish: false,
    };
  }

  if (/^(yes|add it|take it|buy it|that one)\b/.test(text) && desk.focusId) {
    const product = productById(desk.focusId);
    if (product) {
      const offer = limit ? offerForAsk(product, limit).offer : chosenOffer(product, desk.focusStore ?? undefined);
      return addOne(product, offer, nextBudget, desk, stated, owned);
    }
  }

  if (/^(sooner|faster|the fast one)$/.test(text) && desk.focusId) {
    const product = productById(desk.focusId);
    if (product) return addOne(product, soonestOffer(product), nextBudget, desk, stated, owned);
  }

  const explicit = scored(text);

  if (/\bcompare\b/.test(text) && explicit.length >= 2) {
    const [first, second] = [explicit[0]!.product, explicit[1]!.product];
    const a = offerForAsk(first, limit);
    const b = offerForAsk(second, limit);
    const aFits = a.offer.price <= nextBudget + 0.001;
    const bFits = b.offer.price <= nextBudget + 0.001;
    const winner = aFits && bFits ? (a.offer.price <= b.offer.price ? first : second) : aFits ? first : bFits ? second : first;
    const winOffer = winner.id === first.id ? a.offer : b.offer;
    const gap = money(round(Math.abs(a.offer.price - b.offer.price)));
    const dateNote = limit ? ` You asked for ${limit} day${limit === 1 ? "" : "s"}.` : "";
    const fitNote = !aFits || !bFits ? ` Only what sits under ${money(nextBudget)} can be added.` : "";
    return {
      say: `${first.name}: ${first.facts[0]}, ${money(a.offer.price)} at ${a.offer.store} in ${a.offer.days} days${a.missed ? " (nothing is faster)" : ""}. ${second.name}: ${second.facts[0]}, ${money(b.offer.price)} at ${b.offer.store} in ${b.offer.days} days${b.missed ? " (nothing is faster)" : ""}. They are ${gap} apart.${dateNote} I would take ${winner.name}.${fitNote}`,
      products: [first.id, second.id],
      recommendId: winner.id,
      recommendStore: winOffer.store,
      stores: { [first.id]: a.offer.store, [second.id]: b.offer.store },
      focusId: winner.id,
      focusStore: winOffer.store,
      budget: stated ?? undefined,
      actions:
        winOffer.price <= nextBudget
          ? [{ label: `Add ${winner.name}`, run: `add ${winner.id} from ${winOffer.store}` }]
          : [
              {
                label: `Raise ceiling to ${money(winOffer.price)}`,
                run: `raise ceiling to ${winOffer.price} and add ${winner.id} from ${winOffer.store}`,
              },
            ],
      polish: true,
    };
  }

  const set = SETS.find((row) => row.test.test(text));
  if (set && explicit.length === 0) {
    const members = set.ids.map((id) => productById(id)!).filter(Boolean);
    let running = desk.lines;
    const picked: { product: Product; offer: Offer; missed: boolean }[] = [];
    const missed: { product: Product; offer: Offer }[] = [];
    for (const product of members) {
      const choice = offerForAsk(product, limit);
      if (choice.missed) {
        missed.push({ product, offer: choice.offer });
        continue;
      }
      if (running.some((line) => line.productId === product.id)) {
        picked.push({ product, offer: chosenOffer(product, running.find((line) => line.productId === product.id)?.store), missed: false });
        continue;
      }
      const next = project(running, product.id, choice.offer.store);
      if (!within(next, nextBudget)) {
        missed.push({ product, offer: choice.offer });
        continue;
      }
      running = next;
      picked.push({ product, offer: choice.offer, missed: false });
    }
    if (picked.length === 0) {
      const cheapest = [...members].sort((a, b) => bestOffer(a).price - bestOffer(b).price)[0]!;
      const choice = offerForAsk(cheapest, limit);
      return {
        say: `A full ${set.name} does not fit ${limit ? `a ${limit}-day window and ` : ""}${money(nextBudget)}. Closest piece is ${cheapest.name} at ${money(choice.offer.price)} from ${choice.offer.store}.`,
        products: [cheapest.id],
        recommendId: cheapest.id,
        recommendStore: choice.offer.store,
        stores: { [cheapest.id]: choice.offer.store },
        focusId: cheapest.id,
        focusStore: choice.offer.store,
        budget: stated ?? undefined,
        actions: within(project(desk.lines, cheapest.id, choice.offer.store), nextBudget)
          ? [{ label: `Add ${cheapest.name}`, run: `add ${cheapest.id} from ${choice.offer.store}` }]
          : overCopy(cheapest, choice.offer, nextBudget, desk.lines).actions,
        polish: true,
      };
    }
    const quote = round(picked.reduce((total, row) => total + row.offer.price, 0));
    const when = limit ? ` inside ${limit} days` : "";
    const leftOut = missed.length
      ? ` Left out ${missed.map((row) => `${row.product.name} (${money(row.offer.price)}, ${row.offer.ships})`).join(" and ")}.`
      : "";
    return {
      say: `${set.name[0]!.toUpperCase()}${set.name.slice(1)}${when} under ${money(nextBudget)}: ${picked.map((row) => `${row.product.name} ${money(row.offer.price)} at ${row.offer.store}, ${row.offer.ships}`).join("; ")}. Together ${money(quote)}.${leftOut}`,
      products: picked.map((row) => row.product.id),
      recommendId: picked[0]!.product.id,
      recommendStore: picked[0]!.offer.store,
      stores: Object.fromEntries(picked.map((row) => [row.product.id, row.offer.store])),
      focusId: picked[0]!.product.id,
      focusStore: picked[0]!.offer.store,
      budget: stated ?? undefined,
      actions: [{ label: "Add the set", run: `add set ${picked.map((row) => `${row.product.id}@${row.offer.store}`).join(" ")}` }],
      polish: true,
    };
  }

  const namedAdd = text.match(/\b(?:add|buy|take|get)\s+(?:the\s+|a\s+|an\s+)?(.+)/);
  if ((namedAdd && explicit.length) || (/^add\s+/.test(text) && explicit[0])) {
    const product = explicit[0]!.product;
    const picked = storeInText(product, text) ?? offerForAsk(product, limit).offer;
    return addOne(product, picked, nextBudget, desk, stated, owned);
  }

  const directAdd = text.match(/^add\s+([a-z0-9-]+)(?:\s+from\s+([a-z0-9]+))?$/);
  if (directAdd && productById(directAdd[1]!)) {
    const product = productById(directAdd[1]!)!;
    const offer = chosenOffer(product, directAdd[2] ?? undefined);
    return addOne(product, offer, nextBudget, desk, stated, owned);
  }

  if (explicit.length === 0) {
    const leftover = text
      .replace(/\b(under|below|max(?:imum)?|budget|ceiling|less than|within|up to|only|dollars?)\b/g, " ")
      .replace(/\$?\d+(?:\.\d{1,2})?/g, " ")
      .replace(/\b(the|a|an|for|me|please|show|find|need|want|i|some|something)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (leftover.length >= 3) {
      return {
        say: "Nothing in the aisle matches that. Asking Channel3.",
        webQuery: raw.trim(),
        budget: stated ?? undefined,
        polish: false,
      };
    }
    if (stated) {
      return {
        say: `Ceiling is ${money(stated)}. Tell me the job — earbuds, a desk, a cable — and I will only show what fits.`,
        budget: stated,
        polish: false,
      };
    }
    return {
      say: "Tell me the thing and the ceiling. For example: noise-cancelling earbuds under 80, or a cable in 3 days.",
      polish: false,
    };
  }

  const topScore = explicit[0]!.score;
  let picks = explicit.filter((row) => row.score >= topScore - 1).map((row) => row.product);
  if (explicit.length >= 2 && explicit[0]!.score > explicit[1]!.score + 1) picks = [explicit[0]!.product];

  const skippedOwned = picks.filter((product) => owned.has(product.id) && !/\b(again|another|second|replace)\b/.test(text));
  const fresh = picks.filter((product) => !skippedOwned.includes(product));
  const shown = (fresh.length ? fresh : picks).slice(0, 3);

  const priced = shown.map((product) => ({ product, ...offerForAsk(product, limit) }));
  const inside = priced.filter((row) => !row.missed && row.offer.price <= nextBudget + 0.001);
  const outside = priced.filter((row) => row.missed || row.offer.price > nextBudget + 0.001);
  const lead = inside[0] ?? priced[0]!;

  const ownedNote =
    skippedOwned.length && fresh.length
      ? ` You already bought ${skippedOwned.map((product) => product.name).join(" and ")}, so I left ${skippedOwned.length > 1 ? "them" : "it"} out.`
      : skippedOwned.length
        ? ` You already own ${skippedOwned.map((product) => product.name).join(" and ")}. Buy again only if you mean to.`
        : "";

  const alt = alternateOffer(lead.product, lead.offer, nextBudget);
  let say: string;
  if (inside.length === 0) {
    say = lead.missed
      ? `Nothing arrives in ${limit} days. Soonest ${lead.product.name} is ${lead.offer.days} days at ${money(lead.offer.price)} from ${lead.offer.store}.`
      : `Nothing in that ask is under ${money(nextBudget)}. ${lead.product.name} starts at ${money(lead.offer.price)} from ${lead.offer.store}.`;
  } else if (shown.length === 1) {
    say = `${describe(lead.product, lead.offer, nextBudget, alt)}${ownedNote}`;
  } else {
    say = `${priced
      .map((row) => `${row.product.name} ${money(row.offer.price)} at ${row.offer.store}, ${row.offer.ships}`)
      .join(". ")}. I would take ${lead.product.name}.${alt ? ` ${alt.note}` : ""}${ownedNote}`;
  }

  if (outside.length && inside.length) {
    say += ` I left out ${outside.map((row) => `${row.product.name} at ${money(row.offer.price)}`).join(" and ")}.`;
  }

  const actions: TurnAction[] = [];
  if (lead.offer.price <= nextBudget && within(project(desk.lines, lead.product.id, lead.offer.store), nextBudget)) {
    actions.push({ label: `Add ${lead.product.name}`, run: `add ${lead.product.id} from ${lead.offer.store}` });
    if (alt && alt.offer.store !== lead.offer.store && within(project(desk.lines, lead.product.id, alt.offer.store), nextBudget)) {
      actions.push({ label: alt.label, run: `add ${lead.product.id} from ${alt.offer.store}` });
    }
  } else if (lead.offer.price > nextBudget) {
    actions.push({
      label: `Raise ceiling to ${money(lead.offer.price)}`,
      run: `raise ceiling to ${lead.offer.price} and add ${lead.product.id} from ${lead.offer.store}`,
    });
  } else {
    actions.push(...overCopy(lead.product, lead.offer, nextBudget, desk.lines).actions);
  }

  return {
    say,
    products: shown.map((product) => product.id),
    recommendId: lead.product.id,
    recommendStore: lead.offer.store,
    stores: Object.fromEntries(priced.map((row) => [row.product.id, row.offer.store])),
    focusId: lead.product.id,
    focusStore: lead.offer.store,
    budget: stated ?? undefined,
    actions,
    polish: true,
  };
}

function alternateOffer(product: Product, chosen: Offer, budget: number): { offer: Offer; label: string; note: string } | null {
  const low = bestOffer(product);
  const soon = soonestOffer(product);
  if (soon.store !== chosen.store && soon.days < chosen.days && soon.price <= budget + 0.001) {
    const extra = round(soon.price - chosen.price);
    return {
      offer: soon,
      label: `Sooner · ${soon.ships} · ${money(soon.price)}`,
      note: `${soon.store} lands in ${soon.days} days for ${money(extra)} more.`,
    };
  }
  if (low.store !== chosen.store && low.price < chosen.price) {
    return {
      offer: low,
      label: `Cheaper · ${low.ships} · ${money(low.price)}`,
      note: `${low.store} is ${money(low.price)} but takes ${low.days} days, so it misses the window.`,
    };
  }
  return null;
}

function describe(product: Product, offer: Offer, budget: number, alt: { note: string } | null): string {
  const others = product.offers.filter((row) => row.store !== offer.store);
  const rest = !alt && others.length
    ? ` ${others.map((row) => `${row.store} is ${money(row.price)} in ${row.days} days`).join(", ")}.`
    : !alt && others.length === 0
      ? " That is the only store."
      : "";
  return `${product.name} is ${money(offer.price)} at ${offer.store}, ${offer.ships}, inside a ${money(budget)} ceiling.${rest}${alt ? ` ${alt.note}` : ""} Back in ${product.returnDays} days if it is wrong.`;
}

function addOne(
  product: Product,
  offer: Offer,
  budget: number,
  desk: DeskSnapshot,
  stated: number | null,
  owned: Set<string>,
): EngineResult {
  const existing = desk.lines.find((line) => line.productId === product.id);
  const next = project(desk.lines, product.id, offer.store);
  if (!within(next, budget)) {
    return { ...overCopy(product, offer, budget, desk.lines), budget: stated ?? undefined, focusId: product.id, focusStore: offer.store, polish: false };
  }
  const switching = Boolean(existing && (existing.store ?? bestOffer(product).store) !== offer.store);
  const qty = next.find((line) => line.productId === product.id)?.qty ?? 1;
  const already = owned.has(product.id);
  const missing = pairAction(product, next, budget, owned);
  const packs = packageCount(next);
  const verb = switching ? `Switched to ${offer.store}` : already ? "Buying another" : "Added";
  return {
    say: `${verb}. ${product.name} at ${money(offer.price)} from ${offer.store}, ${offer.ships}${qty > 1 ? `, now ${qty}` : ""}. Cart ${money(cartTotal(next))} of ${money(budget)}, ${packs} package${packs === 1 ? "" : "s"}.${pairSentence(missing)}`,
    lines: next,
    focusId: product.id,
    focusStore: offer.store,
    budget: stated ?? undefined,
    actions: missing ? [missing] : undefined,
    polish: false,
  };
}

export function newTurn(role: Turn["role"], text: string, extra?: Partial<Turn>): Turn {
  return { id: uid(role), role, text, ...extra };
}

export function buildOrder(lines: CartLine[]): Order {
  const detailed: OrderLine[] = lines.map((line) => {
    const product = productById(line.productId)!;
    const offer = chosenOffer(product, line.store);
    return {
      productId: product.id,
      name: product.name,
      qty: line.qty,
      store: offer.store,
      price: offer.price,
      ships: offer.ships,
    };
  });
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return {
    id: `C-${stamp}`,
    created: Date.now(),
    lines: detailed,
    total: cartTotal(lines),
    status: "paid",
  };
}
