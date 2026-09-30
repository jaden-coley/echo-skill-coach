import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { LessonEvent } from "./chopstickCoaching";
import type { ChopstickMetrics, ChopstickSnapshot } from "./chopstickFeatures";

/*
 * Streams a practice session into Convex: the session is created up front,
 * then every lesson event and a periodic metric sample are written as they
 * happen, which is what makes the dashboard update live. Writes are
 * fire-and-forget; a failed write must never interrupt the lesson.
 */

const SAMPLE_EVERY_MS = 2000;

export class SessionRecorder {
  readonly sessionId: Promise<Id<"sessions">>;
  private lastSampleAt: number | null = null;

  constructor(
    private readonly convex: ConvexReactClient,
    private readonly learnerKey: string,
  ) {
    this.sessionId = convex.mutation(api.sessions.start, { learnerKey });
    this.sessionId.catch((error) => console.warn("Couldn't start a Convex session", error));
  }

  record(event: LessonEvent) {
    this.write((ids) => {
      switch (event.type) {
        case "step":
          return this.convex.mutation(api.sessions.recordStep, {
            ...ids,
            step: event.step,
            kind: event.kind,
          });
        case "check":
          return this.convex.mutation(api.sessions.recordCheck, {
            ...ids,
            step: event.step,
            check: event.check,
            pass: event.verdict.pass,
            issue: event.verdict.issue,
            correction: event.verdict.correction,
            confidence: event.verdict.confidence,
            gripShape: event.gripShape ?? undefined,
            metrics: event.metrics ? numbers(event.metrics) : undefined,
            latencyMs: event.latencyMs,
          });
        case "correction":
          return this.convex.mutation(api.sessions.recordCorrection, {
            ...ids,
            step: event.step,
            source: event.source,
            faultId: event.faultId,
            message: event.message,
          });
      }
    });
  }

  /** Call every frame; writes a sample every couple of seconds of active practice. */
  sample(step: number, snapshot: ChopstickSnapshot, now: number) {
    if (snapshot.state !== "active" || !snapshot.metrics) {
      this.lastSampleAt = null;
      return;
    }
    if (this.lastSampleAt !== null && now - this.lastSampleAt < SAMPLE_EVERY_MS) return;

    // Only count time that was continuously active since the last sample.
    const activeSeconds = this.lastSampleAt === null ? 0 : (now - this.lastSampleAt) / 1000;
    this.lastSampleAt = now;
    const metrics = numbers(snapshot.metrics);
    const grip = snapshot.grip ?? undefined;

    this.write((ids) =>
      this.convex.mutation(api.sessions.recordSample, {
        ...ids,
        step,
        metrics,
        grip,
        activeSeconds,
      }),
    );
  }

  end() {
    this.write((ids) => this.convex.mutation(api.sessions.end, ids));
  }

  private write(
    send: (ids: { sessionId: Id<"sessions">; learnerKey: string }) => Promise<unknown>,
  ) {
    this.sessionId
      .then((sessionId) => send({ sessionId, learnerKey: this.learnerKey }))
      .catch((error) => console.warn("Couldn't save to Convex", error));
  }
}

function numbers(metrics: ChopstickMetrics) {
  return {
    pivotRange: metrics.pivotRange.value,
    anchorMovement: metrics.anchorMovement.value,
    isolation: metrics.isolation.value,
  };
}
