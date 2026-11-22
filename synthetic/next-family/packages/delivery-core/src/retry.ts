// Shared retry policy for delivery targets.
//
// This package is a workspace sibling of the notification-delivery service, not a
// part of its repository. It is installed in the workspace so the service and its
// ordinary checks run, and it is intentionally not included in the material
// provided to a reviewer of that service.

export type RetryDecision = "retry" | "final";

/**
 * A status the target returned, or 0 for a network error or a timeout.
 * `5xx`, network errors and timeouts are transient; every other `4xx` is final.
 */
export function classify(status: number): RetryDecision {
  if (status === 0) return "retry";
  if (status >= 500 && status <= 599) return "retry";
  return "final";
}

/** Delay before the next attempt, in milliseconds. Grows with the attempt number. */
export function nextDelayMs(attempt: number): number {
  const safe = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
  return Math.min(100 * 2 ** (safe - 1), 2_000);
}
