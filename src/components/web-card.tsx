import { money } from "@/lib/catalog";
import type { WebHit } from "@/lib/paypal";

export function WebCard({ hit, onPay }: { hit: WebHit; onPay: (id: string) => void }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-line bg-sheet">
      {hit.image ? (
        <img src={hit.image} alt={hit.name} className="aspect-square w-full object-cover" />
      ) : (
        <div className="grid aspect-square w-full place-items-center bg-paper text-sm text-muted">Channel3</div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl leading-tight font-medium">{hit.name}</h3>
          <p className="shrink-0 text-lg font-medium tabular-nums">{money(hit.price)}</p>
        </div>
        <p className="text-sm leading-relaxed text-muted">{hit.blurb}</p>
        <p className="text-sm text-muted">{hit.store} · Channel3</p>
        <button
          type="button"
          onClick={() => onPay(hit.id)}
          className="mt-auto min-h-11 rounded-xl bg-brass px-4 py-2 font-medium text-on-brass"
        >
          Pay {money(hit.price)} with PayPal
        </button>
      </div>
    </article>
  );
}
