// Verify that a freshly packed `@agent-teams/account-gateway` tarball is the
// approved artifact.
//
// The approved SHA-256 was produced on Windows, where the gzip container writes
// `OS = 0x0a` (NTFS). A Linux build writes `OS = 0x03` (Unix), which changes the
// compressed bytes at exactly one offset (byte 9 of the gzip header) while
// leaving the entire tar stream and every extracted file byte-identical.
//
// So the check is:
//   1. exact size must match, and
//   2. either the SHA-256 matches the approved pin, or the stream matches it
//      after normalising that single gzip OS byte.
//
// No other difference is tolerated: a content change would move the digest, and
// a structural change would change the size.
//
// Usage: node scripts/verify-sdk-tarball.mjs <tarball>

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const APPROVED = {
  file: "agent-teams-account-gateway-0.1.0.tgz",
  sizeBytes: 54221,
  sha256: "dfa8fad3058813d4b0db52f3a05e347c0c8a531286bcbea2183554045e179f00",
  npmIntegrity: "sha512-4KRoem4eP1pVDHHy/ElDwoJvzIUY9MtTbAaCarPSg2mT+4I/tq05HHfg3yd+F5tC6S8ECRjtDALRA3/iW2hEtA==",
};
const GZIP_OS_WINDOWS = 0x0a;

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/verify-sdk-tarball.mjs <tarball>");
  process.exit(2);
}
const file = path.resolve(arg);
const bytes = Buffer.from(fs.readFileSync(file));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const integrity = (buf) => "sha512-" + crypto.createHash("sha512").update(buf).digest("base64");

const actualSha = sha256(bytes);
const actualIntegrity = integrity(bytes);

let verdict;
if (bytes.length !== APPROVED.sizeBytes) {
  verdict = { match: false, reason: `size ${bytes.length} != approved ${APPROVED.sizeBytes}` };
} else if (actualSha === APPROVED.sha256) {
  verdict = {
    match: true,
    reason: "byte-identical to the approved tarball",
    gzipOsByte: bytes[9],
    sha256: actualSha,
    npmIntegrity: actualIntegrity,
  };
} else {
  const normalized = Buffer.from(bytes);
  normalized[9] = GZIP_OS_WINDOWS;
  const normalizedSha = sha256(normalized);
  if (normalizedSha === APPROVED.sha256) {
    verdict = {
      match: true,
      reason:
        `identical to the approved tarball apart from the gzip OS byte ` +
        `(built with 0x${bytes[9].toString(16)}, approved 0x0a); tar stream and file content are unchanged`,
      gzipOsByte: bytes[9],
      sha256: actualSha,
      npmIntegrity: actualIntegrity,
      normalizedSha256: normalizedSha,
    };
  } else {
    verdict = {
      match: false,
      reason:
        `neither the raw nor the gzip-OS-normalised stream matches the approved pin ` +
        `(raw ${actualSha}, normalised ${normalizedSha})`,
      gzipOsByte: bytes[9],
      sha256: actualSha,
      npmIntegrity: actualIntegrity,
      normalizedSha256: normalizedSha,
    };
  }
}

const evidence = {
  schema: "m2.sdk-tarball-verification/v1",
  file,
  platform: `${process.platform}/${process.arch}`,
  sizeBytes: bytes.length,
  approved: APPROVED,
  observed: { sha256: actualSha, npmIntegrity: actualIntegrity, gzipOsByte: bytes[9] },
  verdict,
};
const evidencePath = process.env.SDK_TARBALL_EVIDENCE;
if (evidencePath) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
}

if (!verdict.match) {
  console.error(`FAIL tarball identity: ${verdict.reason}`);
  console.error(`     observed sha256 ${actualSha}, integrity ${actualIntegrity}`);
  process.exit(1);
}
console.log(`PASS tarball identity: ${verdict.reason}`);
console.log(`     size ${bytes.length}, sha256 ${actualSha}`);
