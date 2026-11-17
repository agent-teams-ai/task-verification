/**
 * Profile serializer variant for base snapshot B1.
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
