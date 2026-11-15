/**
 * Profile serializer (base B0).
 *
 * Returns only the caller's public identity fields. The base snapshot provides
 * this serializer; heads that expose a profile response import it unchanged.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import type { Caller } from "./types.ts";

export function serializeProfile(caller: Caller): unknown {
  return {
    id: caller.id,
    email: caller.email,
  };
}
