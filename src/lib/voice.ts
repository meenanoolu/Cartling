import { createServerFn } from "@tanstack/react-start";

export const polishReply = createServerFn({ method: "POST" })
  .validator((data: { brief: string }) => ({
    brief: String(data?.brief ?? "").slice(0, 1500),
  }))
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey || !data.brief) return { ok: false as const };

    try {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          max_tokens: 140,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content:
                "You are Cartling, a calm shopping concierge. Rewrite the desk note in two short sentences. Do not invent products, stores, or prices. Do not use exclamation marks or emoji.",
            },
            { role: "user", content: data.brief },
          ],
        }),
      });
      if (!res.ok) return { ok: false as const };
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) return { ok: false as const };
      return { ok: true as const, text };
    } catch {
      return { ok: false as const };
    }
  });
