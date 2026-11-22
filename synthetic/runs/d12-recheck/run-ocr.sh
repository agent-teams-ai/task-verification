#!/usr/bin/env bash
# Corrected-development-regression ordinary OCR stage.
#
#   LABEL=A|B  which candidate is reviewed (A = frozen Candidate A, B = the correction)
#   MODE=live  forwards to OpenRouter through the audited bounded proxy
#   MODE=offline answers locally: measures request bodies, spends nothing
#
# Only the rule document shape and the stage caps differ from the frozen rr.1
# stage (see prepare.mjs). Reviewer settings, binary, requirements, background
# template and filtering policy are unchanged.
set -o pipefail

LABEL="${LABEL:?LABEL=A or LABEL=B is required}"
MODE="${MODE:-live}"
case "$LABEL" in
  A) TO="${TO:-23864e3c877f2b34bbbdd90c4527ef46eb19cbd9}" ;;
  B) TO="${TO:?TO is required for LABEL=B}" ;;
  *) echo "FATAL: LABEL must be A or B"; exit 2 ;;
esac

CAP="${CAP:-24}"
REQ_INPUT_TOKENS="${REQ_INPUT_TOKENS:-65536}"
REQ_OUTPUT_TOKENS="${REQ_OUTPUT_TOKENS:-4000}"
STAGE_INPUT_TOKENS="${STAGE_INPUT_TOKENS:-180000}"
STAGE_OUTPUT_TOKENS="${STAGE_OUTPUT_TOKENS:-24000}"
BASE="ce99b0d65d645124413a746ecb137b5497aad80f"

RUN_DIR="$(cd "$(dirname "$0")" && pwd)"
SYN="$(cd "$RUN_DIR/../.." && pwd)"
REPO="$SYN/repo"
TOOLING="$SYN/tooling"
RR_BIN="${RR_BIN:-/d/Project/agent-teams-ai-task-verification-m2/.isolation-tmp/d12/rr114/artifact/opencodereview-linux-amd64}"
PORT=8787
PROXY_NAME="d12-recheck-proxy-$LABEL-$MODE"
STAGE="d12-rr1-corrected-$LABEL-$MODE"
LEDGER="/run/ledger-ocr-$LABEL-$MODE.jsonl"
RESULT="/run/ocr-result-$LABEL-$MODE.json"

if [ ! -f "$RR_BIN" ]; then echo "FATAL: qualified binary not found at $RR_BIN"; exit 2; fi
if [ ! -f "$RUN_DIR/rule-corrected.json" ]; then echo "FATAL: run prepare.mjs first"; exit 2; fi

if [ "$MODE" = "offline" ]; then
  PROXY_EXTRA="--offline"
else
  PROXY_EXTRA=""
  if [ -z "${OPENROUTER_API_KEY:-}" ]; then echo "FATAL: OPENROUTER_API_KEY not present"; exit 2; fi
  if [ -z "${OPENROUTER_BASE_URL:-}" ]; then echo "FATAL: OPENROUTER_BASE_URL not present"; exit 2; fi
fi

export MSYS_NO_PATHCONV=1
w() { cygpath -w "$1"; }

docker rm -f "$PROXY_NAME" >/dev/null 2>&1

echo "== starting proxy ($MODE, label $LABEL) =="
docker run -d --name "$PROXY_NAME" \
  --platform linux/amd64 \
  -e OPENROUTER_API_KEY -e OPENROUTER_BASE_URL \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$TOOLING"):/pilot:ro" \
  -w /run \
  m2-ocr-rr7:local \
  node /pilot/openrouter-bounded-proxy.mjs \
    $PROXY_EXTRA \
    --stage "$STAGE" \
    --port "$PORT" \
    --max-requests "$CAP" \
    --max-input-tokens "$STAGE_INPUT_TOKENS" \
    --max-output-tokens "$STAGE_OUTPUT_TOKENS" \
    --request-input-tokens "$REQ_INPUT_TOKENS" \
    --request-output-tokens "$REQ_OUTPUT_TOKENS" \
    --request-timeout-ms 150000 \
    --model openai/gpt-6.1-terra \
    --service-tier default \
    --effort medium \
    --ledger "$LEDGER" > /dev/null || { echo "FATAL: proxy failed to start"; docker logs "$PROXY_NAME"; exit 2; }

ready=0
for i in $(seq 1 60); do
  if docker exec "$PROXY_NAME" node -e "const s=require('net').connect($PORT,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != "1" ]; then echo "FATAL: proxy not ready"; docker logs "$PROXY_NAME"; docker rm -f "$PROXY_NAME" >/dev/null 2>&1; exit 2; fi
echo "== proxy ready on 127.0.0.1:$PORT =="

usage_before="$(node -e "fetch('https://openrouter.ai/api/v1/key',{headers:{authorization:'Bearer '+process.env.OPENROUTER_API_KEY}}).then(r=>r.json()).then(j=>console.log(String(j.data.usage))).catch(()=>console.log('unavailable'))")"
echo "== provider key usage before: $usage_before =="

echo "== running qualified 1.14.0-rr.1 on $LABEL (to $TO) =="
OCR_INNER=$(cat <<INNER
set -e
mkdir -p /tmp/home/.opencodereview
cp /run/home/.opencodereview/config.json /tmp/home/.opencodereview/config.json
chmod 700 /tmp/home /tmp/home/.opencodereview
chmod 600 /tmp/home/.opencodereview/config.json
export HOME=/tmp/home
export XDG_CONFIG_HOME=/tmp/home/.config
export XDG_CACHE_HOME=/tmp/home/.cache
exec /rr/opencodereview-linux-amd64 review --reviewrouter-managed --provider reviewrouter --model openai/gpt-6.1-terra --repo /fixture/repo --from $BASE --to $TO --rule /run/rule-corrected.json --background-file /run/background-$LABEL.txt --effort medium --concurrency 1 --format json --audience agent --timeout 20 --max-tokens-budget 400000 --output $RESULT
INNER
)
set +e
docker run --rm --name "d12-recheck-ocr-$LABEL-$MODE" \
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
  > "$RUN_DIR/ocr-stdout-$LABEL-$MODE.log" 2> "$RUN_DIR/ocr-stderr-$LABEL-$MODE.log"
ocr_exit=$?
set -e
echo "== ocr exit=$ocr_exit =="

sleep 1
usage_after="$(node -e "fetch('https://openrouter.ai/api/v1/key',{headers:{authorization:'Bearer '+process.env.OPENROUTER_API_KEY}}).then(r=>r.json()).then(j=>console.log(String(j.data.usage))).catch(()=>console.log('unavailable'))")"
echo "== provider key usage after: $usage_after =="

docker logs "$PROXY_NAME" > "$RUN_DIR/proxy-log-$LABEL-$MODE.txt" 2>&1
docker rm -f "$PROXY_NAME" >/dev/null 2>&1

node -e "
const fs=require('fs');
const run=process.argv[1], label=process.argv[2], mode=process.argv[3], before=process.argv[4], after=process.argv[5], exit=Number(process.argv[6]);
const ledgerFile=run+'/ledger-ocr-'+label+'-'+mode+'.jsonl';
const lines=fs.existsSync(ledgerFile)?fs.readFileSync(ledgerFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const fwd=lines.filter(l=>l.decision==='forwarded');
const refused=lines.filter(l=>l.decision==='refused');
const inTok=fwd.reduce((s,l)=>s+(l.chargedInputTokens||0),0);
const outTok=fwd.reduce((s,l)=>s+(l.chargedOutputTokens||0),0);
// Conservative charge: dearest observed input rate (cache write) and output rate.
const IN_USD=1.25/1e6, OUT_USD=5.0/1e6;
const resultFile=run+'/ocr-result-'+label+'-'+mode+'.json';
const result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
const summary={
  schema:'d12.corrected-ocr-stage/v1',
  label,
  mode,
  comparator:'QUALIFIED 1.14.0-rr.1 DEVELOPMENT OCR CANDIDATE',
  ruleDocumentSha256:require('crypto').createHash('sha256').update(fs.readFileSync(run+'/rule-corrected.json')).digest('hex'),
  backgroundSha256:require('crypto').createHash('sha256').update(fs.readFileSync(run+'/background-'+label+'.txt')).digest('hex'),
  exitCode:exit,
  requests:{forwarded:fwd.length,refused:refused.length},
  refusals:refused.map(r=>({code:r.code,inputBytes:r.inputBytes,ceiling:r.ceiling})),
  inputBytes:fwd.map(l=>l.inputBytes),
  maxInputBytes:Math.max(0,...fwd.map(l=>l.inputBytes)),
  ceilings:{requestInputBytes:Number("${REQ_INPUT_TOKENS}"),stageInputTokens:Number("${STAGE_INPUT_TOKENS}"),stageOutputTokens:Number("${STAGE_OUTPUT_TOKENS}"),requestOutputTokens:Number("${REQ_OUTPUT_TOKENS}")},
  requested:{model:'openai/gpt-6.1-terra',serviceTier:'default',effort:'medium'},
  observed:fwd.map(l=>({status:l.status,model:l.observedModel,provider:l.observedProvider,usagePresent:l.usagePresent})),
  usage:{inputTokens:inTok,outputTokens:outTok},
  chargedUsdConservative:Number(((inTok*IN_USD)+(outTok*OUT_USD)).toFixed(8)),
  stageWorstCaseUsd:Number(((Number("${STAGE_INPUT_TOKENS}")*IN_USD)+(Number("${STAGE_OUTPUT_TOKENS}")*OUT_USD)).toFixed(8)),
  providerKeyUsage:{before,after,delta:(before!=='unavailable'&&after!=='unavailable')?Number((Number(after)-Number(before)).toFixed(8)):'unavailable'},
  halted:fwd.length?fwd[fwd.length-1].halted:null,
  result: result?{status:result.status,terminal:result.manifest&&result.manifest.terminal_state,comments:(result.comments||[]).length,outcome:result.reviewrouter_outcome}:null,
  resultPath:'ocr-result-'+label+'-'+mode+'.json',
  ledger:ledgerFile.replace(run,'/run')
};
fs.writeFileSync(run+'/stage-summary-ocr-'+label+'-'+mode+'.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({label,exitCode:exit,forwarded:fwd.length,refused:refused.length,inputTokens:inTok,outputTokens:outTok,comments:summary.result&&summary.result.comments,terminal:summary.result&&summary.result.terminal,delta:summary.providerKeyUsage.delta},null,2));
" "$(cygpath -w "$RUN_DIR")" "$LABEL" "$MODE" "$usage_before" "$usage_after" "$ocr_exit"

echo "== done =="
