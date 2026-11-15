/**
 * Profile serializer variant for base snapshot B1.
 *
 * B1 differs from B0 only in the content of this unchanged serializer: it
 * includes the caller's role and internal marker. A head that exposes this
 * serializer therefore leaks those fields.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { Caller } from "./types.ts";

export function serializeProfile(caller: Caller): unknown {
  return {
    id: caller.id,
    email: caller.email,
    role: "reviewer",
    internal: true,
  };
}
