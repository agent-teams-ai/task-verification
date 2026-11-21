import * as fs from "node:fs";
import * as path from "node:path";
import { writeAllEvidencePackets, EVIDENCE_DIR } from "../src/evidence.ts";
import { runAllBaselines, BASELINE_DIR } from "../src/baseline.ts";

const files = writeAllEvidencePackets();
console.log("wrote evidence packets:", files);

fs.mkdirSync(BASELINE_DIR, { recursive: true });
const results = runAllBaselines(EVIDENCE_DIR);
fs.writeFileSync(path.join(BASELINE_DIR, "baseline-results.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
console.log("wrote baseline results:", results.length);
