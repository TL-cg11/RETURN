# RE:TURN — WebMCP 툴 카탈로그 (고도화판)

> 이 문서는 `TECH_SPEC.md`의 기능 명세를 **에이전트에 노출할 WebMCP 툴 계약**으로 구체화한 것이다.
> 계획서(`RETURN_PLAN.md`)의 원래 18개(Community 6 + Curator 12)를 **계약 수준에서 고도화**하고,
> 조사 흐름의 실제 공백 1개(`get_evidence_detail`)를 채워 **카탈로그 19개**로 확정한다.

## 0. 결정 요약

| 항목 | 결정 |
|---|---|
| 카탈로그 총량 | **19개** — Community **6** + Curator **13** |
| 최대 동시 노출 | **13개** (role-scoped 등록, 두 surface 동시 로드 없음) |
| 개수 방향 | 늘리지 않음. "고도화"는 **개수가 아니라 계약(schema·annotation·응답·정책 바인딩)** |
| 병합 여부 | `build_provenance_timeline`과 `compare_evidence`는 **분리 유지** (Swiss-army 다기능 툴 회피) |
| 신규 | `get_evidence_detail` — consent/visibility redaction, `sealed` 존재 은닉 |
| 개명 | `draft_label` → **`save_label_draft`** (내부 draft를 저장하므로 write) |
| 계약 수정 | `readOnlyHint` 모순 제거, 4개 표준 annotation 명시, `untrustedContentHint`는 비표준 → compat 격리 + 응답 `trust` 병행 |
| 삭제/추가 금지 | evidence 삭제·authority 승격·실제 반환 툴은 **추가하지 않음** (권한 모델 위배) |

**왜 개수를 안 늘리나:** 두 surface는 역할별로만 등록되어 모델이 한 번에 보는 최대치는 13개다. 툴 품질의 80%는 스키마·계약에서 나오며, 대규모·중복 surface는 선택 정확도와 컨텍스트 효율을 떨어뜨린다. (출처: [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [MCP Tool Schema Design 2026](https://kansei-link.com/en/insights/mcp-tool-schema-design-guide-2026.html))

---

## 1. 공통 계약 (Cross-cutting conventions)

모든 툴은 아래 규약을 따른다. 개별 절에서는 **차이나는 부분만** 표기한다.

### 1.1 이름 · 등록
- 이름 ≤30자, 소문자 snake_case, 동사_명사. 역할 접두사 없음(등록 자체가 role-scoped).
- 등록: `document.modelContext.registerTool()` 우선, `navigator.modelContext`는 legacy fallback (`document.modelContext ?? navigator.modelContext`).
- 해제: 등록별 `AbortController` → `registerTool(spec, { signal })` → role 전환·unmount 시 `abort()`. **`unregisterTool()`는 스펙에 없음** (TECH_SPEC §G2).
- Community 페이지는 Curator 툴을 절대 등록하지 않음(등록 분리 + 서버 재검증 이중 방어).

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

### 1.4 응답 형식 (discriminated union)
- **성공(read):** `{ status:"ok", data, refs?, request_id, trust?:"untrusted" }`
- **성공(write, 즉시):** `{ status:"applied", risk, data, refs, request_id }`
- **승인 대기:** `{ status:"pending_approval", risk:"HIGH", approval_id, reason, next, request_id }`
- **거부:** `{ status:"denied", risk, policy, message, next, escalation_id?, retryable, request_id }`
- **입력오류:** `{ status:"invalid", field, message, next, retryable:true, request_id }`
- **모든 non-success에 `next` 필수.** `next`는 `{ tool?, args_patch?, human? }`로 다음 행동을 구조적으로 제시한다.
- 출력 ~1.5K자 이내: 긴 본문 대신 ID·요약·`refs` 반환. 원문은 `get_evidence_detail`로 별도 조회.

### 1.5 정책 바인딩 (전 툴 공통)
모든 툴은 서버에서 순서대로 통과한다: **schema → role → tenancy → record 존재 → risk → consent/visibility → assertion×authority → justification provenance → (HIGH시) immutable snapshot → activity log.** (TECH_SPEC §D)
- 제출은 항상 `authority:"submitted"`. community는 `verified` 부여 불가.
- HIGH↑ **agent** action이 refs 없음 또는 전부 submitted → **denied + escalation** (실행 아님).
- `sealed`는 어떤 출력에도 포함 금지(존재조차 노출 안 함).

### 1.6 위험 등급
`LOW`=즉시+기록 · `MEDIUM`=즉시+피드강조 · `HIGH`=미실행+approval queue · `CRITICAL`=툴로 제공 안 함.

---

## 2. Community 툴 (6) — `/` 공개 컬렉션

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
    "consent":{"enum":["private","research_only","public_anonymous","public_attributed"]} } }
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
    "limit":{"type":"integer","minimum":1,"maximum":100,"default":50} } }
```

### 3.3 `list_submissions` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":[],
  "properties":{
    "status":{"enum":["received","needs_information","under_review","linked_to_record","closed"]},
    "evidence_type":{"type":"string","maxLength":40},
    "requested_outcome":{"type":"string","maxLength":40},
    "limit":{"type":"integer","minimum":1,"maximum":100,"default":50} } }
```
- 반환 community 콘텐츠는 외부 제출물이므로 응답에 `trust:"untrusted"`, compat `untrustedContentHint:true`. 본문은 요약, 원문은 `get_evidence_detail`.

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

### 3.6 `compare_evidence` — LOW · read · **trust:untrusted**
```jsonc
{ "type":"object","additionalProperties":false,"required":["object_id","evidence_refs"],
  "properties":{
    "object_id":{"type":"string","pattern":"^[a-z0-9-]{3,64}$"},
    "evidence_refs":{"type":"array","items":{"type":"string"},"minItems":2,"maxItems":24},
    "focus":{"enum":["date","place","ownership","identity","access","all"],"default":"all"} } }
```
- 출력 분리: 직접 확인 / 출처 있는 주장 / 자료 간 충돌 / 미답 질문 / 공개·인용 제한.

### 3.7 `get_evidence_detail` — LOW · read · **trust:untrusted** ★신규★
```jsonc
{ "type":"object","additionalProperties":false,"required":["evidence_id"],
  "properties":{ "evidence_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{3,64}$"} } }
```
- 개별 evidence 원문을 **consent·visibility에 따라 redaction**하여 반환. `research_only`/`private`은 직접 인용 불가로 표기하되 메타데이터는 노출.
- **`sealed`는 존재 자체를 숨긴다:** 존재하지 않는 ID와 **완전히 동일한** 응답을 반환해야 한다 — `{status:"invalid", field:"evidence_id", message:"No evidence with that id.", next, retryable:true}`. `policy:"sealed_hidden"` 같은 구별되는 거부를 반환하면 "그 ID에 sealed 자료가 있다"는 사실이 새어나가므로 금지. (sealed 접근 시도는 서버 audit log에만 별도 기록.)
- 1.5K 응답 예산에서 case 요약(§3.4)과 원문 조회를 분리하는 목적.

### 3.8 `save_label_draft` — LOW · **write** (개명: `draft_label`→)
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
- annotations: **`readOnly:false`**, `destructive:false`, `idempotent:false`, `openWorld:false`. (기존 `draft_label`의 `readOnlyHint:true`는 draft를 **저장**하므로 계약 모순 → 수정.)
- 내부 draft만 저장, 공식 미공개이므로 risk=LOW. 각 assertion ref≥1; `open_question`은 경계 evidence≥2 또는 명시적 gap record 참조.

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
- 정책: refs 비면 거부 · 전부 submitted면 거부+escalation · private/research_only 직접 인용 포함 시 거부 · `verified_fact`가 submitted-only면 거부 · 검증 근거 있어도 **HIGH → approval queue** · 승인 직전 draft snapshot hash 재비교.
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

계약 정리 후 대표 WebMCP eval에서 아래를 만족하면 현행 surface 유지:
- 툴 선택 + **필수 인자** 정확도 **≥ 95%**
- 인접(유사) 툴 혼동율 **≤ 2%**
- 툴 정의 토큰 예산 충족(정의당 100–500 토큰 수준)

**실패 시**(위 미달): Curator surface를 **단계별 동적 노출 7–9개**로 축소한다 — 예: 기본 노출 = summary/list_objects/list_submissions/get_review_case/get_evidence_detail/compare_evidence/save_label_draft, 승인·검토 개시(propose_label_update/open_return_review/check_approval/list_pending_approvals)는 case 진입 후 lazy 등록. "고정 개수 절벽"이 아니라 중복도·설명 품질·컨텍스트 비용으로 판단한다. (출처: [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use))

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
