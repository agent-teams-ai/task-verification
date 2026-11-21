#!/usr/bin/env bash
# Model-free compatibility stage for the QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE.
#
# Everything is deterministic and local: the audited bounded proxy still owns
# interception, policy pinning and accounting, but its upstream is a fake
# Responses provider instead of OpenRouter. No provider, no credential, no spend.
#
#   FAKE_MODE=probe     -> one assistant message per turn (captures tool schemas)
#   FAKE_MODE=finding   -> code_comment + filter decision + task_done
set -o pipefail

FAKE_MODE="${FAKE_MODE:-probe}"
CONTEXT="${CONTEXT:-false}"
INPUT_CEILING="${INPUT_CEILING:-20000}"
MAX_INPUT_TOKENS="${MAX_INPUT_TOKENS:-120000}"
MAX_OUTPUT_TOKENS="${MAX_OUTPUT_TOKENS:-24000}"
CAP="${CAP:-12}"
RUN_DIR="$(cd "$(dirname "$0")" && pwd)"
SYN="$(cd "$RUN_DIR/../.." && pwd)"
REPO="$SYN/repo"
TOOLING="$SYN/tooling"
RR_BIN="${RR_BIN:-/d/Project/agent-teams-ai-task-verification-m2/.isolation-tmp/d12/rr114/artifact/opencodereview-linux-amd64}"
PORT=8787
FAKE_PORT=8901
PROXY_NAME="d12-rr1-compat-proxy-$FAKE_MODE"
FAKE_NAME="d12-rr1-compat-fake-$FAKE_MODE"
STAGE="d12-rr1-compat-$FAKE_MODE"
RESULT="ocr-result-compat-$FAKE_MODE.json"
LEDGER="/run/ledger-compat-$FAKE_MODE.jsonl"

export MSYS_NO_PATHCONV=1
w() { cygpath -w "$1"; }
cleanup() {
  docker rm -f "$FAKE_NAME" >/dev/null 2>&1
  docker rm -f "$PROXY_NAME" >/dev/null 2>&1
}
trap cleanup EXIT

docker rm -f "$PROXY_NAME" "$FAKE_NAME" >/dev/null 2>&1
# Each compatibility run must be accounted on its own.
rm -f "$RUN_DIR/ledger-compat-$FAKE_MODE.jsonl" "$RUN_DIR/fake-requests-$FAKE_MODE.jsonl" "$RUN_DIR/ocr-result-compat-$FAKE_MODE.json"

# A literal placeholder, never a provider credential: the fake upstream ignores
# it and the proxy only requires that the variable is present in live mode.
echo "== starting proxy (fake upstream) =="
OPENROUTER_API_KEY="fixture-not-a-credential" \
docker run -d --name "$PROXY_NAME" \
  --platform linux/amd64 \
  -e OPENROUTER_API_KEY \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$TOOLING"):/pilot:ro" \
  -w /run \
  m2-ocr-rr7:local \
  node /pilot/openrouter-bounded-proxy.mjs \
    --stage "$STAGE" \
    --port "$PORT" \
    --max-requests "$CAP" \
    --max-input-tokens "$MAX_INPUT_TOKENS" \
    --max-output-tokens "$MAX_OUTPUT_TOKENS" \
    --request-input-tokens "$INPUT_CEILING" \
    --request-output-tokens 4000 \
    --request-timeout-ms 60000 \
    --model openai/gpt-6.1-terra \
    --service-tier default \
    --effort medium \
    --upstream "http://127.0.0.1:$FAKE_PORT" \
    --allow-insecure-upstream \
    --ledger "$LEDGER" > /dev/null || { echo "FATAL: proxy failed to start"; docker logs "$PROXY_NAME"; exit 2; }

echo "== starting fake provider in the proxy network namespace =="
docker run -d --name "$FAKE_NAME" \
  --platform linux/amd64 \
  --network "container:$PROXY_NAME" \
  -v "$(w "$RUN_DIR"):/run" \
  -w /run \
  m2-ocr-rr7:local \
  node /run/fake-responses.mjs --port "$FAKE_PORT" --out /run --mode "$FAKE_MODE" --context "$CONTEXT" --capture "/run/fake-requests-$FAKE_MODE.jsonl" > /dev/null || { echo "FATAL: fake failed to start"; docker logs "$FAKE_NAME"; exit 2; }

ready=0
for i in $(seq 1 60); do
  if docker exec "$FAKE_NAME" node -e "const s=require('net').connect($FAKE_PORT,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != "1" ]; then echo "FATAL: fake not ready"; docker logs "$FAKE_NAME"; exit 2; fi
docker logs "$FAKE_NAME" 2>&1 | tail -2

echo "== running qualified 1.14.0-rr.1 against the fake upstream =="
OCR_INNER=$(cat <<INNER
set -e
mkdir -p /tmp/home/.opencodereview
cp /run/home/.opencodereview/config.json /tmp/home/.opencodereview/config.json
chmod 700 /tmp/home /tmp/home/.opencodereview
chmod 600 /tmp/home/.opencodereview/config.json
export HOME=/tmp/home
export XDG_CONFIG_HOME=/tmp/home/.config
export XDG_CACHE_HOME=/tmp/home/.cache
exec /rr/opencodereview-linux-amd64 review --reviewrouter-managed --provider reviewrouter --model openai/gpt-6.1-terra --repo /fixture/repo --from ce99b0d65d645124413a746ecb137b5497aad80f --to 23864e3c877f2b34bbbdd90c4527ef46eb19cbd9 --rule /run/rule.json --background-file /run/background.txt --effort medium --concurrency 1 --format json --audience agent --timeout 15 --max-tokens-budget 144000 --output /run/$RESULT
INNER
)
set +e
docker run --rm --name "d12-rr1-compat-ocr-$FAKE_MODE" \
  --platform linux/amd64 \
  --network "container:$PROXY_NAME" \
  -v "$(w "$REPO"):/fixture/repo:ro" \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$RR_BIN"):/rr/opencodereview-linux-amd64:ro" \
  -w /run \
  -e PATH=/usr/local/bin:/usr/bin:/bin \
  -e LC_ALL=C \
  -e GIT_CONFIG_NOSYSTEM=1 \
  -e GIT_TERMINAL_PROMPT=0 \
  -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0='*' \
  -e OCR_ENABLE_TELEMETRY=0 \
  -e OCR_CONTENT_LOGGING=0 \
  -e OCR_RAW_LOGGING=0 \
  m2-ocr-rr7:local \
  bash -c "$OCR_INNER" \
  > "$RUN_DIR/compat-stdout-$FAKE_MODE.log" 2> "$RUN_DIR/compat-stderr-$FAKE_MODE.log"
ocr_exit=$?
set -e
echo "== ocr exit=$ocr_exit =="

sleep 1
docker logs "$PROXY_NAME" > "$RUN_DIR/compat-proxy-$FAKE_MODE.log" 2>&1
docker logs "$FAKE_NAME" > "$RUN_DIR/compat-fake-$FAKE_MODE.log" 2>&1
cleanup
trap - EXIT

node -e "
const fs=require('fs');
const run=process.argv[1], mode=process.argv[2], exit=Number(process.argv[3]);
const file=run+'/fake-requests-'+mode+'.jsonl';
const reqs=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const ledgerFile=run+'/ledger-compat-'+mode+'.jsonl';
const led=fs.existsSync(ledgerFile)?fs.readFileSync(ledgerFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const fwd=led.filter(l=>l.decision==='forwarded');
const resultFile=run+'/ocr-result-compat-'+mode+'.json';
const result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
const summary={
  schema:'d12.compat-summary/v1',
  comparator:'QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE',
  mode,
  exitCode:exit,
  fakeRequests:reqs.length,
  proxyForwarded:fwd.length,
  proxyRefused:led.filter(l=>l.decision==='refused').length,
  interceptionHolds:reqs.length===fwd.length,
  requestShape:reqs.map(r=>({i:r.i,bytes:r.bytes,model:r.model,serviceTier:r.serviceTier,reasoning:r.reasoning,stream:r.stream,store:r.store,maxOutputTokens:r.maxOutputTokens,tools:r.tools,assignedPaths:r.assignedPaths})),
  terminalState:result?.manifest?.terminal_state??null,
  status:result?.status??null,
  groups:result?.groups??null,
  comments:result?.comments??null,
  outcome:result?.reviewrouter_outcome??null,
  filtered:result?.filtered_comments??null,
  actionRequired:result?.action_required??null,
  summaryBlock:result?.summary??null
};
fs.writeFileSync(run+'/compat-summary-'+mode+'.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2).slice(0,4000));
" "$(cygpath -w "$RUN_DIR")" "$FAKE_MODE" "$ocr_exit"

echo "== done =="
