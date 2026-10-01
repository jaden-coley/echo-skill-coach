"use client";

import { useQuery } from "convex/react";
import { useSyncExternalStore } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getLearnerKey } from "./learnerKey";

const noSubscribe = () => () => {};

/** Today's date in the learner's own time zone, as "YYYY-MM-DD". */
export function localToday() {
  return new Date().toLocaleDateString("en-CA");
}

/** Streak + personal-best summary for the current learner (live). */
export function useProgressSummary(currentSessionId?: Id<"sessions"> | null) {
  const learnerKey = useSyncExternalStore(noSubscribe, getLearnerKey, () => null);
  return useQuery(
    api.progress.summary,
    learnerKey
      ? {
          learnerKey,
          today: localToday(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          currentSessionId: currentSessionId ?? undefined,
        }
      : "skip",
  );
}
