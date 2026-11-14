/**
 * JSON audit sink (WP1).
 *
 * Deterministic, append-only in-memory audit log with explicit reset and
 * delta capture. All timestamps are ISO-8601 UTC.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { AuditRecord, AuditDelta } from "./types.ts";

export class AuditSink {
  private readonly records: AuditRecord[] = [];
  private deltaCursor = 0;

  record(event: string, reason: string, path: string, tokenPresent: boolean, callerId?: string): void {
    this.records.push({
      event,
      reason,
      path,
      tokenPresent,
      callerId,
      timestamp: new Date(Date.now()).toISOString(),
    });
  }

  /** Snapshot every record ever recorded (for full-tree inspection). */
  all(): ReadonlyArray<AuditRecord> {
    return this.records;
  }

  /** Records added since the last `reset()` or `delta()` call. */
  delta(): AuditDelta {
    const added = this.records.slice(this.deltaCursor);
    this.deltaCursor = this.records.length;
    return { added, count: added.length };
  }

  /** Clear the sink and the delta cursor. Deterministic state initialization. */
  reset(): void {
    this.records.length = 0;
    this.deltaCursor = 0;
  }

  /** Number of records currently stored. */
  size(): number {
    return this.records.length;
  }
}
