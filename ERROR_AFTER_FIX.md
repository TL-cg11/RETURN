# ERROR_AFTER_FIX — 배포본 전수 검증 기록

- **대상**: https://webmcp.chocobear159.workers.dev/ (MCP-E1 … E8 수정 반영 후 배포본)
- **검증**: 2026-08-28 · Chrome 151 확장(Claude in Chrome) · 실제 브라우저
- **범위**: WebMCP 툴 22개 전부(양 표면), HTTP 라우트 전부, 화면 기능 전부
- **결론**: 이전 라운드 수정 8건은 **배포본에서 전부 확인됨**. 새로 발견한 결함 **5건**, 관찰 **6건**

---

## 0. 이번 검증이 이전과 달랐던 점

**`document.modelContext`가 실제로 존재한다.**

```json
{"doc":"object","nav":"object","ua":"Chrome/151.0.0.0"}
```

1번 트랙의 리포트는 host API가 없어 `POST /api/tools/<name>`를 직접 호출해 검증했다. 이번에는
Chrome 151 실 브라우저에서 **`document.modelContext.executeTool()` 경로로 툴을 실행**했다.
등록 수는 community 9개 / curator 15개로 카탈로그와 일치한다.

> `executeTool`은 툴 **이름**이 아니라 `getTools()`가 돌려준 **RegisteredTool 객체**를 받는다.
> 이름을 넘기면 `TypeError: The provided value is not of type 'RegisteredTool'`. 인자는 JSON
> **문자열**이고, 반환도 JSON 문자열이다.

**쓰기 검증은 격리 워크스페이스에서 했다.** `POST /api/reset`은 호출한 세션에만 새 `museum_id`를
발급하므로 `museum_demo_01`은 건드리지 않는다. 다만 **MCP-E2 확인만은 오염된 실데이터가 필요해서**
`museum_demo_01`에서 읽기 전용으로 수행했다.

---

## 1. 새로 발견한 결함

### EA-1 · `search_collection`이 49자 이상 질의에 500을 던진다 — **최우선**

**재현** (배포본, WebMCP 경로와 HTTP 경로 모두)

```
executeTool(search_collection, {"query":"aaa…(49자)"})
→ TypeError: Tool was executed but the invocation failed…

POST /api/tools/search_collection  {"query":"aaa…(49자)"}
→ 500,  응답 본문 없음
```

이진 탐색으로 경계를 확정했다.

| 질의 길이 | 결과 |
|---|---|
| 47자 | 200 |
| 48자 | 200 |
| **49자** | **500** |
| 50자 이상 | 500 |

**원인.** `db/queries.ts:127`

```ts
const searchable = "lower(o.title || ' ' || … ) LIKE ?";
const values = trimmed ? [museumId, `%${trimmed}%`] : [museumId];
```

**D1의 LIKE 패턴 길이 상한**이다. `%` 두 개를 포함해 51자가 되는 지점에서 D1이 거부하고, 그
예외를 아무도 잡지 않아 500이 된다. `FIX_REQUEST_2.md`의 FR2-X1과 **정확히 같은 결함 유형**이다.
그때는 승인 쿼리의 LIKE를 문자열 결합으로 바꿔 고쳤는데, 검색의 LIKE는 남아 있었다.

**영향 범위.** `searchObjects`를 호출하는 곳은 `search_collection` 툴 하나뿐이다(확인함).
화면의 유물 선택기는 클라이언트에서 거른다. 즉 **에이전트 표면 전용 결함**이다 — 하필 이번
검증의 주 대상이다.

**두 겹의 문제.**

1. 긴 질의로 검색이 죽는다
2. 죽는 방식이 **본문 없는 500**이다. 툴 표면의 나머지 전체가 `{outcome, field, reason, recovery}`
   4필드 계약을 지키는데 여기만 깨진다. 에이전트는 무엇이 잘못됐는지도, 무엇을 고쳐 재시도할지도
   알 수 없다

**권장.** 질의 길이를 상한(예: 40자)으로 자르거나, 상한 초과를 `invalid` + `field:"query"`로
거부한다. 어느 쪽이든 D1 예외를 잡아 4필드 계약 안에서 답해야 한다.

---

### EA-2 · `compare_evidence`가 말없이 다른 툴이 된다

`app/api/tools/[name]/route.ts:383`에서 `get_review_case`와 `compare_evidence`가 한 `case`를
공유한다. 인용 id가 evidence로 해석되면 비교 결과를, 아니면 **review case**를 돌려준다.

**재현** — 같은 툴, 같은 파라미터, 서로 다른 응답 형태

```
compare_evidence {"evidence_ids":["EV-068","EV-059"]}
→ { evidence, objects, conflicts, open_questions, omitted_evidence_ids, untrusted_content }

compare_evidence {"evidence_ids":["SUB-3034B302-C52"]}      ← 기여 id를 넣으면
→ { case_id, object, submitted, verified_evidence, conflicts, open_questions,
    consent_restrictions, untrusted_content }                ← review case 응답
```

에이전트가 `evidence` 키를 기대하고 파싱하면 조용히 실패한다. 어느 계약으로 답했는지 알리는
필드도 없다.

**세 번째 경우가 더 나쁘다.** 아무것도 해석되지 않으면:

```json
{"outcome":"invalid","field":"evidence_ids",
 "reason":"No review case with that id exists in this workspace."}
```

`evidence_ids`를 받는 툴이 **"review case가 없다"** 고 답한다. MCP-E5에서 고친 것과 같은
오귀속이 여기 남아 있었다.

**권장.** (a) 인용이 하나도 해석되지 않으면 `compare_evidence`는 evidence 기준으로 거부한다
(MCP-E5의 `citationProblem`을 그대로 쓰면 된다). (b) review-case 폴백은 `get_review_case`에만
둔다. 두 툴을 한 `case`로 묶은 것이 원인이므로 분기 자체를 이름별로 나누는 편이 낫다.

---

### EA-3 · `register_object`가 accession 중복을 보지 않는다

**재현**

```
register_object {"title":"Dup","accession":"RT.1930.014","basis":"b","evidence_ids":["EV-068"]}
→ {"outcome":"pending_approval", "proposal_id":"ESC-FE3D0F1D", "created":false}
```

`RT.1930.014`는 Moonbird Mask의 accession이다. 제안이 큐레이터 큐에 들어가고, 그 제안을 실행하려는
큐레이터는 `POST /api/curator/objects`에서 막힌다.

**같은 규칙이 화면에는 있다.** 큐레이터 콘솔의 등록 폼으로 동일한 accession을 넣으면 즉시 거부한다:

> A record already exists as moonbird-mask. Use a different title and accession number.

**원인.** `route.ts:676` — 툴은 **제목에서 만든 slug**만 검사한다.

```ts
const proposedId = slugFor(title);
const existing = proposedId ? await objectRecord(museumId, proposedId, 'curator') : null;
if (existing) return invalid('title', …);
```

accession은 검사 대상이 아니다. DB에는 `uq_objects_museum_accession` 유니크 인덱스가 있고
UI 라우트도 409를 돌려주므로, **툴만 이 사실을 모른다.**

**권장.** slug 검사 옆에 accession 검사를 붙이고 `field:"accession"`으로 거부한다. 제안 단계에서
알 수 있는 실패를 승인 큐까지 흘려보내지 않는다.

---

### EA-4 · 거부된 등록 제안이 존재하지 않는 기록으로 가는 링크를 만든다

큐레이터 개요 화면의 escalation 카드:

```
ESC-B14E83C0   The action was refused by policy.
               sweep-lamp · register object      [NO SUPPORTING EVIDENCE]   Open record →
```

**`Open record →` 는 `/objects/sweep-lamp`로 가고, 404다.** (배포본에서 확인)

**원인.** 정책이 거부한 `register_object`는 `escalate()`를 타고, 거기에
`objectId: proposedId`(= 만들어지지도 않은 slug)를 넘긴다. `app/curator/page.tsx:73`은
`item.object_id`가 있으면 무조건 링크를 그린다.

```ts
{item.object_id && <Link className="escalation-open" href={`/objects/${item.object_id}`}>Open record →</Link>}
```

`pending_approval` 경로는 `objectId: null`로 저장해 링크를 만들지 않는다 — 즉 **거부된 제안에서만**
나타난다. 이 흐름의 요점이 "기록은 만들어지지 않았다"인데, 화면은 기록으로 가는 링크를 준다.

**권장.** `register_object`의 거부 경로도 `objectId: null`로 저장한다(제안된 slug는 이미 `args`에
들어 있다). 또는 화면이 실재하는 유물에만 링크를 건다.

---

### EA-5 · `attach_assets`가 "자기 기여"를 강제하지 않는다

**재현** — community 세션에서 시드 기여(기여자 "Ena Varo")에 파일을 붙였다.

```
attach_assets {"submission_id":"SUB-1042-…","asset_ids":["<내가 방금 올린 파일>"]}
→ {"outcome":"applied","attached":1,"visibility":"restricted"}
```

**문서가 그렇게 적고 있었다.**

- `WEBMCP_TOOLS.md §3B.1`: *"이미 업로드된 자산을 **자기 기여에** 연결한다."*
- 배포된 툴 설명 자체는 *"…to a contribution"* 이라 이 주장을 하지 않는다.
  (최초 기록에서 카탈로그도 "your own"이라고 적었는데, 그건 사실이 아니었다. 문서 한 곳의 문제다.)

**실제 검사는 "이 워크스페이스에 그 기여가 존재하는가" 하나뿐이다.** 붙은 파일은 그 기여의
consent와 유물을 상속하므로, 큐레이터가 나중에 **그 사람의 자료로** 공개할 수 있다.

이 데모에는 개인 신원 모델이 없다(세션 하나 = 워크스페이스 하나). 그래서 실질적 악용 경로는
좁지만, **문서와 코드가 어긋나 있다는 사실 자체가 결함**이다. 동의 모델이 주제인 프로젝트에서
"누가 올린 자료인가"는 장식이 아니다.

**같은 계열, 낮은 심각도** — `check_submission`은 워크스페이스 안 **아무 기여 id**에 대해
status·consent·requested_outcome을 돌려준다. `private` 기여도 포함된다(본문은 반환하지 않는다).

```
check_submission {"submission_id":"SUB-1041-…"}   ← 남의 private 기여
→ {"status":"needs information","consent":"private","requested_outcome":"Add cultural context"}
```

**권장.** 신원을 도입할 계획이 없다면 **문서를 코드에 맞춰 고친다** — "자기 기여"가 아니라
"이 워크스페이스의 기여"라고. 계약을 지키려면 세션 소유권을 기록해 대조한다. 어느 쪽이든
지금처럼 둘이 다른 말을 하게 두지 않는다.

---

## 2. 관찰 — 결함은 아니지만 알아둘 것

| # | 내용 |
|---|---|
| OB-1 | **입력 길이 상한이 없다.** `request_clarification.question` 5,000자, `propose_label_update.draft` 20,000자가 그대로 통과한다. 그런데 `check_submission`은 질문을 **400자로 잘라** 돌려준다 — 에이전트가 보는 질문과 저장된 질문이 말없이 달라진다 |
| OB-2 | `POST /api/session`이 정의되지 않은 role(`admin`)을 **조용히 `community`로 바꾼다**. fail-closed라 안전하지만, MCP-E1에서 consent를 "거부"로 바꾼 것과 규칙이 어긋난다 |
| OB-3 | `/api/tools/<name>`이 **깨진 JSON 본문을 `{}`로 취급**해 200을 돌려준다. 파싱 실패가 성공으로 보인다 |
| OB-4 | `/api/curator/approvals/:id/resolve`와 `/escalations/:id/resolve`는 없는 id에 `{"error":"Approval not found"}`로 답한다. 툴 표면의 4필드 계약(`outcome`/`field`/`reason`/`recovery`)과 다른 형태다 |
| OB-5 | **`getTools()`가 하이드레이션 전에는 빈 배열을 준다.** `/curator`로 이동한 직후 읽으면 0개, 잠시 뒤 15개다. 명세의 `ontoolchange`가 이를 위한 것이지만, 이동 직후 한 번만 읽는 에이전트는 빈 표면을 본다 |
| OB-6 | 기여 폼의 필수 표시 `<b aria-hidden> *</b>`가 라벨 다음 줄에 홀로 렌더된다. 화면에서 떠 있는 점처럼 보인다(순수 시각) |

---

## 3. 확인된 것 — 이전 라운드 수정 (배포본)

### MCP-E1 · consent 검증

```
submit_evidence {"consent":"community_only"}
→ {"outcome":"invalid","field":"consent",
   "reason":"Consent must be one of private, public_anonymous, public_attributed."}
```

값 없음 → `private` 기본값으로 통과, 정상 값 → 통과. 폼 경로(`/api/community/evidence`)도 동일하게 거부.

### MCP-E2 · fail-closed 동의 판정 — **오염된 실데이터로 확인**

`museum_demo_01`의 45건 중 정의되지 않은 consent를 가진 5건 전부:

| id | consent | quotable |
|---|---|---|
| SUB-1D5C8BAC-4D6 | `community_only` | **false** |
| SUB-A877C864-AA6 | `community_only` | **false** |
| SUB-88B63C84-481 | `whatever_invalid` | **false** |
| SUB-803473AA-ED6 | `whatever_invalid` | **false** |
| SUB-93D7DF4A-643 | `whatever` | **false** |

이것이 **로컬에서는 검증 불가능했던 항목**이다. 입구를 막은 뒤로는 이런 행을 새로 만들 수 없다.

자산 게이트도 함께 확인했다 — 미첨부(private) 자산: community 403 / curator 200,
`get_asset_detail` → `denied · consent_not_public`, publish → `denied · consent_not_public`.

### MCP-E3 · attach_assets

없는 id → `invalid` + `omitted_asset_ids:["AST-NOPE"]`. id 없음 → `invalid`. 8개 초과 → `invalid`.

### MCP-E4 · 정책 코드 분리

인용 0건 → `no_supporting_evidence`, 제출자료만 → `submitted_sole_authority`. `register_object`,
`propose_label_update`, `open_return_review` 세 툴 모두 동일.

### MCP-E5 · 인용 오류 귀속

```
propose_label_update(moonbird-mask, ["SUB-…"])       → "No evidence record exists in this workspace for SUB-…"
propose_label_update(moonbird-mask, ["EV-ACC-1912"]) → "EV-ACC-1912 documents a different object, so it cannot
                                                        authorise a change to moonbird-mask."
```

"다른 워크스페이스" 문구는 사라졌다.

### MCP-E6 · verified 증거 backfill — **배포본에서 실행됨**

`museum_demo_01`에 `compare_evidence`로 8개 id를 물었더니 `omitted_evidence_ids: []`, 전부 verified:

`EV-068`(moonbird-mask) · `EV-ACC-1888`(tide-listening-stone) · `EV-ACC-1904`(four-winds-bowl) ·
`EV-ACC-1912`(riverstone-vessel) · `EV-ACC-1934`(reed-memory-box) · `EV-ACC-1951`(harbor-thread-map) ·
`EV-ACC-1952`(woven-signal-cloth) · `EV-ACC-1962`(dawn-marker)

`seedWorkspace`는 새 워크스페이스에만 돌므로 `backfillSeedEvidence`가 없었다면 이 워크스페이스는
고쳐지지 않았을 것이다. **가장 확인이 필요했던 항목이고, 통과했다.**

### MCP-E7 · 선언한 파라미터가 답을 바꾼다

| 호출 | 결과 |
|---|---|
| `build_provenance_timeline{object_id}` | 사건 5건 (전체) |
| `+ evidence_ids:["EV-068"]` | 사건 4건, `cited_evidence_ids:["EV-068"]`, `events_not_resting_on_cited_evidence:1` |
| `+ evidence_ids:["EV-059"]` | 사건 3건, **gap은 그대로 1건** |
| `draft_label{object_id}` | assertion 3건 |
| `+ evidence_ids:["EV-068"]` | assertion 2건, `rests_on:["EV-068"]` |
| `+ evidence_ids:["EV-ACC-1912"]` | `invalid` — 제안 단계와 같은 인용 검사 |

### MCP-E8 · 등록 상태 표시

실제 Chrome에서 WebMCP tools 패널이 이렇게 말한다:

> `document.modelContext is available — these tools are live in this browser.`

1번 트랙이 봤던 문구의 정확한 반대다. 배지 숫자는 **15**(19가 아니다). Policy gateway 패널도
정상 동작한다 — **B7은 오진이었음이 실 브라우저에서 재확인됐다.**

---

## 4. 확인된 것 — 화면 기능 전수

| 기능 | 결과 |
|---|---|
| 홈 · 컬렉션 목록 · 페이지 이동 | 정상. 페이지 링크가 `#collection` 앵커를 달고 있다(FR2-C2) |
| 라벨 flip | 정상 |
| 갤러리 · 돋보기(사진) | 그려진 사각형 `(0,227,778,519)` 기준 샘플링. **레터박스 위에서는 렌즈 없음**, 그림 안에서 복귀 (FR2-M3) |
| 갤러리 · 돋보기(대체 이미지) | 프레임 전역 동작, 화살표 키 이동, **키보드 중 포인터 이탈에도 유지**, Download 링크 없음 |
| 기여 카드 · 사진 | 기여자 카드 안에 표시 (FR2-D3) |
| 기여 카드 · 팝업 | 열림 → 포커스가 Close로 → Escape → 닫힘 → **포커스가 누른 액자로 복귀** (FR2-D4) |
| 자산 내려받기 | `?download=1` 200 |
| 기여 마법사 | 종류 2개 선택 시 4단계 → **5단계**로 증가(FR-C3), 필수 항목 검증, 파일 첨부, 동의 3단계, 요약, 제출 → 상태 페이지 |
| 기여자 상태 페이지 | **큐레이터 질문 3건 전문 + 작성자 + 시각** 표시, "revision 4로 개정됨" 반영 (FR2-K1) |
| 큐레이터 개요 | 카운터·escalation 목록 정상 |
| 승인 드로어 | **2건 큐 전환 가능**(FR2-K3), before/after diff, 큐레이터 편집, Approve → 공개 라벨 즉시 반영, Reject 정상 |
| 케이스 화면 | 질문 이력 표시, **"Ask another question (2 asked)"** 재질문 가능(FR2-K1), 대기 승인 있으면 드로어 연결(FR2-K2) |
| 대기 승인 없을 때 | 버튼 비활성 + title `"No proposed revision is waiting for this record."` |
| 자산 Publish / Withdraw | 정상 전환 |
| 유물 목록 | 헤더 정렬 오차 **전부 0px** |
| 신규 등록 폼 | 2단계 확인, **accession 중복 거부** |
| 활동 로그 | 제안 → 승인 → 발행 사슬이 그대로 남음 |
| 역할 전환 | community ↔ curator 정상, community로 `/curator` 접근 시 404(의도된 동작) |
| 승인 재사용 | 두 번째 resolve → **409 `approval_already_resolved`** |
| 콘솔 | 오류 없음 |

---

## 5. 우선순위 제안

| 순위 | 항목 | 이유 |
|---|---|---|
| 1 | **EA-1** search_collection 500 | 에이전트 표면이 죽고, 죽는 방식이 계약 밖이다. FR2-X1과 같은 유형이 하나 남아 있었다 |
| 2 | **EA-3** accession 중복 미검사 | 실패할 것이 확정된 제안이 큐레이터 큐까지 간다. 같은 규칙이 UI에는 이미 있다 |
| 3 | **EA-2** compare_evidence 이중 계약 | 에이전트가 응답 형태를 예측할 수 없다. 오류 문구도 틀렸다 |
| 4 | **EA-4** 죽은 "Open record" 링크 | 큐레이터가 404를 만난다. 한 줄 수정 |
| 5 | **EA-5** attach_assets 소유권 | 코드를 고치거나 문서를 고치거나 — 둘 중 하나는 해야 한다 |
| 6 | OB-1 길이 상한 | 저장본과 에이전트가 보는 사본이 말없이 달라진다 |
| 7 | OB-2 · OB-3 · OB-4 | 입력 검증·오류 형태의 일관성 |
| 8 | OB-5 · OB-6 | 타이밍 안내 · 시각 |

---

## 6. 검증에 쓴 데이터

전부 격리 워크스페이스(`museum_8baddd64-…`)에서 만들었고 `museum_demo_01`은 변경하지 않았다.
`/api/reset`은 기존 워크스페이스를 지우지 않으므로 이 워크스페이스는 남아 있지만, 아무도
접근하지 않는다.

`museum_demo_01`에 대해 수행한 것은 **읽기 전용 호출뿐**이다 — `list_submissions`(E2 확인),
`compare_evidence`(E6 확인), 화면 열람.
