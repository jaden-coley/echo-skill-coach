const STORAGE_KEY = "echo.learnerKey";

/**
 * Anonymous per-device learner id, so progress follows the learner across
 * visits before sign-in exists. Falls back to a per-tab id if storage is
 * blocked (private windows, strict settings).
 */
export function getLearnerKey(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return (fallbackKey ??= crypto.randomUUID());
  }
}

let fallbackKey: string | undefined;
