/**
 * Type-only re-export for test-only fault applications.
 *
 * At runtime the fault workspace is built with the fixture's `types.ts`; this
 * file exists so the repository copy typechecks against the same contract.
 *
 * Licensed under Apache 2.0. See LICENSE.
 */

export * from "../../fixture/src/types.ts";
