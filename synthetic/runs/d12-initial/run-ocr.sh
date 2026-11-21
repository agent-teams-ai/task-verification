#!/usr/bin/env bash
# D1/D2 initial ordinary-OCR stage.
#
#   MODE=offline  -> loopback proxy answers locally: measures the exact request
#                    bodies, spends nothing, contacts no provider
#   MODE=live     -> loopback proxy forwards to OpenRouter under the stage caps
#
# The OCR container never holds the provider credential. The proxy runs in its
# own container and the OCR container joins that container's network namespace,
# so rr.7's only reachable inference endpoint is 127.0.0.1:<port>.
set -o pipefail

MODE="${MODE:-offline}"
RUN_DIR="$(cd "$(dirname "$0")" && pwd)"
SYN="$(cd "$RUN_DIR/../.." && pwd)"
REPO="$SYN/repo"
TOOLING="$SYN/tooling"
RR7_DIR="${RR7_DIR:-/tmp/rr7}"
PORT=8787
PROXY_NAME="d12-proxy-$MODE"
STAGE="d12-$MODE-ocr"
LEDGER="/run/ledger-$MODE.jsonl"

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

echo "== starting proxy ($MODE) =="
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
    --max-requests 6 \
    --max-input-tokens 120000 \
    --max-output-tokens 24000 \
    --request-input-tokens 20000 \
    --request-output-tokens 4000 \
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
docker logs "$PROXY_NAME" 2>&1 | tail -3

usage_before="$(node -e "fetch('https://openrouter.ai/api/v1/key',{headers:{authorization:'Bearer '+process.env.OPENROUTER_API_KEY}}).then(r=>r.json()).then(j=>console.log(String(j.data.usage))).catch(()=>console.log('unavailable'))")"
echo "== provider key usage before: $usage_before =="

echo "== running pinned rr.7 =="
# rr.7 requires a private (0600) managed config file. A Windows bind mount can
# never satisfy that, so the config is copied into the container's own writable
# layer and chmod'ed there; the mount stays read-only. No credential is in it.
OCR_INNER=$(cat <<INNER
set -e
mkdir -p /tmp/home/.opencodereview
cp /run/home/.opencodereview/config.json /tmp/home/.opencodereview/config.json
chmod 700 /tmp/home /tmp/home/.opencodereview
chmod 600 /tmp/home/.opencodereview/config.json
export HOME=/tmp/home
export XDG_CONFIG_HOME=/tmp/home/.config
export XDG_CACHE_HOME=/tmp/home/.cache
exec /rr7/opencodereview-linux-amd64 review --reviewrouter-managed --provider reviewrouter --model openai/gpt-6.1-terra --repo /fixture/repo --from ce99b0d65d645124413a746ecb137b5497aad80f --to 23864e3c877f2b34bbbdd90c4527ef46eb19cbd9 --rule /run/rule.json --background-file /run/background.txt --effort medium --concurrency 1 --format json --audience agent --timeout 15 --max-tokens-budget 144000 --output /run/ocr-result-$MODE.json
INNER
)
set +e
docker run --rm --name "d12-ocr-$MODE" \
  --platform linux/amd64 \
  --network "container:$PROXY_NAME" \
  -v "$(w "$REPO"):/fixture/repo:ro" \
  -v "$(w "$RUN_DIR"):/run" \
  -v "$(w "$RR7_DIR"):/rr7:ro" \
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
  > "$RUN_DIR/ocr-stdout-$MODE.log" 2> "$RUN_DIR/ocr-stderr-$MODE.log"
ocr_exit=$?
set -e
echo "== rr.7 exit=$ocr_exit =="

sleep 1
usage_after="$(node -e "fetch('https://openrouter.ai/api/v1/key',{headers:{authorization:'Bearer '+process.env.OPENROUTER_API_KEY}}).then(r=>r.json()).then(j=>console.log(String(j.data.usage))).catch(()=>console.log('unavailable'))")"
echo "== provider key usage after: $usage_after =="

docker logs "$PROXY_NAME" > "$RUN_DIR/proxy-log-$MODE.txt" 2>&1
docker rm -f "$PROXY_NAME" >/dev/null 2>&1

node -e "
const fs=require('fs');
const run=process.argv[1], mode=process.argv[2], before=process.argv[3], after=process.argv[4], exit=Number(process.argv[5]);
const ledgerFile=run+'/ledger-'+mode+'.jsonl';
const lines=fs.existsSync(ledgerFile)?fs.readFileSync(ledgerFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const fwd=lines.filter(l=>l.decision==='forwarded');
const refused=lines.filter(l=>l.decision==='refused');
const inTok=fwd.reduce((s,l)=>s+(l.chargedInputTokens||0),0);
const outTok=fwd.reduce((s,l)=>s+(l.chargedOutputTokens||0),0);
const summary={
  schema:'d12.ocr-stage-summary/v1',
  mode,
  exitCode:exit,
  requests:{forwarded:fwd.length,refused:refused.length,cap:6},
  refusals:refused.map(r=>({code:r.code,stage:r.stage})),
  inputBytes:fwd.map(l=>l.inputBytes),
  maxInputBytes:Math.max(0,...fwd.map(l=>l.inputBytes)),
  requested:{model:'openai/gpt-6.1-terra',serviceTier:'default',effort:'medium'},
  observed:fwd.map(l=>({status:l.status,model:l.observedModel,provider:l.observedProvider,usagePresent:l.usagePresent})),
  usage:{inputTokens:inTok,outputTokens:outTok,chargedUsd:(inTok/1e6*1.0)+(outTok/1e6*5.0)},
  providerKeyUsage:{before,after,delta:(before!=='unavailable'&&after!=='unavailable')?(Number(after)-Number(before)):'unavailable'},
  halted:fwd.length?fwd[fwd.length-1].halted:null,
  ledger:ledgerFile.replace(run,'/run')
};
fs.writeFileSync(run+'/stage-summary-'+mode+'.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
" "$(cygpath -w "$RUN_DIR")" "$MODE" "$usage_before" "$usage_after" "$ocr_exit"

echo "== done =="
