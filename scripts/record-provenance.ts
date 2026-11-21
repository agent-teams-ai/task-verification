/**
 * Compatibility entry point for snapshot provenance generation.
 *
 * Provenance is now produced by the single authoritative generator in
 * `scripts/gen-candidates.ts`; this shim preserves the historical command.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

import { generateAll } from "./gen-candidates.ts";

generateAll();
console.log("Wrote candidates/provenance.json");
