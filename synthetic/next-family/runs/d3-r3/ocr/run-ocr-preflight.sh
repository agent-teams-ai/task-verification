#!/usr/bin/env bash
# Ordinary-OCR comparator stage for the original frozen c02, qualified 1.14.0-rr.1.
#
#   MODE=offline ./run-ocr-preflight.sh        # measure request widths, spend nothing
#   MODE=live    ./run-ocr-preflight.sh        # admitted only after the preflight passes
#
# The binary, the managed rule wording, the background file (the authored task
# statement), the reviewer settings and the filtering policy are frozen. The only
# numbers that differ between modes are the proxy ceilings: the offline pass widens
# them deliberately, because its job is to *measure* the request shape rather than
# to admit it.
set -o pipefail

MODE="${MODE:-offline}"
HEAD="65f210381920fbfce032cf5ba8aaa440f3300162"
BASE="c65bc835ca35b94fd0de3e3c0cc2c8d459b556de"

if [ "$MODE" = "offline" ]; then
  CAP="${CAP:-24}"
  REQ_BYTES="${REQ_BYTES:-262144}"
  REQ_TOKENS="${REQ_TOKENS:-262208}"
  REQ_OUT="1500"
  STAGE_IN="${STAGE_IN:-6291456}"
  STAGE_OUT="${STAGE_OUT:-12000}"
else
  CAP="${CAP:-8}"
  REQ_BYTES="${REQ_BYTES:-15936}"
  REQ_TOKENS="${REQ_TOKENS:-16000}"
  REQ_OUT="1500"
  STAGE_IN="${STAGE_IN:-128000}"
  STAGE_OUT="${STAGE_OUT:-12000}"
fi

RUN_DIR="$(cd "$(dirname "$0")" && pwd)"
FAMILY="$(cd "$RUN_DIR/../../.." && pwd)"
SYN="$(cd "$FAMILY/.." && pwd)"
TOOLING="$SYN/tooling"
RR_BIN="${RR_BIN:-$TEMP/d3-ocr/extracted/opencodereview-linux-amd64}"
FIXTURE="${FIXTURE:-$TEMP/d3-ocr/fixture-c02}"
PORT=8787
PROXY_NAME="d3-r3-proxy-c02-$MODE"
OCR_NAME="d3-r3-ocr-c02-$MODE"
LEDGER="/run/ledger-ocr-c02-$MODE.jsonl"
RESULT="/run/ocr-result-c02-$MODE.json"

if [ ! -f "$RR_BIN" ]; then echo "FATAL: qualified binary not found at $RR_BIN"; exit 2; fi
if [ ! -d "$FIXTURE/.git" ]; then echo "FATAL: c02 checkout not found at $FIXTURE"; exit 2; fi
if [ ! -f "$RUN_DIR/rule-c02.json" ]; then echo "FATAL: run prepare-ocr.mjs first"; exit 2; fi

if [ "$MODE" = "live" ]; then
  [ -n "${OPENROUTER_API_KEY:-}" ] || { echo "FATAL: OPENROUTER_API_KEY not present"; exit 2; }
  [ -n "${OPENROUTER_BASE_URL:-}" ] || { echo "FATAL: OPENROUTER_BASE_URL not present"; exit 2; }
  PROXY_EXTRA=""
  PROXY_EXTRA_IDENTITY="--enforce-identity --require-observed-model --allow-observed-provider OpenRouter,OpenAI"
else
  PROXY_EXTRA="--offline"
  PROXY_EXTRA_IDENTITY=""
fi

export MSYS_NO_PATHCONV=1
w() { cygpath -w "$1"; }

docker rm -f "$PROXY_NAME" "$OCR_NAME" >/dev/null 2>&1

echo "== starting proxy ($MODE: bytes=$REQ_BYTES requests=$CAP) =="
docker run -d --name "$PROXY_NAME" \
  --platform linux/amd64 \
  -e OPENROUTER_API_KEY -e OPENROUTER_BASE_URL \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$TOOLING"):/pilot:ro" \
  -w /run \
  m2-ocr-rr7:local \
  node /pilot/openrouter-bounded-proxy.mjs \
    $PROXY_EXTRA \
    --stage "d3-r3-ocr-c02-$MODE" \
    --port "$PORT" \
    --max-requests "$CAP" \
    --max-input-tokens "$STAGE_IN" \
    --max-output-tokens "$STAGE_OUT" \
    --request-input-bytes "$REQ_BYTES" \
    --request-input-tokens "$REQ_TOKENS" \
    --request-output-tokens "$REQ_OUT" \
    --request-timeout-ms 150000 \
    --model openai/gpt-6.1-terra \
    --service-tier default \
    --effort medium \
    $PROXY_EXTRA_IDENTITY \
    --ledger "$LEDGER" > /dev/null || { echo "FATAL: proxy failed to start"; docker logs "$PROXY_NAME"; exit 2; }

ready=0
for i in $(seq 1 60); do
  if docker exec "$PROXY_NAME" node -e "const s=require('net').connect($PORT,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != "1" ]; then echo "FATAL: proxy not ready"; docker logs "$PROXY_NAME"; docker rm -f "$PROXY_NAME" >/dev/null 2>&1; exit 2; fi
echo "== proxy ready on 127.0.0.1:$PORT =="

OCR_INNER=$(cat <<INNER
set -e
mkdir -p /tmp/home/.opencodereview
cp /run/home/.opencodereview/config.json /tmp/home/.opencodereview/config.json
chmod 700 /tmp/home /tmp/home/.opencodereview
chmod 600 /tmp/home/.opencodereview/config.json
export HOME=/tmp/home
export XDG_CONFIG_HOME=/tmp/home/.config
export XDG_CACHE_HOME=/tmp/home/.cache
exec /rr/ocr review --reviewrouter-managed --provider reviewrouter --model openai/gpt-6.1-terra --repo /fixture/repo --from $BASE --to $HEAD --rule /run/rule-c02.json --background-file /run/background-c02.txt --effort medium --concurrency 1 --format json --audience agent --timeout 20 --max-tokens-budget 400000 --output $RESULT
INNER
)

echo "== running qualified 1.14.0-rr.1 on c02 ($MODE) =="
set +e
docker run --rm --name "$OCR_NAME" \
  --platform linux/amd64 \
  --network "container:$PROXY_NAME" \
  -v "$(w "$FIXTURE"):/fixture/repo:ro" \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$RR_BIN"):/rr/ocr:ro" \
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
  > "$RUN_DIR/ocr-stdout-c02-$MODE.log" 2> "$RUN_DIR/ocr-stderr-c02-$MODE.log"
ocr_exit=$?
set -e
echo "== ocr exit=$ocr_exit =="

sleep 1
docker logs "$PROXY_NAME" > "$RUN_DIR/proxy-log-c02-$MODE.txt" 2>&1
docker rm -f "$PROXY_NAME" >/dev/null 2>&1

node -e "
const fs=require('fs'),crypto=require('crypto');
const run=process.argv[1], mode=process.argv[2], exit=Number(process.argv[3]);
const ledger=run+'/ledger-ocr-c02-'+mode+'.jsonl';
const lines=fs.existsSync(ledger)?fs.readFileSync(ledger,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const fwd=lines.filter(l=>l.decision==='forwarded');
const refused=lines.filter(l=>l.decision==='refused');
const IN_USD=1.25/1e6, OUT_USD=5.0/1e6;
const inTok=fwd.reduce((s,l)=>s+(l.chargedInputTokens||0),0);
const outTok=fwd.reduce((s,l)=>s+(l.chargedOutputTokens||0),0);
const resultFile=run+'/ocr-result-c02-'+mode+'.json';
const result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
const summary={
  schema:'d3-r3.ocr-stage/v1', candidate:'c02', mode, exitCode:exit,
  comparator:'1.14.0-rr.1',
  binarySha256:'443d7777b9fffae6300085c3afc6027181de181befa118bbe6f580dce3fcb399',
  ruleDocumentSha256:crypto.createHash('sha256').update(fs.readFileSync(run+'/rule-c02.json')).digest('hex'),
  backgroundSha256:crypto.createHash('sha256').update(fs.readFileSync(run+'/background-c02.txt')).digest('hex'),
  requests:{forwarded:fwd.length,refused:refused.length,records:lines.length},
  refusals:refused.map(r=>({code:r.code,inputBytes:r.inputBytes,forwardedBytes:r.forwardedBytes,ceiling:r.ceiling||r.bodyByteCeiling})),
  inputBytes:fwd.map(l=>l.inputBytes),
  forwardedBytes:fwd.map(l=>l.forwardedBytes),
  maxInputBytes:Math.max(0,...fwd.map(l=>l.inputBytes)),
  maxForwardedBytes:Math.max(0,...fwd.map(l=>l.forwardedBytes||0)),
  ceilings:{requestInputBytes:Number('${REQ_BYTES}'),requestInputTokens:Number('${REQ_TOKENS}'),requestOutputTokens:Number('${REQ_OUT}'),stageInputTokens:Number('${STAGE_IN}'),stageOutputTokens:Number('${STAGE_OUT}'),maxRequests:Number('${CAP}')},
  requested:{model:'openai/gpt-6.1-terra',serviceTier:'default',effort:'medium'},
  observed:fwd.map(l=>({status:l.status,model:l.observedModel,provider:l.observedProvider,usagePresent:l.usagePresent})),
  usage:{inputTokens:inTok,outputTokens:outTok},
  chargedUsdConservative:Number(((inTok*IN_USD)+(outTok*OUT_USD)).toFixed(8)),
  halted:fwd.length?fwd[fwd.length-1].halted:null,
  result: result?{status:result.status,message:result.message,terminal:result.manifest&&result.manifest.terminal_state,comments:(result.comments||[]).length,filesReviewed:result.summary&&result.summary.files_reviewed,groups:(result.groups||[]).map(g=>({label:g.label,files:g.files.length})),outcome:result.reviewrouter_outcome}:null,
  resultPath:'ocr-result-c02-'+mode+'.json'
};
fs.writeFileSync(run+'/stage-summary-ocr-c02-'+mode+'.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({mode,exitCode:exit,forwarded:fwd.length,refused:refused.length,inputBytes:summary.inputBytes,maxInputBytes:summary.maxInputBytes,comments:summary.result&&summary.result.comments,files:summary.result&&summary.result.filesReviewed,terminal:summary.result&&summary.result.terminal},null,2));
" "$(cygpath -w "$RUN_DIR")" "$MODE" "$ocr_exit"

echo "== done =="
