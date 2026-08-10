#!/usr/bin/env bash
# End-to-end integration check for the MXD data platform against a RUNNING server
# with MXD_DATA_PLATFORM_ENABLED=true (roadmap §8/§26). Unlike the DB harnesses
# (which exercise the SQL layer directly), this drives the assembled application
# over HTTP: auth guard -> feature guard -> authz -> service -> repo -> Postgres.
#
# Self-seeding: registers the first workspace/admin (one-time /auth/setup), then
# exercises the full surface. Run against a throwaway server+DB, e.g.:
#   MXD_BASE=http://localhost:3999/api bash test/mxd-data/mxd-data-e2e-check.sh
set -uo pipefail
B="${MXD_BASE:-http://localhost:3999/api}"
CJ="$(mktemp)"
pass=0; fail=0
jd() { python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d) if isinstance(d,dict) else d;print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
post() { curl -s -m 10 -b "$CJ" -X POST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
code() { curl -s -m 10 -b "$CJ" -o /dev/null -w '%{http_code}' -X POST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
check() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; pass=$((pass+1)); else echo "  FAIL  $3 (got:$1 want:$2)"; fail=$((fail+1)); fi; }

# --- seed (first-run) or log in
SETUP=$(curl -s -m 10 -c "$CJ" -X POST "$B/auth/setup" -H 'Content-Type: application/json' \
  -d '{"name":"Admin","email":"admin@mxd.test","password":"password123","workspaceName":"MxD E2E"}')
if ! echo "$SETUP" | grep -q 'defaultSpaceId'; then
  curl -s -m 10 -c "$CJ" -X POST "$B/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@mxd.test","password":"password123"}' >/dev/null
fi
SPACE=$(post spaces '{"page":1,"limit":1}' | jd "d['items'][0]['id']")
[ -n "$SPACE" ] || { echo "FAIL: no space (auth failed?)"; exit 1; }

PAGE=$(post pages/create '{"spaceId":"'$SPACE'","title":"E2E page"}' | jd "d['id']")
TT=$(post mxd/tables/create '{"pageId":"'$PAGE'","title":"People"}')
TID=$(echo "$TT" | jd "d['id']"); PRIM=$(echo "$TT" | jd "d['primaryFieldId']")
[ -n "$TID" ] || { echo "FAIL: table not created"; exit 1; }
check "$(post mxd/views/list '{"tableId":"'$TID'"}' | jd "len(d)")" "1" "table created with default grid view"
AGE=$(post mxd/fields/add '{"tableId":"'$TID'","name":"Age","type":"number"}' | jd "d['id']")

R1=$(post mxd/records/create '{"tableId":"'$TID'","cells":{"'$PRIM'":"Alice","'$AGE'":30}}')
R1ID=$(echo "$R1" | jd "d['id']"); R1V=$(echo "$R1" | jd "d['version']")
post mxd/records/create '{"tableId":"'$TID'","cells":{"'$PRIM'":"Bob","'$AGE'":"20"}}' >/dev/null
post mxd/records/create '{"tableId":"'$TID'","cells":{"'$PRIM'":"Carol","'$AGE'":45}}' >/dev/null
check "$(echo "$R1" | jd "d['data']['$AGE']")" "30" "number cell parsed+stored (30)"
check "$(code mxd/records/create '{"tableId":"'$TID'","cells":{"'$AGE'":"nope"}}')" "400" "invalid number value -> 400"
check "$(code mxd/records/create '{"tableId":"'$TID'","cells":{"ghost":"x"}}')" "400" "unknown field id -> 400"

Q=$(post mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$AGE'","op":"gt","value":25}]},"sorts":[{"fieldId":"'$AGE'","direction":"asc"}]}}')
check "$(echo "$Q" | jd "d['total']")" "2" "server-side filter age>25 -> 2 records"
check "$(echo "$Q" | jd "d['items'][0]['data']['$PRIM']")" "Alice" "server-side sort asc (Alice before Carol)"

post mxd/records/update '{"tableId":"'$TID'","recordId":"'$R1ID'","version":'$R1V',"cells":{"'$AGE'":31}}' >/dev/null
check "$(code mxd/records/update '{"tableId":"'$TID'","recordId":"'$R1ID'","version":'$R1V',"cells":{"'$AGE'":99}}')" "409" "stale-version update -> 409"
check "$(post mxd/views/create '{"tableId":"'$TID'","type":"board","name":"Board"}' | jd "d['type']")" "board" "board view created"
check "$(code mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$AGE'","op":"contains","value":"x"}]}}}')" "400" "illegal operator (inline) -> 400"
INJ=$(post mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$PRIM'","op":"equals","value":"Alice'"'"' OR 1=1 --"}]}}}')
check "$(echo "$INJ" | jd "d['total']")" "0" "SQL-injection value inert (0 rows)"
check "$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$B/mxd/tables/get" -H 'Content-Type: application/json' -d '{"tableId":"'$TID'"}')" "401" "unauthenticated -> 401"

# --- relations (roadmap §30-32)
CO=$(post mxd/tables/create '{"pageId":"'$PAGE'","title":"Companies"}')
CO_T=$(echo "$CO" | jd "d['id']"); CO_P=$(echo "$CO" | jd "d['primaryFieldId']")
REL_F=$(post mxd/fields/add '{"tableId":"'$TID'","name":"Employer","type":"relation","config":{"relatedTableId":"'$CO_T'","single":true}}' | jd "d['id']")
check "$([ -n "$REL_F" ] && echo ok)" "ok" "relation field created (valid relatedTableId)"
check "$(code mxd/fields/add '{"tableId":"'$TID'","name":"Bad","type":"relation","config":{"relatedTableId":"00000000-0000-0000-0000-000000000000"}}')" "400" "relation to non-existent table -> 400"
ACME=$(post mxd/records/create '{"tableId":"'$CO_T'","cells":{"'$CO_P'":"Acme"}}' | jd "d['id']")
check "$(code mxd/relations/link '{"tableId":"'$TID'","fieldId":"'$REL_F'","fromRecordId":"'$R1ID'","toRecordId":"'$ACME'"}')" "200" "link record->Acme"
check "$(post mxd/relations/list '{"tableId":"'$TID'","fieldId":"'$REL_F'","recordId":"'$R1ID'"}' | jd "d[0]['data']['$CO_P']")" "Acme" "listRelated returns Acme"
# IDOR: linking to a People record (not in Companies) via Employer -> 400
check "$(code mxd/relations/link '{"tableId":"'$TID'","fieldId":"'$REL_F'","fromRecordId":"'$R1ID'","toRecordId":"'$R1ID'"}')" "400" "link outside related table -> 400 (IDOR)"

rm -f "$CJ"
echo ""; echo "E2E: $pass passed, $fail failed"
exit $fail
