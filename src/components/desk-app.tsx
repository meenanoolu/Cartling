import { FormEvent, useEffect, useRef, useState } from "react";
import { PanelLeft, ShoppingBag, X } from "lucide-react";
import { PRODUCTS, money, productById } from "@/lib/catalog";
import { cartTotal, type ShipTo } from "@/lib/desk-engine";
import { polishReply } from "@/lib/voice";
import { useDesk } from "@/lib/use-desk";
import { ProductCard } from "@/components/product-card";
import { CartPanel } from "@/components/cart-panel";
import { WebCard } from "@/components/web-card";
import { adviseStore, capturePaypal, paypalStatus, refundPaypal, runAgent, searchWeb, serviceHealth, startCheckout } from "@/lib/paypal";
import type { PayConfirm } from "@/lib/paypal";

const STARTERS = [
  { label: "Earbuds and a cable before Friday", run: "earbuds and a usb-c cable in 3 days under 80" },
  { label: "Cable in 3 days", run: "USB-C cable in 3 days" },
  { label: "Mug under $20", run: "Ceramic mug under 20" },
];

export function DeskApp() {
  const budget = useDesk((s) => s.budget);
  const lines = useDesk((s) => s.lines);
  const orders = useDesk((s) => s.orders);
  const turns = useDesk((s) => s.turns);
  const chats = useDesk((s) => s.chats);
  const activeId = useDesk((s) => s.activeId);
  const setBudget = useDesk((s) => s.setBudget);
  const ensureChats = useDesk((s) => s.ensureChats);
  const newChat = useDesk((s) => s.newChat);
  const openChat = useDesk((s) => s.openChat);
  const send = useDesk((s) => s.send);
  const replaceTurn = useDesk((s) => s.replaceTurn);
  const setQty = useDesk((s) => s.setQty);
  const setStore = useDesk((s) => s.setStore);
  const note = useDesk((s) => s.note);
  const recordPaid = useDesk((s) => s.recordPaid);
  const refund = useDesk((s) => s.refund);
  const shipTo = useDesk((s) => s.shipTo);
  const setShipTo = useDesk((s) => s.setShipTo);
  const setReady = useDesk((s) => s.setReady);
  const [draft, setDraft] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [aisle, setAisle] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [health, setHealth] = useState<{ paypal: boolean; grok: boolean; channel3: boolean } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const total = cartTotal(lines);
  const owned = new Set(
    orders.filter((order) => order.status === "paid").flatMap((order) => order.lines.map((line) => line.productId)),
  );
  const inCart = new Set(lines.map((line) => line.productId));

  useEffect(() => {
    let cancel = false;
    void Promise.resolve(useDesk.persist.rehydrate()).finally(async () => {
      ensureChats();
      setReady(true);
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      if (params.get("paypal") === "cancel") {
        window.history.replaceState({}, "", "/");
        note("PayPal checkout was cancelled. The cart is still here.");
        return;
      }
      if (params.get("paypal") === "return" && token) {
        window.history.replaceState({}, "", "/");
        const captured = await capturePaypal(token);
        if (cancel) return;
        if (captured.ok && captured.order) recordPaid(captured.order, Boolean(captured.clearCart));
        else note(captured.error || "PayPal did not capture that order.");
      }
    });
    void serviceHealth().then((next) => {
      if (!cancel) setHealth(next);
    });
    return () => {
      cancel = true;
    };
  }, [ensureChats, note, recordPaid, setReady]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  async function submit(text: string, display?: string) {
    const result = send(text, display);
    setDraft("");
    setAisle(false);
    if (result.needAddress) {
      setAddressOpen(true);
      setPendingAsk(text);
      return;
    }
    if (result.paypalRefundId && result.turnId) {
      setBusy("Sending that back through PayPal");
      const refunded = await refundPaypal(result.paypalRefundId);
      if (refunded.ok) {
        refund(result.paypalRefundId, true);
        replaceTurn(result.turnId, `Refunded ${result.paypalRefundId} through PayPal.`, {
          steps: ["Asked PayPal to refund the capture", "PayPal status REFUNDED"],
        });
      } else replaceTurn(result.turnId, refunded.error || "PayPal did not refund that.");
      setBusy(null);
      return;
    }
    if (result.statusIds && result.turnId) {
      setBusy("Asking PayPal");
      const lines: string[] = [];
      const steps = ["Asked PayPal for the order status"];
      for (const id of result.statusIds) {
        const status = await paypalStatus(id);
        if (status.ok && status.label) {
          lines.push(`${id} is ${status.label}`);
          steps.push(`${id} is ${status.label}`);
        } else {
          lines.push(`${id} - ${status.error || "PayPal did not return a status"}`);
        }
      }
      replaceTurn(result.turnId, lines.join(". "), { steps });
      setBusy(null);
      return;
    }
    if ((result.webQuery || (result.polish && result.recommendId)) && result.turnId) {
      setBusy("Asking Grok");
      const agent = await runAgent({ message: text, budget: useDesk.getState().budget, intent: "shop" });
      if (agent.ok && agent.text && agent.steps?.length) {
        const existing = useDesk.getState().turns.find((row) => row.id === result.turnId);
        const hasCards = Boolean(agent.hits?.length || agent.productIds?.length || existing?.productIds?.length);
        const dump = agent.text.length > 220 && !agent.confirm;
        if (hasCards || !dump) {
          const spoken = hasCards && dump
            ? agent.hits?.length
              ? "Channel3 returned these. Open Description on a card, then pick a merchant."
              : "These fit. The price is the catalog price. PayPal stays closed until you say yes."
            : agent.text;
          const localIds = existing?.productIds ?? [];
          const agentIds = agent.productIds ?? [];
          const productIds = localIds.length > agentIds.length ? localIds : agentIds;
          const confirm = agent.confirm;
          replaceTurn(result.turnId, spoken, {
            steps: agent.steps,
            ...(agent.hits?.length ? { hits: agent.hits } : {}),
            ...(productIds.length ? { productIds } : {}),
            recommendId: agent.recommendId ?? existing?.recommendId,
            recommendStore: agent.store ?? existing?.recommendStore,
            stores: agent.recommendId && agent.store ? { ...(existing?.stores ?? {}), [agent.recommendId]: agent.store } : existing?.stores,
            confirm,
            actions: confirm
              ? [{ label: "Yes, open PayPal", run: "confirm-paypal" }]
              : agent.recommendId && agent.store
                ? [{ label: "Yes, open PayPal", run: "stage-paypal" }]
                : undefined,
          });
          setBusy(null);
          return;
        }
      }
      setBusy(null);
    }
    if (result.webQuery && result.turnId) {
      setBusy("Asking Channel3");
      const found = await searchWeb(result.webQuery, useDesk.getState().budget);
      if (found.ok && found.results.length) {
        replaceTurn(result.turnId, "Channel3 found these. PayPal charges the price on the card.", {
          hits: found.results,
          steps: ["Nothing in the aisle matched", "Asked Channel3", "Kept the price Channel3 returned"],
        });
      } else replaceTurn(result.turnId, found.error || "Channel3 had nothing under that ceiling.");
      setBusy(null);
      return;
    }
    if (!result.polish || !result.turnId) return;
    setBusy("Asking Grok");
    try {
      if (result.recommendId) {
        const advice = await adviseStore({ productId: result.recommendId, brief: result.brief, ask: text });
        if (advice.ok && advice.text && advice.store) {
          const previous = result.stores?.[result.recommendId];
          const turn = useDesk.getState().turns.find((row) => row.id === result.turnId);
          replaceTurn(result.turnId, advice.text, {
            recommendStore: advice.store,
            stores: { ...result.stores, [result.recommendId]: advice.store },
            steps: [...(turn?.steps ?? ["Checked the catalog"]), `Grok picked ${advice.store} from the allowed stores`],
            actions: turn?.actions?.map((action) =>
              previous && action.run === `add ${result.recommendId} from ${previous}`
                ? { ...action, run: `add ${result.recommendId} from ${advice.store}` }
                : action,
            ),
          });
          return;
        }
      }
      const polished = await polishReply({ data: { brief: result.brief } });
      if (polished.ok && polished.text) replaceTurn(result.turnId, polished.text);
    } catch {
      /* the desk note already stands */
    } finally {
      setBusy(null);
    }
  }

  async function confirmPay(confirm: PayConfirm) {
    const state = useDesk.getState();
    if (!state.shipTo) {
      setAddressOpen(true);
      note("PayPal needs a ship-to address before it can open.");
      return;
    }
    setPaying(true);
    const opened = await startCheckout(
      confirm.webId
        ? { webId: confirm.webId, budget: state.budget, address: state.shipTo }
        : {
            lines: [{ productId: confirm.productId || "", qty: 1, store: confirm.store }],
            budget: state.budget,
            address: state.shipTo,
          },
    );
    if (opened.approveUrl) {
      if (opened.orderId) note(`Opened PayPal order ${opened.orderId}.`, ["create_paypal_order", opened.orderId]);
      window.location.href = opened.approveUrl;
      return;
    }
    setPaying(false);
    note(opened.error || "PayPal did not open.");
  }

  async function stageThenPay(turnId: string) {
    const turn = useDesk.getState().turns.find((row) => row.id === turnId);
    if (!turn?.recommendId || !turn.recommendStore) return;
    setBusy("Asking Grok");
    const agent = await runAgent({
      message: `Open PayPal for ${turn.recommendId} from ${turn.recommendStore}`,
      budget: useDesk.getState().budget,
      intent: "pay",
    });
    setBusy(null);
    if (!agent.ok || !agent.confirm) {
      note(agent.error || "Grok did not call create_paypal_order.");
      return;
    }
    replaceTurn(turnId, agent.text || turn.text, {
      steps: [...(turn.steps ?? []), ...(agent.steps ?? ["create_paypal_order"])],
      confirm: agent.confirm,
    });
    await confirmPay(agent.confirm);
  }

  async function checkout() {
    const state = useDesk.getState();
    if (!state.shipTo) {
      setAddressOpen(true);
      note("PayPal needs a ship-to address before it can open.");
      return;
    }
    setPaying(true);
    const opened = await startCheckout({
      lines: state.lines.map((line) => ({ productId: line.productId, qty: line.qty, store: line.store })),
      budget: state.budget,
      address: state.shipTo,
    });
    if (opened.approveUrl) {
      if (opened.orderId) note(`Opened PayPal order ${opened.orderId}.`, ["Created a PayPal sandbox order", opened.orderId]);
      window.location.href = opened.approveUrl;
      return;
    }
    setPaying(false);
    note(opened.error || "PayPal did not open.");
  }

  async function payWeb(id: string) {
    const state = useDesk.getState();
    if (!state.shipTo) {
      setAddressOpen(true);
      note("PayPal needs a ship-to address before it can open.");
      return;
    }
    setPaying(true);
    const opened = await startCheckout({ webId: id, budget: state.budget, address: state.shipTo });
    if (opened.approveUrl) {
      if (opened.orderId) note(`Opened PayPal order ${opened.orderId}.`, ["Created a PayPal sandbox order", opened.orderId]);
      window.location.href = opened.approveUrl;
      return;
    }
    setPaying(false);
    note(opened.error || "PayPal did not open.");
  }

  async function refundOrder(id: string) {
    const order = useDesk.getState().orders.find((row) => row.id === id);
    if (order?.paypalOrderId) {
      setBusy("Sending that back through PayPal");
      const refunded = await refundPaypal(order.paypalOrderId);
      setBusy(null);
      if (!refunded.ok) {
        note(refunded.error || "PayPal did not refund that.");
        return;
      }
    }
    refund(id);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    void submit(text);
  }

  const cart = (
    <CartPanel
      budget={budget}
      lines={lines}
      orders={orders}
      onQty={setQty}
      onStore={setStore}
      onPay={() => {
        void checkout();
      }}
      onRefund={(id) => {
        void refundOrder(id);
      }}
      paying={paying}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      <header className="border-b border-line">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={chatsOpen ? "Hide chats" : "Show chats"}
              aria-expanded={chatsOpen}
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-sheet"
              onClick={() => setChatsOpen((open) => !open)}
            >
              <PanelLeft className="size-5" aria-hidden="true" />
            </button>
            <span className="grid size-10 place-items-center rounded-xl bg-brass text-on-brass">
              <ShoppingBag className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-2xl leading-none font-medium">Cartling</p>
              <p className="mt-1 hidden text-sm text-muted sm:block">
                {health?.paypal ? "PayPal sandbox is connected" : "Cheap or fast, decided before you pay."}
                {health?.grok ? " - Grok picks the store" : ""}
                {health?.channel3 ? " - Channel3 searches past the aisle" : ""}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Ceiling</span>
            <span className="text-muted">$</span>
            <input
              type="number"
              min={10}
              max={2000}
              inputMode="decimal"
              value={budget}
              aria-label="Budget ceiling in dollars"
              onChange={(event) => setBudget(Number(event.target.value))}
              className="w-24 rounded-xl border border-line bg-sheet px-3 py-2 text-base tabular-nums"
            />
          </label>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {chatsOpen ? (
          <button type="button" aria-label="Close chats" className="absolute inset-0 z-20 bg-ink/30 md:hidden" onClick={() => setChatsOpen(false)} />
        ) : null}
        <aside className={`${chatsOpen ? "absolute inset-y-0 left-0 z-30 flex w-64 md:static" : "hidden"} min-h-0 shrink-0 flex-col border-r border-line bg-sheet`}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <button
              type="button"
              className="min-h-11 rounded-xl bg-ink px-4 text-sm font-medium text-on-brass"
              onClick={() => {
                setAddressOpen(false);
                setPendingAsk(null);
                newChat();
                if (window.innerWidth < 768) setChatsOpen(false);
              }}
            >
              New chat
            </button>
            <button type="button" className="min-h-11 rounded-xl border border-line bg-paper px-4 text-left text-sm" onClick={() => setAddressOpen((open) => !open)}>
              {shipTo ? `Ship to ${shipTo.city}` : "Add address"}
            </button>
          </div>
          <nav aria-label="Chats" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                aria-current={chat.id === activeId ? "true" : undefined}
                className={`min-h-11 rounded-xl px-3 py-2 text-left text-sm ${chat.id === activeId ? "bg-paper font-medium" : ""}`}
                onClick={() => {
                  setAddressOpen(false);
                  setPendingAsk(null);
                  openChat(chat.id);
                  if (window.innerWidth < 768) setChatsOpen(false);
                }}
              >
                <span className="line-clamp-2">{chat.title}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="grid w-full min-w-0 min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
            {turns.length === 0 ? (
              <div className="flex flex-col gap-5">
                <h1 className="max-w-xl font-display text-4xl leading-tight font-medium sm:text-5xl">
                  Before Friday. Under $80.
                </h1>
                <p className="max-w-xl text-lg leading-relaxed text-muted">
                  Maya needs earbuds and a cable. The cheap store takes five days. The fast one may not fit the ceiling. The total is not in any tab.
                </p>
                <ul className="max-w-xl list-disc pl-5 text-sm leading-relaxed text-muted">
                  <li>The ceiling holds. Over it, PayPal does not open.</li>
                  <li>A day is that store's handoff time, not a guess.</li>
                  <li>Grok can pick a store. It cannot type the price.</li>
                  <li>PayPal stays closed until you say yes.</li>
                </ul>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((prompt) => (
                    <button
                      key={prompt.run}
                      type="button"
                      onClick={() => void submit(prompt.run, prompt.label)}
                      className="min-h-11 rounded-full border border-line bg-sheet px-4 py-2 text-left text-sm"
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((turn) => (
              <div key={turn.id} className={turn.role === "you" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    turn.role === "you"
                      ? "max-w-lg rounded-card bg-ink px-4 py-3 text-on-brass"
                      : "w-full max-w-3xl"
                  }
                >
                  <p className={turn.role === "you" ? "leading-relaxed" : "max-w-2xl leading-relaxed"}>{turn.text}</p>
                  {turn.role === "cartling" && turn.steps?.length ? (
                    <ol className="mt-2 flex max-w-2xl list-decimal flex-col gap-1 pl-5 text-sm text-muted">
                      {turn.steps.map((step, index) => (
                        <li key={`${turn.id}-${index}`}>{step}</li>
                      ))}
                    </ol>
                  ) : null}
                  {turn.actions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {turn.actions.map((action) => (
                        <button
                          key={action.run}
                          type="button"
                          onClick={() => {
                            if (action.run === "confirm-paypal" && turn.confirm) {
                              void confirmPay(turn.confirm);
                              return;
                            }
                            if (action.run === "stage-paypal") {
                              void stageThenPay(turn.id);
                              return;
                            }
                            void submit(action.run, action.label);
                          }}
                          className="min-h-11 rounded-full border border-line bg-sheet px-4 text-sm font-medium"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {turn.productIds?.length ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {turn.productIds.map((id) => {
                        const product = productById(id);
                        if (!product) return null;
                        return (
                          <ProductCard
                            key={`${turn.id}-${id}`}
                            product={product}
                            recommended={turn.recommendId === id}
                            preferStore={turn.stores?.[id] ?? (turn.recommendId === id ? turn.recommendStore : undefined)}
                            owned={owned.has(id)}
                            inCart={inCart.has(id)}
                            onAdd={(store) => {
                              const offer = product.offers.find((row) => row.store === store);
                              void submit(`add ${id} from ${store}`, `Add ${product.name}${offer ? ` · ${offer.store}` : ""}`);
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                  {turn.hits?.length ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {turn.hits.map((hit) => (
                        <WebCard key={hit.id} hit={hit} onPay={(id) => void payWeb(id)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? <p className="text-sm text-muted">{busy}...</p> : null}

            {aisle ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-2xl font-medium">The aisle</h2>
                  <button type="button" className="min-h-11 text-sm text-muted" onClick={() => setAisle(false)}>
                    Hide
                  </button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {PRODUCTS.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      recommended={false}
                      owned={owned.has(product.id)}
                      inCart={inCart.has(product.id)}
                      onAdd={(store) => {
                        const offer = product.offers.find((row) => row.store === store);
                        void submit(`add ${product.id} from ${store}`, `Add ${product.name}${offer ? ` · ${offer.store}` : ""}`);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <button type="button" className="self-start min-h-11 text-sm font-medium" onClick={() => setAisle(true)}>
                Browse the aisle
              </button>
            )}
          </div>

          {addressOpen ? (
            <ShipForm
              current={shipTo}
              onSave={(next) => {
                setShipTo(next);
                setAddressOpen(false);
                const ask = pendingAsk;
                setPendingAsk(null);
                if (ask) void submit(ask);
              }}
            />
          ) : null}

          <form onSubmit={onSubmit} className="relative z-10 flex shrink-0 gap-2 border-t border-line bg-paper px-4 py-3">
            <label className="sr-only" htmlFor="ask">
              Ask Cartling
            </label>
            <input
              id="ask"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Earbuds under 80, or a cable in 3 days"
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-sheet px-4 text-base"
            />
            <button type="submit" className="min-h-12 shrink-0 rounded-xl bg-ink px-5 font-medium text-on-brass">
              Send
            </button>
          </form>
          <div className="border-t border-line bg-sheet px-4 py-3 lg:hidden">
            <button type="button" className="flex min-h-12 w-full items-center justify-between" onClick={() => setCartOpen(true)}>
              <span className="inline-flex items-center gap-2 font-medium">
                <ShoppingBag className="size-4" aria-hidden="true" />
                Cart
              </span>
              <span className="tabular-nums">{money(total)}</span>
            </button>
          </div>
        </section>

        <aside className="hidden min-h-0 w-80 shrink-0 overflow-y-auto border-l border-line lg:block">
          <div className="p-4">{cart}</div>
        </aside>
      </div>

      {cartOpen ? (
        <div className="fixed inset-0 z-20 flex flex-col bg-paper lg:hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display text-2xl font-medium">Cart</p>
            <button type="button" aria-label="Close cart" className="grid size-11 place-items-center" onClick={() => setCartOpen(false)}>
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <CartPanel
              budget={budget}
              lines={lines}
              orders={orders}
              onQty={setQty}
              onStore={setStore}
              showHeading={false}
              onPay={() => {
                void checkout();
              }}
              onRefund={(id) => {
                void refundOrder(id);
              }}
              paying={paying}
            />
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}

function ShipForm({ current, onSave }: { current: ShipTo | null; onSave: (next: ShipTo) => void }) {
  const [name, setName] = useState(current?.name ?? "");
  const [line1, setLine1] = useState(current?.line1 ?? "");
  const [city, setCity] = useState(current?.city ?? "");
  const [region, setRegion] = useState(current?.region ?? "");
  const [postal, setPostal] = useState(current?.postal ?? "");
  const [country, setCountry] = useState(current?.country ?? "US");

  function save(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: name.trim(),
      line1: line1.trim(),
      city: city.trim(),
      region: region.trim(),
      postal: postal.trim(),
      country: country.trim().toUpperCase(),
    };
    if (!next.name || !next.line1 || !next.city || !next.region || next.postal.length < 3 || next.country.length !== 2) return;
    onSave(next);
  }

  return (
    <form onSubmit={save} className="grid shrink-0 gap-3 border-t border-line bg-sheet px-4 py-3 sm:grid-cols-2">
      <p className="sm:col-span-2 text-sm text-muted">PayPal uses this address. A day count is still the store's handoff time.</p>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Street
        <input required autoComplete="address-line1" value={line1} onChange={(event) => setLine1(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        City
        <input required autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Region
        <input required autoComplete="address-level1" placeholder="CA" value={region} onChange={(event) => setRegion(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Postal code
        <input required autoComplete="postal-code" value={postal} onChange={(event) => setPostal(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Country
        <input required autoComplete="country" maxLength={2} value={country} onChange={(event) => setCountry(event.target.value)} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
      </label>
      <button type="submit" className="min-h-11 rounded-xl bg-ink px-4 font-medium text-on-brass sm:col-span-2">
        Save address
      </button>
    </form>
  );
}
