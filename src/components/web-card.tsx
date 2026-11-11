import { money } from "@/lib/catalog";
import type { WebHit } from "@/lib/paypal";

export function WebCard({ hit, onPay }: { hit: WebHit; onPay: (id: string) => void }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-sheet">
      {hit.image ? (
        <div className="grid h-36 place-items-center bg-white">
          <img src={hit.image} alt={hit.name} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="grid h-36 place-items-center bg-paper text-sm text-muted">No photo</div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl leading-tight font-medium">{hit.name}</h3>
          <p className="shrink-0 text-lg font-medium tabular-nums">
            {hit.offers && hit.offers.length > 1 ? `from ${money(hit.offers[0]!.price)}` : money(hit.price)}
          </p>
        </div>
        <p className="line-clamp-3 text-sm leading-relaxed text-muted">{hit.blurb}</p>
        <p className="text-sm text-muted">Channel3</p>
        {(hit.offers && hit.offers.length ? hit.offers : [{ id: hit.id, store: hit.store, price: hit.price }]).map((offer) => (
          <button
            key={offer.id}
            type="button"
            onClick={() => onPay(offer.id)}
            className="min-h-11 rounded-xl bg-brass px-4 py-2 text-left font-medium text-on-brass"
          >
            {hit.offers && hit.offers.length > 1 ? `Pay ${offer.store} ${money(offer.price)}` : `Pay ${money(offer.price)} with PayPal`}
          </button>
        ))}
      </div>
    </article>
  );
}
