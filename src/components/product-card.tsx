import { bestOffer, chosenOffer, money, soonestOffer, type Product } from "@/lib/catalog";

export function ProductCard({
  product,
  recommended,
  owned,
  inCart,
  preferStore,
  onAdd,
}: {
  product: Product;
  recommended: boolean;
  owned: boolean;
  inCart?: boolean;
  preferStore?: string;
  onAdd: (store: string) => void;
}) {
  const low = bestOffer(product);
  const soon = soonestOffer(product);
  const primary = preferStore ? chosenOffer(product, preferStore) : low;
  const alt = primary.store === soon.store ? (primary.store === low.store ? null : low) : soon;
  const offers = [...product.offers].sort((a, b) => a.price - b.price || a.days - b.days);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-sheet">
      <div className="relative h-40 shrink-0 overflow-hidden bg-white">
        <img src={product.image} alt="" className="absolute inset-0 h-full w-full object-contain" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl leading-tight font-medium">{product.name}</h3>
          <p className="shrink-0 text-lg font-medium tabular-nums">{money(primary.price)}</p>
        </div>
        <p className="text-sm leading-relaxed text-muted">{product.blurb}</p>
        <p className="text-sm text-muted">Sample store. The desk sets this price.</p>
        <ul className="flex flex-col gap-1 text-sm">
          {offers.map((row) => {
            const tags = [
              row.store === low.store ? "lowest" : "",
              row.store === soon.store && soon.store !== low.store ? "soonest" : "",
            ].filter(Boolean);
            return (
              <li key={row.store} className="flex items-baseline justify-between gap-3">
                <span className={row.store === primary.store ? "text-ink" : "text-muted"}>
                  {row.store}
                  {tags.length ? ` · ${tags.join(" · ")}` : ""} · {row.ships}
                </span>
                <span className={`tabular-nums ${row.store === primary.store ? "font-medium" : "text-muted"}`}>{money(row.price)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted">
          {product.returnDays}-day returns
          {owned ? " · you already bought this" : ""}
        </p>
        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onAdd(primary.store)}
            className={
              recommended
                ? "min-h-11 rounded-xl bg-brass px-4 py-2 font-medium text-on-brass"
                : "min-h-11 rounded-xl border border-line bg-paper px-4 py-2 font-medium text-ink"
            }
          >
            {owned ? "Buy again" : inCart ? "Add another" : recommended ? "Add this one" : `Add · ${money(primary.price)}`}
          </button>
          {alt ? (
            <button
              type="button"
              onClick={() => onAdd(alt.store)}
              className="min-h-11 rounded-xl border border-line bg-paper px-4 py-2 text-sm font-medium"
            >
              {alt.days < primary.days ? "Sooner" : "Cheaper"} · {alt.ships} · {money(alt.price)}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
