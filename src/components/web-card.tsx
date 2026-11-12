import { money } from "@/lib/catalog";
import type { WebHit } from "@/lib/paypal";

export function WebCard({ hit, onPay }: { hit: WebHit; onPay: (id: string) => void }) {
  const offers = hit.offers && hit.offers.length ? hit.offers : [{ id: hit.id, store: hit.store, price: hit.price }];
  const several = offers.length > 1;
  const features = (hit.features ?? []).filter(Boolean);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-sheet">
      <div className="relative h-40 shrink-0 overflow-hidden bg-white">
        {hit.image ? (
          <img src={hit.image} alt="" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">No photo</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl leading-tight font-medium">{hit.name}</h3>
          <p className="shrink-0 text-lg font-medium tabular-nums">{several ? `from ${money(offers[0]!.price)}` : money(hit.price)}</p>
        </div>
        {hit.blurb || features.length ? (
          <details className="text-sm leading-relaxed text-muted">
            <summary className="min-h-11 cursor-pointer font-medium text-ink">Description</summary>
            {hit.blurb ? <p className="mt-2">{hit.blurb}</p> : null}
            {features.length ? (
              <ul className="mt-2 list-disc pl-5">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : null}
          </details>
        ) : null}
        <p className="text-sm text-muted">Live merchant. PayPal charges this row.</p>
        {offers.map((offer) => (
          <button
            key={offer.id}
            type="button"
            onClick={() => onPay(offer.id)}
            className="min-h-11 rounded-xl bg-brass px-4 py-2 text-left font-medium text-on-brass"
          >
            {several ? `Pay ${offer.store} ${money(offer.price)}` : `Pay ${money(offer.price)} with PayPal`}
          </button>
        ))}
      </div>
    </article>
  );
}
