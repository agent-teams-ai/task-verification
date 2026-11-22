// Offline: reproduce the complete SDK-serialized request for each candidate.
//
//   node synthetic/next-family/offline/measure-requests.mjs
//
// No credential, no proxy, no provider, no billable call: the execution port is a
// fake that records the body and refuses to forward it.
import path from "node:path";

import { FAMILY_ROOT } from "../lib/paths.mjs";
import { loadFamily, loadPacket, buildTask } from "../lib/task.mjs";
import { measureSerializedRequest } from "../lib/measure.mjs";
import { MAX_OUTPUT_TOKENS } from "../lib/limits.mjs";

const family = loadFamily(FAMILY_ROOT);
const out = {};
for (const candidateId of Object.keys(family.candidates)) {
  const packet = loadPacket(candidateId, family);
  const task = buildTask({
    candidateId,
    stageId: "criteria",
    packetText: packet.text,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  const measured = await measureSerializedRequest(task);
  out[candidateId] = {
    head: packet.head,
    packet: { bytes: packet.bytes, sha256: packet.sha256 },
    request: measured,
  };
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
