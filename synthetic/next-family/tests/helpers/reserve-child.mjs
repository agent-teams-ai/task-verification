// One child-process admission attempt, used by the concurrency test.
//
//   node reserve-child.mjs <dir> <requestKey> <maxUsd> <inputTokens>
import { reserve } from "../../lib/budget.mjs";

const [dir, requestKey, maxUsd, inputTokens] = process.argv.slice(2);
const result = reserve({
  requestKey,
  attemptId: `child-${requestKey}`,
  candidateId: "c01",
  stageId: "concurrency-test",
  maxUsd: Number(maxUsd),
  inputTokens: Number(inputTokens),
  outputTokens: 0,
  dir,
});
process.stdout.write(JSON.stringify(result));
