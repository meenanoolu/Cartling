import { Minus, Plus } from "lucide-react";
import { chosenOffer, money, productById, soonestOffer, bestOffer } from "@/lib/catalog";
import { cartTotal, type CartLine, type Order } from "@/lib/desk-engine";

export function CartPanel({
  budget,
  lines,
  orders,
  onQty,
  onStore,
  onPay,
  onRefund,
  showHeading = true,
  paying = false,
}: {
  budget: number;
  lines: CartLine[];
  orders: Order[];
  onQty: (productId: string, qty: number) => void;
  onStore: (productId: string, store: string) => boolean;
  onPay: () => void;
  onRefund: (id: string) => void;
  showHeading?: boolean;
  paying?: boolean;
}) {
  const total = cartTotal(lines);
  const over = total > budget + 0.001;
  const ratio = budget > 0 ? Math.min(1, total / budget) : 0;
  const groups = groupLines(lines);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          {showHeading ? <h2 className="font-display text-2xl font-medium">Cart</h2> : <h2 className="sr-only">Cart</h2>}
          <p className="text-sm tabular-nums text-muted">
            {money(total)} / {money(budget)}
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className={`h-full ${over ? "bg-alert" : "bg-brass"}`} style={{ width: `${ratio * 100}%` }} />
        </div>
        {lines.length > 0 ? (
          <p className="text-sm text-muted">
            {groups.length} package{groups.length === 1 ? "" : "s"}. Each store ships its own box, at the price already on the line.
          </p>
        ) : null}
        {over ? (
          <p className="rounded-xl bg-alert-soft px-3 py-2 text-sm text-alert">
            Over the ceiling by {money(total - budget)}. Drop a line or raise it before paying.
          </p>
        ) : null}
        {lines.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            Empty. Ask for a thing, a day you need it, or a set. The total cannot pass the ceiling.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.store} className="flex flex-col gap-3">
                <p className="text-sm font-medium">{group.store}</p>
                <ul className="flex flex-col gap-3">
                  {group.lines.map((line) => {
                    const product = productById(line.productId);
                    if (!product) return null;
                    const offer = chosenOffer(product, line.store);
                    const nextQty = line.qty + 1;
                    const bumped = lines.map((row) => (row.productId === line.productId ? { ...row, qty: nextQty } : row));
                    const canGrow = cartTotal(bumped) <= budget + 0.001;
                    const low = bestOffer(product);
                    const soon = soonestOffer(product);
                    const others = product.offers.filter((row) => row.store !== offer.store);
                    return (
                      <li key={line.productId} className="flex gap-3">
                        <img src={product.image} alt="" className="size-16 rounded-xl object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{product.name}</p>
                          <p className="text-sm text-muted">
                            {money(offer.price)} · {offer.ships}
                            {offer.store === low.store ? " · lowest" : ""}
                            {offer.store === soon.store && soon.store !== low.store ? " · soonest" : ""}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              aria-label={`Fewer ${product.name}`}
                              className="grid size-11 place-items-center rounded-xl border border-line"
                              onClick={() => onQty(line.productId, line.qty - 1)}
                            >
                              <Minus className="size-4" aria-hidden="true" />
                            </button>
                            <span className="w-6 text-center tabular-nums">{line.qty}</span>
                            <button
                              type="button"
                              aria-label={`More ${product.name}`}
                              disabled={!canGrow}
                              className="grid size-11 place-items-center rounded-xl border border-line disabled:opacity-40"
                              onClick={() => onQty(line.productId, line.qty + 1)}
                            >
                              <Plus className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                          {others.map((row) => {
                            const swapped = lines.map((item) =>
                              item.productId === line.productId ? { ...item, store: row.store } : item,
                            );
                            const fits = cartTotal(swapped) <= budget + 0.001;
                            if (!fits) {
                              return (
                                <p key={row.store} className="mt-2 text-sm text-muted">
                                  {row.store} is {money(row.price)} and would break the ceiling.
                                </p>
                              );
                            }
                            return (
                              <button
                                key={row.store}
                                type="button"
                                className="mt-1 min-h-11 text-left text-sm font-medium"
                                onClick={() => onStore(line.productId, row.store)}
                              >
                                Switch to {row.store} · {row.ships} · {money(row.price)}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={lines.length === 0 || over || paying}
          onClick={onPay}
          className="min-h-11 rounded-xl bg-brass px-4 py-3 font-medium text-on-brass disabled:opacity-40"
        >
          {paying ? "Opening PayPal" : lines.length === 0 ? "Nothing to pay" : `Pay ${money(total)} with PayPal`}
        </button>
        <p className="text-sm leading-relaxed text-muted">
          PayPal sandbox charges this exact total. The server prices every line. A refund goes back through PayPal.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-2xl font-medium">Your orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted">Paid and refunded orders stay here, including after you start a new chat.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...orders].reverse().map((order) => (
              <li key={order.id} className="rounded-xl border border-line px-3 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{order.status === "paid" ? "Paid" : "Refunded"}</p>
                  <p className="text-sm tabular-nums">{money(order.total)}</p>
                </div>
                <p className="text-sm text-muted">
                  <time dateTime={new Date(order.created).toISOString()}>{when(order.created)}</time>
                  {" · "}
                  {order.id}
                </p>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                  {order.lines.map((line) => (
                    <li key={`${order.id}-${line.productId}`}>
                      {line.qty} × {line.name} · {line.store} · {line.ships}
                    </li>
                  ))}
                </ul>
                {order.status === "paid" ? (
                  <button type="button" className="mt-2 min-h-11 text-sm font-medium text-alert" onClick={() => onRefund(order.id)}>
                    Refund {money(order.total)}
                  </button>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    {order.paypalOrderId ? "The refund went back through PayPal." : "This order was refunded."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function when(created: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(created);
}

function groupLines(lines: CartLine[]): { store: string; lines: CartLine[] }[] {
  const groups: { store: string; lines: CartLine[] }[] = [];
  for (const line of lines) {
    const product = productById(line.productId);
    if (!product) continue;
    const offer = chosenOffer(product, line.store);
    const found = groups.find((group) => group.store === offer.store);
    if (found) found.lines.push(line);
    else groups.push({ store: offer.store, lines: [line] });
  }
  return groups;
}
