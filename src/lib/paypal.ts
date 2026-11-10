import type { CartLine, Order, OrderLine, ShipTo } from "@/lib/desk-engine";

export type WebHit = {
  id: string;
  name: string;
  price: number;
  store: string;
  image: string;
  blurb: string;
};

export type Health = { paypal: boolean; grok: boolean; channel3: boolean };

export async function serviceHealth(): Promise<Health | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

export async function startCheckout(body: {
  lines?: Pick<CartLine, "productId" | "qty" | "store">[];
  budget: number;
  webId?: string;
  address?: ShipTo;
}): Promise<{ ok: boolean; approveUrl?: string; orderId?: string; error?: string }> {
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json()) as { ok?: boolean; approveUrl?: string; orderId?: string; error?: string };
    if (!res.ok || !data.approveUrl) return { ok: false, error: data.error || "PayPal did not open" };
    return { ok: true, approveUrl: data.approveUrl, orderId: data.orderId };
  } catch {
    return { ok: false, error: "PayPal took too long. Try the pay button again." };
  }
}

export async function capturePaypal(orderId: string): Promise<{
  ok: boolean;
  order?: Order;
  clearCart?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST" });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      orderId?: string;
      captureId?: string;
      total?: number;
      clearCart?: boolean;
      lines?: OrderLine[];
    };
    if (!res.ok || !data.ok || !data.orderId || !data.lines) return { ok: false, error: data.error || "PayPal did not capture" };
    return {
      ok: true,
      clearCart: Boolean(data.clearCart),
      order: {
        id: data.orderId,
        created: Date.now(),
        lines: data.lines,
        total: Number(data.total),
        status: "paid",
        paypalOrderId: data.orderId,
        paypalCaptureId: data.captureId,
      },
    };
  } catch {
    return { ok: false, error: "PayPal capture did not answer" };
  }
}

export async function paypalStatus(orderId: string): Promise<{ ok: boolean; label?: string; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { signal: AbortSignal.timeout(20000) });
    const data = (await res.json()) as { ok?: boolean; status?: string; error?: string };
    if (!res.ok || !data.ok || !data.status) return { ok: false, error: data.error || "PayPal did not return a status" };
    return { ok: true, label: data.status };
  } catch {
    return { ok: false, error: "PayPal status did not answer" };
  }
}

export async function refundPaypal(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/refund`, { method: "POST" });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error || "PayPal did not refund" };
    return { ok: true };
  } catch {
    return { ok: false, error: "PayPal refund did not answer" };
  }
}

export async function adviseStore(body: {
  productId: string;
  brief: string;
  ask: string;
}): Promise<{ ok: boolean; text?: string; store?: string }> {
  try {
    const res = await fetch("/api/advise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; text?: string; store?: string };
  } catch {
    return { ok: false };
  }
}

export async function searchWeb(query: string, maxPrice: number): Promise<{ ok: boolean; results: WebHit[]; error?: string }> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxPrice }),
      signal: AbortSignal.timeout(25000),
    });
    const data = (await res.json()) as { ok?: boolean; results?: WebHit[]; error?: string };
    if (!res.ok || !data.ok) return { ok: false, results: [], error: data.error || "Channel3 did not answer" };
    return { ok: true, results: data.results ?? [] };
  } catch {
    return { ok: false, results: [], error: "Channel3 did not answer. Try that search again." };
  }
}
