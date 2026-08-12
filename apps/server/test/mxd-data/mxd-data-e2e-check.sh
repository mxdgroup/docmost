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
# regression: an updated cell reads back as its value (jsonb stored as an OBJECT,
# not a double-encoded string) — the bug the lookup E2E surfaced.
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['data']['$AGE']")" "31" "read-back after update returns the new value (jsonb not double-encoded)"
# formula field (roadmap §34-36): {age} * 2, computed on read
DBL=$(post mxd/fields/add '{"tableId":"'$TID'","name":"Doubled","type":"formula","config":{"expression":"{'$AGE'} * 2"}}' | jd "d['id']")
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['data']['$DBL']")" "62" "formula {age}*2 -> 62"
check "$(code mxd/fields/add '{"tableId":"'$TID'","name":"BadF","type":"formula","config":{"expression":"1 +"}}')" "400" "invalid formula -> 400"
# review regressions: computed fields are not filterable/sortable (values aren't in jsonb -> would silently match nothing)
check "$(code mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$DBL'","op":"gt","value":1}]}}}')" "400" "filter on a formula field -> 400 (computed not filterable)"
check "$(code mxd/records/query '{"tableId":"'$TID'","config":{"sorts":[{"fieldId":"'$DBL'","direction":"asc"}]}}')" "400" "sort on a formula field -> 400 (computed not sortable)"
# review regression: between on a DATE field must not 500 (compiler casts by type)
DUE=$(post mxd/fields/add '{"tableId":"'$TID'","name":"Due","type":"date"}' | jd "d['id']")
DR1V=$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['version']")
post mxd/records/update '{"tableId":"'$TID'","recordId":"'$R1ID'","version":'$DR1V',"cells":{"'$DUE'":"2026-06-15"}}' >/dev/null
check "$(code mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$DUE'","op":"between","value":["2026-01-01","2026-12-31"]}]}}}')" "200" "between on a date field -> 200 (no numeric-cast 500)"
check "$(code mxd/records/query '{"tableId":"'$TID'","config":{"filter":{"combinator":"and","conditions":[{"fieldId":"'$DUE'","op":"between","value":["2026-06-15"]}]}}}')" "400" "between with a 1-element array -> 400"
# buttons (roadmap §37-38): declarative, server-authorized actions
BTN=$(post mxd/fields/add '{"tableId":"'$TID'","name":"SetAge","type":"button","config":{"actions":[{"type":"setField","fieldId":"'$AGE'","value":100},{"type":"openUrl","url":"https://example.com/go"}]}}' | jd "d['id']")
check "$([ -n "$BTN" ] && echo ok)" "ok" "button field created"
check "$(code mxd/fields/add '{"tableId":"'$TID'","name":"BadBtn","type":"button","config":{"actions":[{"type":"runShell","cmd":"x"}]}}')" "400" "button with arbitrary action type -> 400"
RUN=$(post mxd/buttons/run '{"tableId":"'$TID'","fieldId":"'$BTN'","recordId":"'$R1ID'"}')
check "$(echo "$RUN" | jd "d['directives'][0]['url']")" "https://example.com/go" "button run returns openUrl directive"
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['data']['$AGE']")" "100" "button setField applied (Age -> 100)"
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

# --- lookups / rollups (roadmap §8/§33) — R1 is linked to Acme (single relation)
CO_REV=$(post mxd/fields/add '{"tableId":"'$CO_T'","name":"Rev","type":"number"}' | jd "d['id']")
AREV=$(post mxd/records/get '{"tableId":"'$CO_T'","recordId":"'$ACME'"}' | jd "d['version']")
post mxd/records/update '{"tableId":"'$CO_T'","recordId":"'$ACME'","version":'$AREV',"cells":{"'$CO_REV'":50}}' >/dev/null
ROLL=$(post mxd/fields/add '{"tableId":"'$TID'","name":"CoRev","type":"rollup","config":{"viaFieldId":"'$REL_F'","targetFieldId":"'$CO_REV'","rollup":"sum"}}' | jd "d['id']")
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['data']['$ROLL']")" "50" "rollup sum over relation -> 50"
AREV2=$(post mxd/records/get '{"tableId":"'$CO_T'","recordId":"'$ACME'"}' | jd "d['version']")
post mxd/records/update '{"tableId":"'$CO_T'","recordId":"'$ACME'","version":'$AREV2',"cells":{"'$CO_REV'":75}}' >/dev/null
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$R1ID'"}' | jd "d['data']['$ROLL']")" "75" "rollup recomputes on source change -> 75 (no stale cache)"

# --- automations (roadmap §39-40) — trigger -> action rules run server-side,
# synchronously within the write (emitAsync), bounded by a loop-depth guard.
STATUS=$(post mxd/fields/add '{"tableId":"'$TID'","name":"Status","type":"text"}' | jd "d['id']")
A1=$(post mxd/automations/create '{"tableId":"'$TID'","name":"On create","trigger":{"type":"record_created"},"actions":[{"type":"setField","fieldId":"'$STATUS'","value":"auto"}]}')
check "$(echo "$A1" | jd "1 if d.get('id') else 0")" "1" "automation rule created"
check "$(post mxd/automations/list '{"tableId":"'$TID'"}' | jd "len(d)")" "1" "automations/list returns the rule"
# a new record fires record_created -> the rule sets Status synchronously
RAUTO=$(post mxd/records/create '{"tableId":"'$TID'","cells":{"'$PRIM'":"Zeb"}}' | jd "d['id']")
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$RAUTO'"}' | jd "d['data']['$STATUS']")" "auto" "record_created automation applied on create (sync)"
# loop guard: field_changed(Status) -> set Status; must terminate (no-op stop),
# not recurse forever. Update Status manually to trigger it.
post mxd/automations/create '{"tableId":"'$TID'","name":"On status change","trigger":{"type":"field_changed","fieldId":"'$STATUS'"},"actions":[{"type":"setField","fieldId":"'$STATUS'","value":"looped"}]}' >/dev/null
RAV=$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$RAUTO'"}' | jd "d['version']")
post mxd/records/update '{"tableId":"'$TID'","recordId":"'$RAUTO'","version":'$RAV',"cells":{"'$STATUS'":"manual"}}' >/dev/null
check "$(post mxd/records/get '{"tableId":"'$TID'","recordId":"'$RAUTO'"}' | jd "d['data']['$STATUS']")" "looped" "field_changed automation applied + loop terminates (no infinite recursion)"

# --- record history / audit — append-only trail per mutation (own table, so the
# earlier automations on TID don't inject extra Status-update entries)
HT=$(post mxd/tables/create '{"pageId":"'$PAGE'","title":"History Table"}')
HTID=$(echo "$HT" | jd "d['id']"); HPRIM=$(echo "$HT" | jd "d['primaryFieldId']")
HREC=$(post mxd/records/create '{"tableId":"'$HTID'","cells":{"'$HPRIM'":"Hist"}}')
HRID=$(echo "$HREC" | jd "d['id']"); HRV=$(echo "$HREC" | jd "d['version']")
post mxd/records/update '{"tableId":"'$HTID'","recordId":"'$HRID'","version":'$HRV',"cells":{"'$HPRIM'":"Hist2"}}' >/dev/null
HH=$(post mxd/records/history '{"tableId":"'$HTID'","recordId":"'$HRID'"}')
check "$(echo "$HH" | jd "1 if len(d)>=2 else 0")" "1" "history has >=2 entries (create + update)"
check "$(echo "$HH" | jd "d[0]['action']")" "update" "history is most-recent-first (update on top)"
check "$(echo "$HH" | jd "1 if any(e['action']=='create' for e in d) else 0")" "1" "history includes the create entry"
check "$(echo "$HH" | jd "d[0]['changedFieldIds']")" "['$HPRIM']" "history records the changed field ids"

# --- calendar/gallery/board view rules (roadmap F) — type-aware validation
check "$(code mxd/views/create '{"tableId":"'$TID'","type":"calendar"}')" "400" "calendar view without a date field -> 400"
check "$(post mxd/views/create '{"tableId":"'$TID'","type":"calendar","config":{"displayFieldId":"'$DUE'"}}' | jd "d['type']")" "calendar" "calendar view with a date field -> created"
check "$(code mxd/views/create '{"tableId":"'$TID'","type":"board","config":{"groupByFieldId":"'$DBL'"}}')" "400" "board grouped by a formula field -> 400"
check "$(post mxd/views/create '{"tableId":"'$TID'","type":"gallery","config":{"displayFieldId":"'$PRIM'"}}' | jd "d['type']")" "gallery" "gallery view created"

# --- search (roadmap: search) — OR-of-contains over text fields, injection-safe
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"Ali"}' | jd "d['total']")" "1" "search 'Ali' finds 1 record (Alice)"
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"Ali"}' | jd "d['items'][0]['data']['$PRIM']")" "Alice" "search returns the matching record"
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"nonexistent-zzz"}' | jd "d['total']")" "0" "search miss -> 0"
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"zzz'\'' OR 1=1 --"}' | jd "d['total']")" "0" "search injection payload inert (0 rows)"
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"   "}' | jd "d['total']")" "0" "blank search -> 0 (short-circuit)"

# --- CSV import/export (roadmap: CSV) — round-trips data through real validation
CT=$(post mxd/tables/create '{"pageId":"'$PAGE'","title":"CSV Table"}')
CTID=$(echo "$CT" | jd "d['id']")
TITLEF=$(post mxd/fields/add '{"tableId":"'$CTID'","name":"Title","type":"text"}' | jd "d['id']")
SCOREF=$(post mxd/fields/add '{"tableId":"'$CTID'","name":"Score","type":"number"}' | jd "d['id']")
# import 2 valid rows + 1 with a bad number (should be reported, not abort)
IMP=$(post mxd/records/import-csv '{"tableId":"'$CTID'","csv":"Title,Score,Ghost\nAda,10,x\nBob,20,y\nCarol,notanumber,z"}')
check "$(echo "$IMP" | jd "d['created']")" "2" "CSV import created 2 valid rows"
check "$(echo "$IMP" | jd "len(d['errors'])")" "1" "CSV import reported 1 bad-number row (no abort)"
check "$(echo "$IMP" | jd "d['errors'][0]['row']")" "4" "CSV import error points at the right line (row 4)"
check "$(echo "$IMP" | jd "'Ghost' in d['unmappedColumns']")" "True" "CSV import reports unmapped column"
# export back and confirm the data round-trips
EXP=$(post mxd/records/export-csv '{"tableId":"'$CTID'"}')
check "$(echo "$EXP" | jd "d['rowCount']")" "2" "CSV export returns 2 rows"
check "$(echo "$EXP" | jd "1 if 'Ada' in d['csv'] and 'Bob' in d['csv'] else 0")" "1" "CSV export contains imported values"
check "$(echo "$EXP" | jd "1 if all(c in d['csv'].split(chr(10))[0] for c in ('Title','Score')) else 0")" "1" "CSV export header includes field names"

# --- forms (public form → creates a record; anonymous submit path)
FORM=$(post mxd/forms/create '{"tableId":"'$TID'","title":"Signup","fieldIds":["'$PRIM'","'$AGE'"]}')
FKEY=$(echo "$FORM" | jd "d['key']")
check "$(echo "$FORM" | jd "1 if d.get('key') else 0")" "1" "form created with a public key"
check "$(code mxd/forms/create '{"tableId":"'$TID'","fieldIds":["'$DBL'"]}')" "400" "form rejects a computed field"
PUB=$(post mxd/public/forms/get '{"key":"'$FKEY'"}')
check "$(echo "$PUB" | jd "len(d['fields'])")" "2" "public form exposes only its 2 whitelisted fields"
check "$(echo "$PUB" | jd "d['title']")" "Signup" "public form returns its title"
post mxd/public/forms/submit '{"key":"'$FKEY'","values":{"'$PRIM'":"FormSubmitted","'$AGE'":30}}' >/dev/null
check "$(post mxd/records/search '{"tableId":"'$TID'","query":"FormSubmitted"}' | jd "d['total']")" "1" "public submit created a record (found via search)"
check "$(code mxd/public/forms/submit '{"key":"'$FKEY'","values":{"'$DBL'":1}}')" "400" "public submit rejects a field not on the form"
check "$(code mxd/public/forms/get '{"key":"nonexistent-key"}')" "404" "unknown form key -> 404"

# --- public embedded-table reads on a share (anonymous, read-only)
# Share the E2E page, then hit the /mxd/public/data/* endpoints with NO cookie
# (anon) — they must resolve the table via the share and return read-only data.
SH=$(post shares/create '{"pageId":"'$PAGE'","mode":"view"}')
SKEY=$(echo "$SH" | jd "d['key']")
check "$(echo "$SH" | jd "1 if d.get('key') else 0")" "1" "share created with a public key"
anon() { curl -s -m 10 -X POST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
anoncode() { curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
check "$(anon mxd/public/data/table '{"shareKey":"'$SKEY'","tableId":"'$TID'"}' | jd "d['id']")" "$TID" "anon reads the shared table by key (no auth)"
check "$(anon mxd/public/data/fields '{"shareKey":"'$SKEY'","tableId":"'$TID'"}' | jd "1 if any(f['id']=='$PRIM' for f in d) else 0")" "1" "anon lists the table fields"
check "$(anon mxd/public/data/records '{"shareKey":"'$SKEY'","tableId":"'$TID'","limit":200}' | jd "1 if d['total']>=3 else 0")" "1" "anon queries the table records"
# A table on a DIFFERENT, unshared page must 404 through this share (scope
# enforcement — the anon reader can't reach tables outside the share's subtree).
OP=$(post pages/create '{"spaceId":"'$SPACE'","title":"Other page"}' | jd "d['id']")
OTID=$(post mxd/tables/create '{"pageId":"'$OP'","title":"Offscope"}' | jd "d['id']")
check "$(anoncode mxd/public/data/table '{"shareKey":"'$SKEY'","tableId":"'$OTID'"}')" "404" "anon read of a table outside the share scope -> 404"
check "$(anoncode mxd/public/data/table '{"shareKey":"'$SKEY'","tableId":"00000000-0000-0000-0000-000000000000"}')" "404" "anon read of an unknown table -> 404"
check "$(anoncode mxd/public/data/table '{"shareKey":"nope-nope","tableId":"'$TID'"}')" "404" "anon read with an unknown share key -> 404"

rm -f "$CJ"
echo ""; echo "E2E: $pass passed, $fail failed"
exit $fail
