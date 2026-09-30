import type { Doc } from "./_generated/dataModel";
import { FAULT_COACHING } from "./skills";

export interface Struggle {
  key: string;
  label: string;
  tip: string;
  count: number;
}

/**
 * Groups a session's corrections by underlying mistake, most frequent first,
 * each with a plain-language name and a drill. Escalated tracker hints
 * ("anchor#2") count as the same mistake; AI corrections are grouped
 * together and use the AI's latest wording as the tip.
 */
export function summarizeStruggles(corrections: Doc<"corrections">[]): Struggle[] {
  const counts = new Map<string, number>();
  for (const c of corrections) {
    const key = c.source === "tracker" ? c.faultId.split("#")[0] : "ai";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const latestAi = [...corrections]
    .sort((a, b) => b._creationTime - a._creationTime)
    .find((c) => c.source === "ai");

  return [...counts.entries()]
    .map(([key, count]): Struggle | null => {
      if (key === "ai") {
        return latestAi
          ? {
              key,
              label: "Getting the grip the AI coach could confirm",
              tip: latestAi.message,
              count,
            }
          : null;
      }
      const coaching = FAULT_COACHING[key];
      return coaching ? { key, ...coaching, count } : null;
    })
    .filter((s): s is Struggle => s !== null)
    .sort((a, b) => b.count - a.count);
}
