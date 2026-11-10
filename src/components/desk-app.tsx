import { FormEvent, useEffect, useRef, useState } from "react";
import { ShoppingBag, X } from "lucide-react";
import { PRODUCTS, money, productById } from "@/lib/catalog";
import { cartTotal } from "@/lib/desk-engine";
import { polishReply } from "@/lib/voice";
import { useDesk } from "@/lib/use-desk";
import { ProductCard } from "@/components/product-card";
import { CartPanel } from "@/components/cart-panel";

const STARTERS = [
  { label: "Earbuds under $80", run: "Noise-cancelling earbuds under 80" },
  { label: "Cable in 3 days", run: "USB-C cable in 3 days" },
  { label: "Desk setup under $60", run: "Desk setup under 60" },
  { label: "Travel kit in 3 days", run: "Travel kit in 3 days under 130" },
  { label: "Compare buds and headphones", run: "Compare earbuds and headphones" },
];

export function DeskApp() {
  const budget = useDesk((s) => s.budget);
  const lines = useDesk((s) => s.lines);
  const orders = useDesk((s) => s.orders);
  const turns = useDesk((s) => s.turns);
  const setBudget = useDesk((s) => s.setBudget);
  const send = useDesk((s) => s.send);
  const replaceTurn = useDesk((s) => s.replaceTurn);
  const setQty = useDesk((s) => s.setQty);
  const setStore = useDesk((s) => s.setStore);
  const pay = useDesk((s) => s.pay);
  const refund = useDesk((s) => s.refund);
  const setReady = useDesk((s) => s.setReady);
  const [draft, setDraft] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [aisle, setAisle] = useState(false);
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const total = cartTotal(lines);
  const owned = new Set(
    orders.filter((order) => order.status === "paid").flatMap((order) => order.lines.map((line) => line.productId)),
  );
  const inCart = new Set(lines.map((line) => line.productId));

  useEffect(() => {
    void Promise.resolve(useDesk.persist.rehydrate()).finally(() => setReady(true));
  }, [setReady]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns, busy]);

  async function submit(text: string, display?: string) {
    const result = send(text, display);
    setDraft("");
    setAisle(false);
    if (!result.polish || !result.turnId) return;
    setBusy(true);
    try {
      const polished = await polishReply({ data: { brief: result.brief } });
      if (polished.ok && polished.text) replaceTurn(result.turnId, polished.text);
    } catch {
      /* the desk note already stands */
    } finally {
      setBusy(false);
    }
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
        pay();
        setCartOpen(false);
      }}
      onRefund={refund}
    />
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brass text-on-brass">
              <ShoppingBag className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-2xl leading-none font-medium">Cartling</p>
              <p className="mt-1 hidden text-sm text-muted sm:block">Cheap or fast, decided before you pay.</p>
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

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 flex-col">
          <div ref={threadRef} className="flex flex-1 flex-col gap-5 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
            {turns.length === 0 ? (
              <div className="flex flex-col gap-5">
                <h1 className="max-w-xl font-display text-4xl leading-tight font-medium sm:text-5xl">
                  The annoying parts, handled before you pay.
                </h1>
                <p className="max-w-xl text-lg leading-relaxed text-muted">
                  One desk instead of a pile of tabs. The cheap store and the fast store stay separate. The ceiling refuses the extra, and a refund forgets you owned it.
                </p>
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
                  {turn.actions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {turn.actions.map((action) => (
                        <button
                          key={action.run}
                          type="button"
                          onClick={() => void submit(action.run, action.label)}
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
                </div>
              </div>
            ))}
            {busy ? <p className="text-sm text-muted">Rewriting that more cleanly…</p> : null}

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

          <form onSubmit={onSubmit} className="sticky bottom-20 z-10 mt-4 flex gap-2 bg-paper py-3 lg:bottom-0">
            <label className="sr-only" htmlFor="ask">
              Ask Cartling
            </label>
            <input
              id="ask"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Earbuds under 80, a cable in 3 days, or refund the last order"
              className="min-h-12 flex-1 rounded-xl border border-line bg-sheet px-4 text-base"
            />
            <button type="submit" className="min-h-12 rounded-xl bg-ink px-5 font-medium text-on-brass">
              Send
            </button>
          </form>
        </section>

        <aside className="hidden lg:block">
          <div className="sticky top-5 rounded-card border border-line bg-sheet p-4">{cart}</div>
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-line bg-sheet p-3 lg:hidden">
        <button type="button" className="flex min-h-12 w-full items-center justify-between px-2" onClick={() => setCartOpen(true)}>
          <span className="inline-flex items-center gap-2 font-medium">
            <ShoppingBag className="size-4" aria-hidden="true" />
            Cart
          </span>
          <span className="tabular-nums">{money(total)}</span>
        </button>
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
                pay();
                setCartOpen(false);
              }}
              onRefund={refund}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
