import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

/*
 * Caps OpenAI vision checks so a public link can't run up the API bill.
 * Every check reserves budget here before the model is called:
 *   perPerson — a burst of 12, refilling 30/hour: plenty for real practice
 *   total     — 300/day across everyone, a hard ceiling on daily spend
 * People are keyed by a hash of their IP (never the raw address).
 */

const DAY = 24 * HOUR;

const aiBudget = new RateLimiter(components.rateLimiter, {
  perPerson: { kind: "token bucket", rate: 30, period: HOUR, capacity: 12 },
  total: { kind: "fixed window", rate: 300, period: DAY },
});

export const reserveCheck = mutation({
  args: { clientKey: v.string() },
  returns: v.object({ ok: v.boolean(), retryAfter: v.optional(v.number()) }),
  handler: async (ctx, { clientKey }) => {
    const person = await aiBudget.limit(ctx, "perPerson", { key: clientKey });
    if (!person.ok) return { ok: false, retryAfter: person.retryAfter };
    const total = await aiBudget.limit(ctx, "total");
    if (!total.ok) return { ok: false, retryAfter: total.retryAfter };
    return { ok: true };
  },
});
