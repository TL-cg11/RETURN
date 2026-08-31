# RE:TURN — WebMCP 툴 카탈로그 (고도화판)

> 이 문서는 `TECH_SPEC.md`의 기능 명세를 **에이전트에 노출할 WebMCP 툴 계약**으로 구체화한 것이다.
> 계획서(`RETURN_PLAN.md`)의 원래 18개(Community 6 + Curator 12)를 **계약 수준에서 고도화**하고,
> 조사 흐름의 실제 공백 1개(`get_evidence_detail`)를 채워 **카탈로그 19개**로 확정한다.
>
> **2026-08-29 — 배포본과 대조 완료.** 설계 이후 구현에서 뒤집힌 결정이 세 곳 있었고, 이 문서가
> 그것을 따라오지 못하고 있었다. §0의 두 행(`get_evidence_detail` 철회, `save_label_draft` 개명 철회)과
> §1.4(응답 형식)를 **코드에 맞춰 고쳤다.** 계약을 판정할 때의 기준은 `lib/webmcp/tools.ts`(카탈로그)와
> `app/api/tools/[name]/route.ts`(서버)이며, 이 문서는 그 둘을 설명한다.

## 0. 결정 요약

| 항목 | 결정 |
|---|---|
| 카탈로그 총량 | **22개** (고유 이름 기준) — Community 전용 **7** + Curator 전용 **13** + **Shared 2** |
| 구현 상태 | 이 문서는 **배포본과 대조 완료(2026-08-29)**. 아래 두 항목(`get_evidence_detail`, `save_label_draft`)은 설계 단계의 결정이었고 구현에서 뒤집혔다. 취소선으로 남긴다 — 계약 판정의 기준은 **코드(`lib/webmcp/tools.ts`)** 다 |
| 최대 동시 노출 | **15개** — Curator 표면에 등록되는 총량(고유 13 + Shared 2). Community 표면은 9개. role-scoped 등록이므로 두 surface 동시 로드는 없음 |
| 개수 방향 | **FR-X2에서 완화됨.** 자산 파이프라인이 범위에 들어오면서 FR-W1의 3개를 추가했다. 그 외에는 여전히 늘리지 않으며, "고도화"는 **개수가 아니라 계약(schema·annotation·응답·정책 바인딩)** |
| Shared surface | `list_object_assets` · `get_asset_detail` 은 **양쪽 표면에 등록된다.** 같은 호출이 역할에 따라 다르게 답해야 하기 때문이다 — 커뮤니티는 public·공개동의 자산만, 큐레이터는 restricted 까지. 허용 여부가 아니라 **내용**이 역할에 따라 갈린다 |
| 병합 여부 | `build_provenance_timeline`과 `compare_evidence`는 **분리 유지** (Swiss-army 다기능 툴 회피) |
| ~~신규~~ **철회** | ~~`get_evidence_detail`~~ — **구현하지 않았다.** 조사 흐름의 공백이라고 본 것은 실제로는 `get_review_case`(§3.4)가 이미 메우고 있었다: 케이스 한 건의 evidence를 consent·visibility redaction과 `sealed` 은닉까지 적용해 돌려주므로, 같은 redaction을 한 번 더 구현한 단건 툴은 표면만 넓히고 답은 늘리지 않았다. Curator 전용 13개는 이 자리를 `register_object`(§3C)가 채운다 |
| ~~개명~~ **철회** | ~~`draft_label` → `save_label_draft`~~ — **개명하지 않았다.** 개명의 전제였던 "내부 draft를 저장한다"가 틀렸다. 구현된 `draft_label`은 아무것도 쓰지 않고 초안 문자열과 assertion을 계산해 돌려줄 뿐이며, 저장은 `propose_label_update`의 승인 스냅샷이 한다. 이름은 `draft_label`, `readOnly: true` 로 유지 |
| 계약 수정 | `readOnlyHint` 모순 제거, 4개 표준 annotation 명시, `untrustedContentHint`는 비표준 → compat 격리 + 응답 `untrusted_content` 병행 |
| 인자 엄격성 | 등록 스키마는 `additionalProperties:false`, 서버는 **선언되지 않은 인자를 거부**하고 **선언된 required 누락을 required 오류로** 답한다 (§1.3A) |
| 삭제/추가 금지 | evidence 삭제·authority 승격·실제 반환 툴은 **추가하지 않음** (권한 모델 위배) |

**왜 개수를 안 늘리나:** 두 surface는 역할별로만 등록되어 모델이 한 번에 보는 최대치는 15개다(Curator 표면). 툴 품질의 80%는 스키마·계약에서 나오며, 대규모·중복 surface는 선택 정확도와 컨텍스트 효율을 떨어뜨린다. (출처: [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [MCP Tool Schema Design 2026](https://kansei-link.com/en/insights/mcp-tool-schema-design-guide-2026.html))

---

## 1. 공통 계약 (Cross-cutting conventions)

모든 툴은 아래 규약을 따른다. 개별 절에서는 **차이나는 부분만** 표기한다.

### 1.1 이름 · 등록
- 이름 ≤30자, 소문자 snake_case, 동사_명사. 역할 접두사 없음(등록 자체가 role-scoped).
- 등록: `document.modelContext.registerTool()` 우선, `navigator.modelContext`는 legacy fallback (`document.modelContext ?? navigator.modelContext`).
- 해제: 등록별 `AbortController` → `registerTool(spec, { signal })` → role 전환·unmount 시 `abort()`. **`unregisterTool()`는 스펙에 없음** (TECH_SPEC §G2).
- **등록 표면은 페이지가 아니라 세션 role 을 따른다 (V10-8).** 종전에는 "community 페이지 = community 툴"
  이었고, 그래서 `role=curator` 쿠키를 든 채 `/` 나 `/objects/[id]` 에 온 세션 — 콘솔의
  "Open record →" 링크가 정확히 그 경로다 — 이 community 툴 9개를 등록받고, 그 9개 전부가
  서버에서 `403 Community role required` 로 돌아왔다. 쓸 수 있다고 광고한 툴이 하나도 안 되는
  상태였다. 등록은 **이 세션이 호출할 수 있는 것**을 광고하는 일이므로 role 을 읽는다.
- Curator 툴은 **curator 세션에만** 등록된다. 등록 분리는 편의이고, 경계는 서버 재검증이다
  (`/api/tools/<name>` 이 매 호출마다 role 을 다시 본다).

### 1.2 inputSchema 예산
- `type:"object"`, `additionalProperties:false`, 명시적 `required`.
- **상위 필드 ≤ 8, 필수 ≤ 5, 중첩 ≤ 2단계.** 초과 시 툴 분할.
- 모든 파라미터에 `description`(≤150자), 가능한 경우 `enum`, 문자열 `maxLength`, 배열 `minItems/maxItems`, ID는 `pattern`.
- flat 우선. 관련 필드는 예산 초과 시에만 1단계 객체로 그룹화.

### 1.3 Annotations (표준 4개 + compat 1개)
표준 MCP `ToolAnnotations` 4개를 **항상 명시**한다. (출처: [MCP ToolAnnotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools))

| annotation | 의미 | 이 프로젝트 규칙 |
|---|---|---|
| `readOnlyHint` | 상태 미변경 | 순수 read=true; 저장/제출/제안=false |
| `destructiveHint` | 되돌릴 수 없는 파괴 | **전 툴 false** (삭제·덮어쓰기 툴 없음) |
| `idempotentHint` | 반복 호출 안전 | read/check/list=true; 매 호출 새 레코드 생성=false |
| `openWorldHint` | 외부 개방 세계 접근 | **전 툴 false** (닫힌 museum workspace 한정) |

- `untrustedContentHint`는 **표준 annotation이 아님** → WebMCP compat 확장으로 격리하고, **응답 body의 `trust:"untrusted"` + UI badge**로 이중 표기한다. annotation은 보안 경계가 아니라 힌트이며, 실제 강제는 서버 정책이 한다.

### 1.3A 인자 엄격성 (V10-1 · V10-2)

등록 스키마의 `additionalProperties:false`(§1.2)를 **서버가 실제로 강제한다.**

- **선언되지 않은 인자는 거부한다.** 종전에는 `submit_evidence` 가 정의된 적 없는 `object_hint` 를
  받고 `applied` 로 답했다. 에이전트에게 그것은 "그 필드가 기록됐다"로 읽힌다 — 값을 조용히
  잘라 저장하던 것과 같은 실패다. 응답은 `invalid` + 그 필드 이름 + **이 툴이 받는 인자 목록**이다.
- **선언된 `required` 누락은 required 오류로 답한다.** 종전에는 두 제출 툴의 세 필드에만 검사가
  있어서, `object_id` 같은 id 는 전부 조회로 흘러가 "No object with that id is in this collection."
  으로 돌아왔다 — 인자를 **빼먹은** 호출이 id가 **틀렸다**는 답을 받았다. 지금은 카탈로그의
  `required` 를 그대로 읽어 전 툴에 적용하고, recovery 로 그 필드의 카탈로그 description 을 준다.
- 두 검사는 이 순서로 돈다. required 를 오타 낸 호출이 "그런 필드는 없다"를 먼저 읽어야
  자기가 실제로 보낸 이름을 알 수 있기 때문이다.

### 1.4 응답 형식 (discriminated union)

> **설계 당시 `status`/`request_id`/구조화된 `next` 로 적었으나, 구현은 4필드 계약으로 수렴했다.**
> 아래는 배포본이 실제로 답하는 형식이다. 판별자는 `status` 가 아니라 **`outcome`** 이고,
> 다음 행동은 객체가 아니라 **한 줄 문자열 `recovery`** 다. `request_id` 는 도입하지 않았다 —
> 이 표면은 상관 추적이 필요한 비동기 호출이 없고, HIGH 는 `approval_id`·`escalation_id` 로
> 이미 추적된다.

- **성공(read):** 봉투 없이 **데이터 그 자체.** `outcome` 을 싣지 않는다. 읽기는 아무것도
  결정하지 않으므로 결정을 보고하지 않는다. `untrustedContentHint:true` 인 툴은 `untrusted_content:true` 를 함께 싣는다.
- **성공(write, 즉시):** `{ outcome:"applied", risk, reason, …데이터 }`
- **승인 대기:** `{ outcome:"pending_approval", risk:"HIGH", reason, approval_id|review_id, next }`
- **거부:** `{ outcome:"denied", risk, policy, reason, recovery, escalation_id?, escalated_to_curator? }`
- **입력오류:** `{ outcome:"invalid", field, reason, recovery }`
- **예기치 않은 실패:** `{ outcome:"error", reason, recovery }` (§1.5)
- **모든 non-success에 `recovery` 필수** — 무엇을 하면 되는지 한 문장으로 말한다.
- **read 툴은 write 봉투를 쓰지 않는다 (V10-3).** `build_provenance_timeline` 이
  `readOnlyHint:true` 인 채로 `{"outcome":"applied","risk":"LOW"}` 를 돌려주고 있었다.
  쓰지 않은 호출이 쓰기의 봉투를 입으면 annotation 이 거짓말이 된다.
- **출력 예산은 응답 종류에 따라 둘로 나뉜다.**
  - **단건 응답**(하나의 record를 읽는 툴): **~1.5K자 이내.** 긴 본문 대신 ID·요약·`refs` 반환. 원문은 별도 조회.
  - **목록 응답**(`list_*`): 절대 크기가 아니라 **페이지 크기에 유계**여야 한다. 즉 응답 크기는 `limit`에 비례하고, workspace에 레코드가 몇 건 쌓였는지와 무관해야 한다.
- **왜 목록을 예외로 두는가:** 이 예산이 막으려는 것은 "응답이 큰 것"이 아니라 **"응답이 통제 불능으로 커지는 것"**이다. 실측하면 triage에 필요한 최소 필드만 남겨도 목록 한 행이 약 230자이므로, 1.5K에는 5~6행밖에 담기지 않는다. §3.2·§3.3이 정한 기본값과 산술적으로 양립할 수 없다. 유계성을 강제하면 workspace가 900건이 되어도 응답 크기는 그대로이므로 원래 의도는 달성된다.
- 목록 툴은 `count`(전체)와 `returned`(이번 페이지)를 함께 반환하고, 잘렸다면 `next`로 좁히는 방법을 제시한다.

### 1.5 정책 바인딩 (전 툴 공통)
모든 툴은 서버에서 순서대로 통과한다: **schema → role → tenancy → record 존재 → risk → consent/visibility → assertion×authority → justification provenance → (HIGH시) immutable snapshot → activity log.** (TECH_SPEC §D)

**응답 계약.** 모든 답은 `outcome` 을 싣는다. 값은 다섯 가지다 —
`applied` · `pending_approval` · `denied` · `invalid`, 그리고 **`error`**.
`error` 는 예기치 않은 실패에만 쓴다(EA-1): 적용되지도, 큐에 들어가지도, 정책에 거부되지도,
호출자의 실수도 아닌 경우다. 종전에는 이 경우 플랫폼의 **본문 없는 500** 이 그대로 나가서
에이전트가 읽을 것도 시도할 것도 없었다. `error` 응답은 `reason` 과 `recovery` 를 함께 싣고,
원래 예외는 서버 로그에 남는다.

**선언한 `required` 는 강제한다 (F4-1).** 카탈로그가 required 로 적은 파라미터는 서버가 실제로
요구한다. `open_return_review` 만 `basis` 가 없을 때 서버가 문구를 지어내고 통과시키고 있었다.
17개 required 파라미터를 하나씩 빼며 확인했고, 지금은 전부 강제된다.

**모르는 툴 이름도 계약 안에서 답한다 (F4-4).** `{"error":"Unknown tool"}` 이 아니라
`invalid` + `field:"name"` 이다. 이 표면의 모든 응답이 `outcome` 을 싣는다.

**범위 밖 인자는 구부리지 않는다 (F4-5).** `list_submissions.limit` 은 1–100 의 정수여야 하고,
벗어나면 `invalid` 다. 종전에는 -5 를 1 로, 0 을 20 으로 조용히 바꿨다. 생략은 기본값 20 이며,
이는 보정이 아니다.

**인자 본문.** 파싱되지 않는 본문은 `invalid` + `field:"body"` 로 거부한다(OB-3). 종전에는
`{}` 로 읽어서, 질의 없는 검색처럼 그럴듯한 성공으로 보였다. 본문이 아예 없으면 인자 없는
호출로 그대로 처리한다.
- 제출은 항상 `authority:"submitted"`. community는 `verified` 부여 불가.
- HIGH↑ **agent** action이 refs 없음 또는 전부 submitted → **denied + escalation** (실행 아님).
- `sealed`는 어떤 출력에도 포함 금지(존재조차 노출 안 함).

### 1.6 위험 등급
`LOW`=즉시+기록 · `MEDIUM`=즉시+피드강조 · `HIGH`=미실행+approval queue · `CRITICAL`=툴로 제공 안 함.

---

## 2. Community 툴 (6) — `/` 공개 컬렉션

> FR-W1의 `attach_assets` 를 더해 Community 표면은 실제로 **7개**다. 계약은 §3B.1 에 있다.

> 범주 원칙(각 description에 baked-in):
> **Reads are free. Contributions add evidence to review; they do not change the official record.**

### 2.1 `search_collection` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":[],
  "properties":{
    "q":{"type":"string","maxLength":200,"description":"물건·장소·시기·기록 공백을 설명하는 검색어."},
    "origin":{"type":"string","maxLength":80},
    "period":{"type":"string","maxLength":40},
    "object_type":{"type":"string","maxLength":40},
    "has_provenance_gap":{"type":"boolean","description":"provenance 공백이 있는 유물만."},
    "has_open_questions":{"type":"boolean"},
    "limit":{"type":"integer","minimum":1,"maximum":50,"default":20} } }
```
- annotations: `readOnly:true, destructive:false, idempotent:true, openWorld:false`
- 출력: `objects[]` 요약(id, title, origin, period, provenance_completeness, gap_count, open_question_count, new_submission_count). 원문 라벨/증거 미포함.

### 2.2 `get_object_detail` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id"],
  "properties":{ "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"} } }
```
- 출력: 현재 공식 라벨, accession, 공개 이미지, 공개 provenance 요약, open questions, contribution 수. **민감 자료는 존재 여부만 표시, 내용 미반환.**

### 2.3 `get_provenance_timeline` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "include_submitted":{"type":"boolean","default":true,"description":"submitted 이벤트 포함 여부."} } }
```
- 출력: event[] `{id,start_date?,end_date?,custodian?,location?,status:"claimed|verified|disputed|gap",authority:"submitted|verified",evidence_refs[]}`.

### 2.4 `submit_evidence` — MEDIUM · write ★파라미터 예산 상한★
```jsonc
{ "type":"object","additionalProperties":false,
  "required":["object_id","evidence_type","title","consent"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "evidence_type":{"enum":["image","document","oral_history","catalog","correspondence","field_note"]},
    "title":{"type":"string","maxLength":140},
    "body":{"type":"string","maxLength":4000},
    "asset_ids":{"type":"array","items":{"type":"string"},"maxItems":8,"description":"사전 등록된 Asset ID. raw 바이너리 금지."},
    "source":{"type":"object","additionalProperties":false,"properties":{
      "name":{"type":"string","maxLength":120},"relationship":{"type":"string","maxLength":120}}},
    "provenance":{"type":"object","additionalProperties":false,"properties":{
      "date_or_period":{"type":"string","maxLength":60},"place":{"type":"string","maxLength":120}}},
    "consent":{"enum":["private","public_anonymous","public_attributed"]} } }
```
- annotations: `readOnly:false, destructive:false, idempotent:false, openWorld:false`
- 서버는 항상 `authority:"submitted", status:"received"`로 저장. **agent가 `verified` 전달 불가.**
- 상위 8필드(예산 상한). `source`·`provenance`는 예산을 지키려 1단계 그룹화(중첩 ≤2 준수).

### 2.5 `submit_context_claim` — MEDIUM · write
```jsonc
{ "type":"object","additionalProperties":false,
  "required":["object_id","claim_type","body"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "claim_type":{"enum":["identity","date","place","ownership","meaning","access","other"]},
    "body":{"type":"string","maxLength":4000},
    "evidence_refs":{"type":"array","items":{"type":"string"},"maxItems":12},
    "requested_outcome":{"enum":["review","label_correction","access_review","stewardship_review"]} } }
```
- `requested_outcome`은 **요청일 뿐 행동 권한이 아님**(description에 명시).

### 2.6 `check_submission` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":["submission_id"],
  "properties":{ "submission_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"} } }
```
- 출력: `status` ∈ received|needs_information|under_review|linked_to_record|reflected_in_label|closed. **거절·보완 시 반드시 이유와 `next` 반환.**

---

## 3. Curator 툴 (13) — `/curator` 콘솔

> 범주 원칙(description baked-in):
> **Reads and drafting are free. Publishing to the official record needs the curator.**

### 3.1 `get_collection_summary` — LOW · read · 인자 없음
- 출력: 총 소장품 수, gap 유물 수, 새 제출 수, 검토 case 수, approval 대기 수, access review 수, 최근 활동.

### 3.2 `list_objects` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":[],
  "properties":{
    "has_gap":{"type":"boolean"},
    "has_new_submissions":{"type":"boolean"},
    "review_status":{"enum":["none","open","pending_approval","resolved"]},
    "visibility":{"enum":["public","restricted","sealed"]},
    "limit":{"type":"integer","minimum":1,"maximum":100,"default":20} } }
```
- **구현 인자는 `status` 하나다.** 컬렉션이 쓰지 않는 status 는 `invalid` 로 거부하고, 그 workspace가
  실제로 쓰는 status 목록을 recovery 로 준다 **(V10-5)**. 종전에는 `{count:0}` 으로 답해서,
  "그 상태인 유물이 없다" 와 "그런 상태는 없다" 가 구분되지 않았다. 어휘는 여기 적지 않고
  컬렉션에서 읽으므로, 새 status 가 생겨도 이 검사가 그것을 거부하지 않는다.

### 3.3 `list_submissions` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":[],
  "properties":{
    "status":{"enum":["received","needs_information","under_review","linked_to_record","closed"]},
    "evidence_type":{"type":"string","maxLength":40},
    "requested_outcome":{"type":"string","maxLength":40},
    "limit":{"type":"integer","minimum":1,"maximum":100,"default":20} } }
```
- 반환 community 콘텐츠는 외부 제출물이므로 응답에 `trust:"untrusted"`, compat `untrustedContentHint:true`.
- **목록 행은 본문을 싣지 않는다.** triage에 필요한 것만 반환한다: `id`, `object_id`, `kind`, `title`, `consent`, `status`, `quotable`, `authority`, `created_at`. 원문은 `get_review_case`(카탈로그상 `get_evidence_detail`)로 읽는다. 본문을 아예 담지 않으므로 consent 제한이 목록을 통해 샐 수 없다.
- 기본 `limit`은 **20**이다(§1.4의 유계성 규칙). 20행이 약 4.5K, 50행이면 약 11K가 되어 §1.4의 단건 예산과 혼동되기 쉬우므로, 목록은 유계성으로만 판정한다.
- **구현 `status` 어휘는 `received` · `needs information` · `under review` · `reflected in label` · `closed`** 이며,
  그 밖의 값은 빈 페이지가 아니라 `invalid` 다 **(V10-5)** — 빈 페이지는 "그런 상태가 없다"를
  "그 상태인 기여가 없다"로 읽히게 한다.

### 3.4 `get_review_case` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":["case_id"],
  "properties":{ "case_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"} } }
```
- 1회 호출로: object 요약, 현재 공식 라벨, verified/submitted evidence, 충돌 주장, timeline gaps, consent 제한, 이전 결정, open questions.

### 3.5 `build_provenance_timeline` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "evidence_refs":{"type":"array","items":{"type":"string"},"maxItems":24},
    "include_gaps":{"type":"boolean","default":true} } }
```
- **내부 검토용 연표 초안**만 반환(공식 timeline 미변경, 미저장). 출력: `{draft_events[],gaps[],conflicts[],unanswered_questions[]}`.
- `compare_evidence`와 **의도·출력이 다름**(연표 구성 vs 관점별 대조) → 분리 유지.
- **구현 현황 (MCP-E7).** 배포된 툴은 인자를 `evidence_ids` 로 받는다. 이 인자는 선언·설명만
  되어 있고 **읽히지 않아서**, 무엇을 인용하든 저장된 연표 전체가 돌아왔다. 지금은 인용한
  증거에 근거한 사건만 남기고 `cited_evidence_ids` 와
  `events_not_resting_on_cited_evidence` 를 함께 반환한다. **공백(gap)은 인용과 무관하게
  전부 유지한다** — 아무도 인용하지 않았다는 이유로 미해결 연도를 빼면 완결된 역사처럼
  읽히고, 그것이 이 기록이 절대 유도해서는 안 되는 독해다. 인용이 없으면 종전대로 전체를
  반환하고 `note` 가 그렇다고 밝힌다. 해석되지 않는 id 는 `propose_label_update` 와 같은
  검사를 거쳐 `invalid` 로 거부된다.

### 3.6 `compare_evidence` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id","evidence_refs"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "evidence_refs":{"type":"array","items":{"type":"string"},"minItems":2,"maxItems":24},
    "focus":{"enum":["date","place","ownership","identity","access","all"],"default":"all"} } }
```
- 출력 분리: 직접 확인 / 출처 있는 주장 / 자료 간 충돌 / 미답 질문 / 공개·인용 제한.
- **구현 인자는 `evidence_ids` 하나다**(`object_id`·`focus` 는 구현하지 않음). `minItems:2` 는
  카탈로그에 선언되고 **서버가 강제한다 (V10-6)** — 종전에는 id 한 개짜리 호출이 자기 자신과의
  비교로 답했고, 충돌 0건·counterpart 없음이 돌아오면서 비교가 일어나지 않았다는 말은
  어디에도 없었다. 상한 초과 시 recovery 문구는 "`12` 이하로 보내라"이며, 종전의
  "`12` 미만으로 보내라"는 상한 자체와 어긋나 있었다.

### 3.7 ~~`get_evidence_detail`~~ — **철회 · 구현하지 않음**

> 이 절은 **설계 기록으로만 남긴다.** 배포본에 `get_evidence_detail` 은 없다.
> 단건 evidence 조회가 메우려던 공백은 `get_review_case`(§3.4)가 이미 메우고 있었고 —
> 케이스 한 건의 evidence 를 consent·visibility redaction 과 `sealed` 은닉까지 적용해
> 돌려준다 — 같은 redaction 을 한 번 더 구현한 툴은 표면만 넓히고 답을 늘리지 않았다.
> 아래 `sealed` 규칙은 **폐기되지 않았다.** `get_asset_detail`(§3B.3)이 그것을 그대로 따른다:
> 다른 workspace 의 자산과 모든 `sealed` 자산은 존재하지 않는 id 와 **동일한** `invalid` 로 답한다.
>
> ```jsonc
> { "type":"object","additionalProperties":false,"required":["evidence_id"],
>   "properties":{ "evidence_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"} } }
> ```

- **`compare_evidence` 의 계약 (EA-2).** 배포된 `compare_evidence` 는 `get_review_case` 와 한 핸들러를 공유하되
  **계약은 하나다.** 인용 id 가 evidence 로 해석되지 않으면 review case 응답으로 넘어가지 않고
  `invalid` + `field:"evidence_ids"` 로 거부한다. 종전에는 기여 id 를 넘기면 키 구성이 전혀 다른
  review case 가 돌아왔고, 어느 계약으로 답했는지 알리는 필드도 없었다.
- **`sealed`는 존재 자체를 숨긴다:** 존재하지 않는 ID와 **완전히 동일한** 응답을 반환해야 한다 — `{status:"invalid", field:"evidence_id", message:"No evidence with that id.", next, retryable:true}`. `policy:"sealed_hidden"` 같은 구별되는 거부를 반환하면 "그 ID에 sealed 자료가 있다"는 사실이 새어나가므로 금지. (sealed 접근 시도는 서버 audit log에만 별도 기록.)
- 1.5K 응답 예산에서 case 요약(§3.4)과 원문 조회를 분리하는 목적.

### 3.8 `draft_label` — LOW · **read** (~~개명: `save_label_draft`~~ 철회)
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id","body","assertions"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "draft_id":{"type":"string","description":"기존 draft 갱신 시. 없으면 새 draft 생성."},
    "title":{"type":"string","maxLength":140},
    "body":{"type":"string","maxLength":6000},
    "assertions":{"type":"array","minItems":1,"maxItems":40,"items":{
      "type":"object","additionalProperties":false,"required":["text","mode","refs"],
      "properties":{
        "text":{"type":"string","maxLength":600},
        "mode":{"enum":["verified_fact","attributed_claim","open_question"]},
        "refs":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":12}}}} } }
```
- annotations: **`readOnly:true`**, `destructive:false`, `idempotent:true`, `openWorld:false`.
- **개명이 철회된 이유.** 개명의 전제는 "이 툴이 draft 를 저장하므로 `readOnlyHint:true` 는
  계약 모순"이었다. 그 전제가 틀렸다 — 구현된 `draft_label` 은 아무것도 쓰지 않고 초안 문자열과
  assertion 을 **계산해서 돌려줄** 뿐이며, 저장은 `propose_label_update` 의 승인 스냅샷이 한다.
  저장하지 않는 툴에 write 이름과 write annotation 을 붙이는 쪽이 오히려 모순이므로,
  이름도 annotation 도 그대로 둔다. 위 스키마의 `body`·`assertions`·`draft_id` 는 저장을 전제한
  설계이며 **구현되지 않았다.** 실제 인자는 `object_id`(required)와 `evidence_ids` 두 개다.
- 공식 미공개이므로 risk=LOW. 각 assertion ref≥1; `open_question`은 경계 evidence≥2 또는 명시적 gap record 참조.
- **구현 현황 (MCP-E7).** 배포된 `draft_label` 은 저장하지 않는 read 툴이며 `evidence_ids` 를
  받는다. 이 인자 역시 선언만 되고 읽히지 않아, 초안은 언제나 그 유물의 증거 전체에
  근거했다. 지금은 인용이 있으면 그 증거만으로 assertion 을 만들고 `rests_on` 을 함께
  반환하며, 제안 단계와 같은 인용 검사를 거친다 — 초안이 `propose_label_update` 가 거부할
  id 를 통과시키지 않는다.

### 3.9 `request_clarification` — MEDIUM · write
```jsonc
{ "type":"object","additionalProperties":false,"required":["submission_id","questions"],
  "properties":{
    "submission_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"},
    "questions":{"type":"array","items":{"type":"string","maxLength":300},"minItems":1,"maxItems":8},
    "message":{"type":"string","maxLength":1000} } }
```
- 허용: 촬영 날짜·장소, 원본 소유, 공개 동의 범위, 관계·출처 확인. **금지: 증언 철회 압박, 민감정보 공개 요구, sealed 자료 유도.**

### 3.10 `propose_label_update` — HIGH · write · approval queue
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id","draft_id","justification"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "draft_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"},
    "justification":{"type":"object","additionalProperties":false,"required":["rationale","refs"],
      "properties":{
        "rationale":{"type":"string","maxLength":2000},
        "refs":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":24}}} } }
```
- 정책: refs 비면 거부 · 전부 submitted면 거부+escalation · private 직접 인용 포함 시 거부 · `verified_fact`가 submitted-only면 거부 · 검증 근거 있어도 **HIGH → approval queue** · 승인 직전 draft snapshot hash 재비교.
- 즉시 게시 아님. `{status:"pending_approval", approval_id, next}` 반환.

### 3.11 `open_return_review` — HIGH · write · approval queue
```jsonc
{ "type":"object","additionalProperties":false,
  "required":["object_id","case_summary","requested_scope","justification"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "case_summary":{"type":"string","maxLength":2000},
    "requested_scope":{"enum":["shared_stewardship","access_restriction","ethical_return_review"]},
    "justification":{"type":"object","additionalProperties":false,"required":["rationale","refs"],
      "properties":{
        "rationale":{"type":"string","maxLength":2000},
        "refs":{"type":"array","items":{"type":"string"},"maxItems":24}}} } }
```
- **물리적 반환 실행 아님** — 공식 검토 절차 "개시" 요청. submitted-only는 agent가 자동 개시 불가(거부+escalation). verified record/human note 포함 시 HIGH queue. 승인은 "검토 시작"만 의미.
- ※ TECH_SPEC §N-2: core provenance rule을 `publish_label`뿐 아니라 이 툴에도 적용하도록 서버 일반화 필요.

### 3.12 `check_approval` — LOW · read
```jsonc
{ "type":"object","additionalProperties":false,"required":["approval_id"],
  "properties":{ "approval_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"} } }
```
- 출력: `status` ∈ pending|approved|approved_with_edit|rejected|expired. **비차단 polling.**

### 3.13 `list_pending_approvals` — LOW · read · 인자 없음
- agent는 polling 중 blocking 없이 다른 작업 계속.

---

## 3A. `check_submission` · `request_clarification` 응답 (FR2-K1)

큐레이터의 질문은 **활동 로그가 아니라 제출물에** 남고, 두 도구가 그것을 실어 나른다.

- `check_submission` 은 **가장 최근 질문 원문**을 `curator_question` 으로 반환하고,
  `questions_asked` 로 총 건수를, `next` 로 답하는 방법을 함께 준다.
  최근 1건만 싣는 이유는 §1.4 의 단건 읽기 출력 예산(1800자) 때문이다 — 오래 이어진 검토가
  이 응답을 예산 밖으로 밀지 않게 한다.
- `request_clarification` 은 저장 후 `questions_asked` 를 돌려주고, 기여자가 읽을 수 있다는
  사실을 `note` 로 말한다. **콘솔과 도구가 같은 곳에 쓴다** — 도구로 물은 질문도 기여자가
  읽어야 하는 질문이기 때문이다.

---

## 3B. 자산 툴 (FR-W1) — Community 1 + Shared 2

**어느 툴도 바이너리를 받지 않는다.** 업로드는 전용 라우트(`POST /api/assets`)가 처리해 `assets`
레코드를 먼저 만들고, 툴은 `asset_ids` 만 주고받는다 (`RETURN_PLAN.md` §15.1). 툴 응답에
`storage_key` 는 절대 포함되지 않는다.

### 3B.1 `attach_assets` — MEDIUM · Community 전용

```json
{ "submission_id": {"type":"string"},
  "asset_ids": {"type":"array","items":{"type":"string"}} }
```

- 이미 업로드된 자산을 **이 워크스페이스의 기여에** 연결한다. 자산은 기여의 `consent` 와 대상 유물을 상속한다.
- **"자기 기여"가 아니다 (EA-5).** 이 문서가 그렇게 적고 있었지만 코드가 검사하는 것은 워크스페이스
  경계뿐이다. 이 데모에는 개인 신원 모델이 없다 — 세션 하나가 워크스페이스 하나이고, 기여에
  작성자 식별자가 없다. 강제할 수 없는 것을 강제한다고 적어두는 쪽이 더 나쁘므로 문구를 코드에
  맞췄다. 소유권을 실제로 걸려면 세션 소유자를 기여에 기록하고 대조해야 하며, 그것은 기능 추가다
- `visibility` 는 건드리지 않는다. 첨부해도 `restricted` 로 남으며, 공개는 큐레이터의 행위다.
- 이미 다른 기여에 붙은 id 는 매칭되지 않는다. 그래서 `attached` 가 `requested` 보다 작게 돌아올 수 있고,
  이것이 남의 기여에 파일을 밀어 넣지 못하게 하는 방식이다.
- **하나도 붙지 않으면 `invalid` + `field:"asset_ids"` 로 거부한다.** 종전에는 `attached:0` 을 담은 채
  `applied` 로 답해서, 에이전트가 실패를 성공으로 읽었다 (MCP-E3).
- 일부만 붙으면 `applied` 이되 **`omitted_asset_ids`** 로 실패한 id 를 이름으로 돌려준다.
  `compare_evidence` 의 `omitted_evidence_ids` 와 같은 규약이다.
- **`attached` 와 `omitted_asset_ids` 는 같은 질문에 답한다 (F4-3)** — 지금 이 기여에 올라와
  있는가. 따라서 항상 `attached + omitted_asset_ids.length === requested` 다. 이미 붙어 있던
  파일도 `attached` 에 든다. 종전에는 `attached` 가 UPDATE 가 바꾼 행 수여서, 재첨부가
  `attached:0` 에 누락도 없는 상태로 돌아왔다.
- 응답: `attached` · `requested` · `total_on_contribution` · `visibility:"restricted"` · (해당 시) `omitted_asset_ids`.

### 3B.2 `list_object_assets` — LOW · read · Shared

```json
{ "object_id": {"type":"string"} }
```

- 한 유물에 붙은 자산 목록을 `assetAccess` 로 걸러 반환한다.
- `restricted` 는 **개수만** `withheld_count` 로 알린다 — 무언가가 보류돼 있다는 사실은 정직하게 밝히되,
  그것이 무엇인지는 밝히지 않는다.
- `sealed` 는 `withheld_count` 에도 포함되지 않는다. 개수 자체가 존재의 누설이기 때문이다 (§5.3).
  큐레이터 표면에서도 마찬가지다 — sealed 는 인간 절차로만 열린다.
- `untrusted_content: true`.

### 3B.3 `get_asset_detail` — LOW · read · Shared

```json
{ "asset_id": {"type":"string"} }
```

- 자산 하나의 메타데이터. **파일 내용은 반환하지 않는다.**
- `sealed` 와 타 워크스페이스 자산은 존재하지 않는 id 와 **동일한 응답**(`invalid`)을 준다.
  403 은 그 자체로 존재의 확인이 되기 때문이다.
- 권한이 없는 자산의 거부는 **막은 관문의 이름을 그대로 쓴다 (V10-4).** `assetAccess` 의 관문은
  visibility 와 consent 로 나뉘므로 거부도 둘로 나뉜다:
  - consent 가 `private` → `denied` + `policy:"consent_not_public"` → "어느 동의 수준인지 물어라"
  - consent 는 공개 가능하나 아직 `restricted` → `denied` + `policy:"visibility_restricted"` → "큐레이터에게 공개를 요청하라"

  종전에는 두 경우 모두 `consent_not_public` 이었다. 흔한 쪽은 두 번째 —
  기여자가 `public_attributed` 로 올렸지만 큐레이터가 아직 공개하지 않은 자산 — 이라서,
  에이전트가 **이미 갖고 있는** 동의를 받으러 갔다가 같은 거부로 돌아왔다.
- 거부는 dead end 가 아니다 (§9.6).

---

## 3C. `register_object` (FR-K5 · FR-X3) — HIGH · Curator 전용

```json
{ "title": {"type":"string"}, "accession": {"type":"string"}, "basis": {"type":"string"},
  "period": {"type":"string"}, "material": {"type":"string"}, "origin": {"type":"string"},
  "evidence_ids": {"type":"array","items":{"type":"string"}} }
```

**결정 (FR-X3):** 새 유물 등록은 커뮤니티에 노출하지 않는다. 큐레이터 UI와 큐레이터 도구
표면 양쪽에서 가능하되, **도구는 제안만 하고 기록을 만들지 않는다.**

- 위험 등급 **HIGH**. 새 유물은 공식 기록을 만드는 행위이므로 `publish_label` 과 같은 칸에 선다
- `open_return_review` 도 같은 등급이며, `basis` 없이는 진행하지 않는다 (F4-1)
- **accession 중복은 제안 단계에서 거부한다 (EA-3).** `objects` 에 유니크 인덱스가 있고 등록
  라우트가 409 를 돌려주므로, 이미 쓰이는 번호를 담은 제안은 실패가 확정돼 있다. 종전에는 제목
  slug 만 검사해서 그 제안이 큐레이터 큐까지 갔고, 사람이 실행하려는 순간에야 막혔다
- 검증된 근거가 있으면 `pending_approval` + 제안이 큐에 남고, 응답은 `created:false` 를 명시한다
- submitted 자료만 인용하면 `submitted_sole_authority` 로 거부하고 escalation 을 만든다
- **아무 증거도 인용하지 않으면 `no_supporting_evidence`** 로 거부한다. 인용이 0건인 호출에
  "제출된 증거는 단독 권위가 될 수 없다" 고 답하는 것은 사실이 아니고, 호출자를 있지도 않은
  인용을 고치러 보낸다 (MCP-E4)
- 제안은 **approval 이 아니라 escalation 큐**에 들어간다. approval 계약(A4)은 불변 라벨
  스냅샷이고 제안된 기록은 그 형태가 아니다. escalation 은 이미 tool·args·큐레이터 조치를 담는다
- 실제 생성은 `POST /api/curator/objects` 가 하며, `confirmed: true` 없이는 409 로 거부한다.
  HIGH 판정이 인간 행위자에게 뜻하는 바가 "명시적 결정"이므로, 폼을 채우는 것만으로는 기록이
  생기지 않는다

---

## 4. 원래 18개 대비 변경 이력

| 구분 | 변경 | 사유 |
|---|---|---|
| 개명 | `draft_label` → `save_label_draft` + `readOnlyHint:false` | draft를 저장하는 write이므로 read-only 계약 모순 제거 |
| 신규 | `get_evidence_detail` (Curator) | case 요약과 개별 원문 조회 분리, consent/visibility redaction·sealed 은닉 (Curator 12→13) |
| 유지(병합 반려) | `build_provenance_timeline` + `compare_evidence` 분리 | 의도·출력 타입이 달라 병합 시 Swiss-army 다기능화 위험 |
| 전 툴 | 4개 표준 annotation 명시, `untrustedContentHint`→compat 격리 + 응답 `trust` | 표준 준수 + 신뢰 경계 이중 표기 |
| 전 툴 | inputSchema 예산(상위≤8/필수≤5/중첩≤2), enum·pattern·length·minItems | 선택 정확도·파싱 안정성 |
| 미추가 | evidence 삭제 / authority 승격 / 실제 반환 / 승인(human) | 권한 모델·CRITICAL 경계상 툴로 노출 금지 |

**최종: Community 6 + Curator 13 = 카탈로그 19개, 최대 동시 노출 13개.**

---

## 5. Eval 수용 게이트 & 안전 밸브

게이트는 세 조항이고, **둘은 카탈로그의 성질이라 지금 측정되며, 하나는 모델의 성질이라
모델 실행이 필요하다.** 이 구분을 흐리지 않는다.

```bash
npm run eval:tools                                  # 정적 게이트
npm run eval:tools -- --prompts                     # 7개 시나리오 프롬프트
npm run eval:tools -- --score answers.json          # 모델이 실제 호출한 것을 채점
```

정적 절반은 `lib/webmcp/eval.ts`에 있고 단위 테스트로도 돈다. 도구가 하나 추가될 때마다
조용히 나빠지는 종류의 값이라, 릴리스 직전이 아니라 매 테스트에서 확인한다.

### 5.1 측정된 값 (FR-W1·FR-K5 이후 22개 기준)

| 조항 | 목표 | 측정 | 판정 |
|---|---|---|---|
| 정의당 컨텍스트 비용 | ≤ 500 토큰 | **23–162** (추정) | 통과 |
| 표면당 등록 비용 | — | Community 9개 **~647** · Curator 15개 **~1035** | 통과 |
| 인접 툴 유사도 | < 0.5 | 최고 **0.227** (`get_object_detail` ↔ `get_provenance_timeline`) | 통과 |
| 툴 선택 + 필수 인자 정확도 | ≥ 95% | **미측정** | 모델 실행 필요 |
| 인접 툴 혼동율 | ≤ 2% | **미측정** | 모델 실행 필요 |

§0이 지목했던 위험 쌍은 모두 낮게 나왔다. 실제로 가장 가까운 것은 HIGH 3종
(`propose_label_update` 0.222 `open_return_review`, 0.182 `register_object`)인데,
셋 다 `evidence_ids`를 받고 셋 다 공식 기록을 건드리니 어휘가 겹치는 것이 당연하다.
그래도 0.5와는 거리가 멀다.

### 5.2 토큰 하한을 걷어낸 이유

이 문서는 원래 정의당 **100–500 토큰**을 요구했다. 실측하면 22개 중 **4개만** 100을 넘는다.

`list_pending_approvals`는 23토큰이다 — "List unresolved consequential actions awaiting a
human curator." 에 파라미터가 없다. 이걸 100토큰으로 만들려면 아무 정보도 더하지 않는 말을
채워야 하고, 그건 선택 정확도를 **떨어뜨린다.** 신호를 희석하기 때문이다.

하한이 잡으려던 것은 "고를 수 없을 만큼 빈약한 정의"였으므로, 그것을 직접 잰다:

- 설명은 **8단어 이상의 완결된 문장**이어야 한다
- 같은 표면의 두 도구는 서로 닮아서는 안 된다 (§5.1의 유사도)
- **쓰기 도구는 자기가 하지 *않는* 일을 말해야 한다.** `not` / `never` / `without` /
  `review` / `approval` 중 하나가 설명에 있어야 통과한다. 에이전트가 자기 호출을 최종적이라
  믿는 것이 이 제품이 막으려는 실패다

셋 다 단위 테스트다. 상한(500)은 컨텍스트 비용에 대한 진짜 제약이므로 그대로 둔다.

### 5.3 실패 시 안전 밸브

**모델 실행이 미달하면**: Curator surface를 **단계별 동적 노출 7–9개**로 축소한다 —
기본 노출 = summary / list_objects / list_submissions / get_review_case / compare_evidence /
draft_label, 승인·검토 개시(`propose_label_update` · `open_return_review` · `check_approval` ·
`list_pending_approvals` · `register_object`)는 case 진입 후 lazy 등록. 자산 읽기 2종은
유물 화면에서만 등록한다.

"고정 개수 절벽"이 아니라 중복도·설명 품질·컨텍스트 비용으로 판단한다.
(출처: [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use))

### 5.4 시나리오 7종

`RETURN_PLAN.md` §20.3의 프롬프트를 `lib/webmcp/eval.ts`의 `EVAL_SCENARIOS`에 채점 가능한
형태로 고정했다. 각 항목은 프롬프트·기대 도구·기대 필수 인자·**decoy**(혼동한 모델이 대신
집을 법한 같은 표면의 도구)를 가진다. decoy가 있어야 혼동율이 계산된다.

| id | 역할 | 재는 것 |
|---|---|---|
| `gap-search` | community | 컬렉션 전체 질문을 단건 읽기로 착각하지 않는가 |
| `photo-to-object` | community | 자료를 내밀기 전에 대상을 먼저 찾는가 |
| `submit-evidence` | community | 주장이 아닌 자료로 다루고 consent를 함께 싣는가 |
| `triage-batch` | curator | 목록·단건·집계를 구분하는가 |
| `draft-label` | curator | 초안이 제안으로 넘어가지 않는가 |
| `denied-recovery` | curator | 게이트웨이 거부 후 같은 호출을 반복하지 않고 `next`를 따르는가 |
| `approval-polling` | curator | 아는 id면 조회, 폴링이 다른 작업을 막지 않는가 |

---
## 6. 구현 타당성 검토 (Implementation feasibility)

실제 `return/` 코드와 대조해 구현 시 걸릴 지점과 처리 방침을 정리한다.

### 6.1 `registerTool` 시그니처 + AbortSignal 위치 — **검증 필요**
- 현재 `register.ts`는 `registerTool({name,description,inputSchema,annotations,execute})` 단일 객체 형태를 쓴다. 본 문서의 "`registerTool(spec,{signal})`"에서 **signal을 두 번째 인자로 받는지, spec 속성으로 받는지**는 대상 브라우저 빌드에서 실측 확인해야 한다.
- **폴백 안전망:** 계획서 §18.3이 "역할 전환 시 페이지 전체 refresh 허용"을 이미 명시한다. AbortSignal 해제가 대상 빌드에서 불안정하면, role 전환을 **full refresh**로 처리해 이전 도구를 확실히 제거한다(데모 안정성 우선). 즉 AbortController는 최적 경로, refresh는 보장 경로.

### 6.2 응답 envelope 마이그레이션 — **기존 dispatcher 전면 리팩터**
- 현재 `/api/tools/[name]/route.ts`는 툴마다 제각각 형태를 반환한다(`{objects}`, `{object:moonbird}`, `evaluatePolicy(...)` 결과 등). §1.4 통일 envelope로 가려면 **공통 래퍼**(`ok(data,{refs,trust})` / `denied(...)` / `invalid(...)` / `pending(...)`)를 만들고 모든 핸들러를 이를 통과시켜야 한다. 값 자체는 문제없으나 전 핸들러 수정 범위임을 인지.

### 6.3 `untrustedContentHint`는 best-effort, `trust` 필드가 진짜 경계
- 비표준 annotation 키라 브라우저가 무시하거나(현재는 통과) 향후 검증에 걸릴 수 있다. **신뢰 경계는 응답 body의 `trust:"untrusted"` + 서버 정책 + UI badge에 둔다.** annotation은 힌트일 뿐 강제가 아니다.

### 6.4 `submit_evidence` 스키마 — flat 10필드 vs nested 8필드 **트레이드오프**
- 모범사례는 "as flat as possible"과 "파라미터 ≤8"을 **동시에** 권한다. submit_evidence는 자연스럽게 10필드라 둘이 충돌한다. 현재 문서는 `source`/`provenance`를 1단계 객체로 묶어 상위 8필드로 맞췄다(중첩 ≤2 준수).
- **대안:** eval에서 에이전트가 nested 형태를 자주 틀리면 flat 10필드로 되돌린다(≤8은 자체 예산이지 스펙 한계가 아님). 이 한 툴은 예산 경계 케이스로 표시하고 eval로 결정.

### 6.5 `propose_label_update` 정책은 draft를 **서버에서 해석**해야 함
- 인자는 `draft_id` + `justification.refs`만 받지만, "`verified_fact`가 submitted-only에 의존하면 거부" 규칙은 **draft의 assertion들과 그 refs authority**를 봐야 판정된다. 따라서 서버가 `draft_id`로 LabelDraft를 로드→assertions→ref authority를 resolve한 뒤 gateway에 `ctx`로 넘겨야 한다(클라이언트 인자만으로 판정 불가).

### 6.6 인자 없는 툴도 **빈 스키마 명시**
- `get_collection_summary`, `list_pending_approvals`는 `inputSchema:{type:"object",properties:{},required:[],additionalProperties:false}`를 반드시 넣는다. 스키마 생략 시 일부 에이전트가 임의 인자를 지어낼 수 있다.

### 6.7 `additionalProperties:false`의 양면
- 잘못된 인자를 거르는 데 유리하나, 에이전트가 여분 필드를 붙이면 즉시 `invalid`가 된다. 이는 의도된 동작이며, `invalid` 응답의 `next.args_patch`로 올바른 형태를 되돌려주어 self-correction을 유도한다.

### 6.8 ID 패턴 실측 정합성 — **통과**
- 시드 object_id(`moonbird-mask`, `riverstone-vessel`, `woven-signal-cloth` …)는 `^[a-z0-9-]{3,64}$`에, evidence/submission/case/approval ID(`EV-068`, `SUB-1042`, `RC-014`, `APR-004`)는 대문자 허용 패턴 `^[A-Za-z0-9_-]{3,64}$`에 모두 부합. object_id만 소문자 전용으로 좁게 유지.

### 6.9 위험 등급 ≠ readOnly (재확인)
- `save_label_draft`는 risk=LOW이면서 `readOnlyHint:false`(write)다. 모순 아님 — risk는 결과 도달 범위, readOnly는 상태 변경 여부로 **독립 축**이다.

**구현 순서 권고:** (1) 공통 응답 래퍼 + inputSchema 상수화 → (2) register.ts를 AbortController(+refresh 폴백)로 교체 → (3) 각 핸들러를 DB·gateway 경유로 전환 → (4) `get_evidence_detail`·`save_label_draft` 추가/개명 → (5) eval로 §5 게이트 측정.

---

## 부록: 출처
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- [MCP ToolAnnotations 명세](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Tool Schema Design Guide 2026](https://kansei-link.com/en/insights/mcp-tool-schema-design-guide-2026.html)
- [WebMCP Draft — Web ML CG](https://webmachinelearning.github.io/webmcp/)

> 유의: 위 WebMCP/MCP 사실은 2026-08 웹 검색에 근거한다. `untrustedContentHint`의 표준화 여부, annotation 필드 집합, `document.modelContext` 우선순위는 스펙 진행에 따라 바뀔 수 있으며, 최종 심사 브라우저 eval에서 재검증한다.
