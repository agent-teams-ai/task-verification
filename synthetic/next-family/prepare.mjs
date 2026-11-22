// Deterministic reviewer-input assembly for the next-family task (Strategy A: reproducible packet).
//
//   node prepare.mjs --all
//   node prepare.mjs --ref <full-commit-sha>
//
// The selection rule is declared below and applied by the script to every candidate identically.
// Nothing is hand-picked: the file list is `git ls-tree` at the frozen commit, filtered by the rule.
// The output is byte-identical for the same commit and rule; no timestamps are recorded in it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.join(HERE, "repo");
const OUT = path.join(HERE, "packets");
const BASE = "c65bc835ca35b94fd0de3e3c0cc2c8d459b556de";

/** Declared selection rule. Changing it creates a new packet revision. */
const RULE = Object.freeze({
  revision: "next-family-packet-rule-v1",
  include: ["README.md", "package.json", "tsconfig.json", "src/**/*.ts", "tests/**/*.ts"],
  exclude: ["node_modules/**", ".git/**", "*.lock"],
  maxFileBytes: 24576,
  maxPacketBytes: 98304,
});

const isIncluded = (p) =>
  p === "README.md" ||
  p === "package.json" ||
  p === "tsconfig.json" ||
  /^src\/.+\.ts$/.test(p) ||
  /^tests\/.+\.ts$/.test(p);

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function trackedFiles(ref) {
  return git("ls-tree", "-r", "--name-only", ref)
    .split("\n")
    .filter(Boolean)
    .sort();
}

function build(ref) {
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error(`ref must be a full 40-character commit id: ${ref}`);

  const all = trackedFiles(ref);
  const included = [];
  const excluded = [];

  for (const p of all) {
    if (!isIncluded(p)) {
      excluded.push({ path: p, reason: "not-selected-by-rule" });
      continue;
    }
    const blob = git("show", `${ref}:${p}`);
    const bytes = Buffer.byteLength(blob, "utf8");
    if (bytes > RULE.maxFileBytes) {
      excluded.push({ path: p, reason: "file-size-limit", bytes });
      continue;
    }
    included.push({ path: p, bytes, sha256: sha256(blob), body: blob });
  }

  const statements = {
    task: fs.readFileSync(path.join(HERE, "TASK.md"), "utf8"),
    handoff: fs.readFileSync(path.join(HERE, "AUTHOR-HANDOFF.md"), "utf8"),
  };

  const parts = [
    `# Task statement (delivery-req-v1)\n\n${statements.task.trimEnd()}`,
    `# Author handoff\n\n${statements.handoff.trimEnd()}`,
    `# Commit identity\n\nbase ${BASE}\nhead ${ref}`,
    `# Candidate repository content\n\nEvery file listed below is the exact content of the candidate commit under the declared selection rule (${RULE.revision}).\n\n${included
      .map((f) => `### ${f.path}\n${f.body.replace(/\r\n/g, "\n").trimEnd()}`)
      .join("\n\n")}`,
    `# Declared selection rule and exclusions\n\ninclude: ${RULE.include.join(", ")}\nexclude: ${RULE.exclude.join(", ")}\nmax file bytes: ${RULE.maxFileBytes}\n\nFiles present at the candidate but not included:\n\n${
      excluded.length ? excluded.map((e) => `- ${e.path} — ${e.reason}`).join("\n") : "- (none)"
    }`,
  ];

  const text = `${parts.join("\n\n")}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > RULE.maxPacketBytes) {
    throw new Error(`packet exceeds ${RULE.maxPacketBytes} bytes (${bytes}); the rule does not truncate`);
  }

  const packetSha = sha256(text);
  const short = ref.slice(0, 12);
  if (/evaluator/.test(OUT)) throw new Error("packets must never be written under evaluator/");

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `packet-${short}.md`), text);
  fs.writeFileSync(
    path.join(OUT, `packet-${short}.json`),
    `${JSON.stringify(
      {
        schema: "next-family.packet/v1",
        rule: RULE,
        base: BASE,
        head: ref,
        taskStatement: { revision: "delivery-req-v1", sha256: sha256(statements.task) },
        authorHandoffSha256: sha256(statements.handoff),
        files: included.map(({ path: p, bytes: b, sha256: s }) => ({ path: p, bytes: b, sha256: s })),
        excluded,
        packet: { path: `packet-${short}.md`, bytes, sha256: packetSha },
      },
      null,
      2,
    )}\n`,
  );

  return { ref, short, bytes, packetSha, files: included.length, excluded: excluded.length };
}

const args = process.argv.slice(2);
const refs = args.includes("--all")
  ? git("branch", "--list", "candidate-*", "--format=%(objectname)").split("\n").filter(Boolean).sort()
  : (() => {
      const i = args.indexOf("--ref");
      if (i < 0) {
        console.error("usage: node prepare.mjs --all | --ref <sha>");
        process.exit(2);
      }
      return [args[i + 1]];
    })();

for (const ref of refs) {
  const r = build(ref);
  console.log(JSON.stringify(r));
}
