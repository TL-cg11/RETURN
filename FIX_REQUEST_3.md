# FIX_REQUEST_3 — 배포본 브라우저 검증에서 나온 결함 수정

- **출처**: `ERROR_AFTER_FIX.md` (2026-08-28, Chrome 151 실 브라우저 전수 검증)
- **작성**: 2026-08-28 · 2번 트랙
- **상태**: 코드 수정 완료, 로컬 검증 완료, **배포 후 재검증 대기**
- **범위**: 결함 5건(EA-1 … EA-5) + 관찰 6건 중 5건(OB-1 … OB-4, OB-6)

---

## 0. 처리 요약

| ID | 항목 | 처리 |
|---|---|---|
| EA-1 | `search_collection`이 49자 이상 질의에 500 | **수정** — LIKE 제거 + 툴 라우트 예외 안전망 |
| EA-2 | `compare_evidence`가 말없이 review case가 됨 | **수정** — 계약 분리 |
| EA-3 | `register_object`가 accession 중복 미검사 | **수정** — 제안 단계에서 거부 |
| EA-4 | 거부된 등록 제안이 404 링크를 만듦 | **수정** — 저장·렌더 양쪽 |
| EA-5 | `attach_assets` 소유권 미강제 | **문서를 코드에 맞춤** (근거는 §1.5) |
| OB-1 | 입력 길이 상한 없음 | **수정** — 저장본과 읽기본을 같게 |
| OB-2 | 세션 role 조용한 coercion | **수정** — 거부 |
| OB-3 | 깨진 JSON을 `{}`로 취급 | **수정** — 거부 |
| OB-4 | 콘솔 라우트만 다른 오류 형태 | **수정** — 4필드 계약으로 통일 |
| OB-5 | 하이드레이션 전 빈 툴 목록 | **수정하지 않음** — §3 참조 |
| OB-6 | 필수 표시가 줄바꿈됨 | **수정** — 라벨 텍스트와 한 항목으로 |

---

## 1. 결함 수정

### EA-1 · 긴 질의가 검색을 죽였다 — **최우선이었던 이유**

**있었던 일.** 49자 이상 질의에 `POST /api/tools/search_collection`이 **본문 없는 500**을 냈다.
WebMCP 경로에서는 `TypeError: Tool was executed but the invocation failed`로 나타났다.

**원인은 두 개였다.**

1. `db/queries.ts`의 `LIKE '%' || query || '%'`. **D1이 LIKE 패턴 길이를 SQLite보다 훨씬 낮게
   제한**한다. `%` 두 개를 합쳐 51자가 되는 지점에서 D1이 던지고, 아무도 잡지 않았다.
   `FIX_REQUEST_2.md`의 FR2-X1과 같은 결함이다 — 그때 승인 쿼리의 LIKE를 걷어냈고, **검색의
   LIKE가 마지막 하나로 남아 있었다.** 이제 코드베이스에 LIKE는 없다
2. 툴 라우트에 예외 안전망이 없었다. 어떤 이유로든 던지면 플랫폼의 빈 500이 그대로 나갔다

**수정 1 — 검색에서 SQL LIKE를 걷어냈다.**

```ts
// db/queries.ts · searchObjects
const result = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND ${objectVisibility(access)} …`)
const rows = (result.results ?? []).map(mapObject);
if (!trimmed) return rows;
return rows.filter((row) => haystack(row).includes(trimmed));
```

이 파일의 다른 모든 필터는 SQL에 있고 이것만 JavaScript로 내렸다. **의도한 예외다.**

> **검색은 안전 필터가 아니다.** visibility 판정은 여전히 SQL에 있으므로, 이 필터는 데이터베이스가
> 이미 "이 호출자가 봐도 된다"고 판단한 집합을 **좁히기만** 한다. 아래 매칭에 버그가 있으면
> 검색 결과에서 기록이 빠질 수는 있어도 보이면 안 되는 기록이 나올 수는 없다. 컬렉션은 작고
> 워크스페이스별로 이미 유계다.

**수정 2 — 던지는 툴도 툴 계약 안에서 답한다.**

```jsonc
// POST /api/tools/<name> 가 예기치 않게 실패하면
{ "outcome": "error",
  "reason": "The tool failed before it could answer. Nothing was written.",
  "recovery": "Retry once; if it fails again, call a narrower tool or report the tool name." }
```

`error`는 **다섯 번째 outcome**이고, 넷 중 어느 것도 아니기 때문에 새로 만들었다 — 적용되지도,
큐에 들어가지도, 정책에 거부되지도, 호출자의 실수도 아니다. 서버 로그에는 원래 예외가 남는다.

**검증 — 로컬 실측**

| 질의 길이 | 전 | 후 |
|---|---|---|
| 48자 | 200 | 200 |
| **49자** | **500 (본문 없음)** | **200** |
| 200자 · 2,000자 | 500 | 200 |

검색 품질 회귀도 확인했다: `mask`→Moonbird Mask, `basalt`(재질)→Tide Listening Stone,
`west shoals`(지역)→Tide Listening Stone, 질의 없음→8건 전부.

안전망은 **실제로 예외를 발생시켜** 확인했다. 임시로 `get_collection_summary`에 throw를 심고
호출한 결과 위 JSON + 500이 나왔고, 프로브는 제거했다(`grep __faultProbe` → 0건).

---

### EA-2 · 한 툴이 두 계약으로 답했다

`get_review_case`와 `compare_evidence`가 한 `case` 블록을 공유한다. `compare_evidence`는 인용 id가
evidence로 해석되지 않으면 **review case 응답**으로 흘러갔다.

| 호출 | 전 | 후 |
|---|---|---|
| `evidence_ids: ["EV-068","EV-059"]` | evidence 비교 | 그대로 |
| `evidence_ids: ["SUB-…"]` | **review case 응답** (키 전부 다름) | `invalid` + `field:"evidence_ids"` |
| `evidence_ids: ["NOPE"]` | `"No review case with that id exists"` | `"No evidence record in this workspace matches NOPE."` |
| `evidence_ids` 없음 | review case 시도 | `"Comparing sources needs the evidence records to compare."` |
| `get_review_case{case_id}` | 정상 | **변화 없음** |

recovery가 갈림길을 알려준다: *"Call get_review_case for a contribution id, or compare_evidence
with the evidence ids a case lists."*

> **기존 smoke 검사 하나가 이 버그에 의존하고 있었다.** `compare_evidence`에 기여 id를 넘기고
> review-case 응답의 `conflicts`·`open_questions`를 확인하던 검사다. 잘못된 동작을 고정하고
> 있었으므로 evidence id를 쓰도록 고치고, "review case로 답하지 않는다"는 검사를 옆에 붙였다.

---

### EA-3 · 실패가 확정된 제안이 큐레이터 큐까지 갔다

`register_object`는 **제목에서 만든 slug만** 검사했다. accession은 보지 않았다. DB에는
`uq_objects_museum_accession` 유니크 인덱스가 있고 등록 라우트는 409를 돌려주며 **등록 폼은
이미 거부한다** — 툴만 몰랐다.

```jsonc
// 후
{ "outcome": "invalid", "field": "accession",
  "reason": "RT.1930.014 is already the accession number of Moonbird Mask (moonbird-mask).",
  "recovery": "Propose the next unused accession number, or add evidence to the existing record." }
```

`db/queries.ts`에 `objectWithAccession()` 읽기 헬퍼를 추가했다. 제안 단계에서 알 수 있는 실패를
사람이 실행하려는 순간까지 미루지 않는다.

---

### EA-4 · 만들어지지 않은 기록으로 가는 링크

거부된 `register_object`는 `escalate()`에 `objectId: proposedId`(존재하지 않는 slug)를 넘겼고,
큐레이터 개요가 그것으로 **`/objects/<slug>` 링크를 그렸다. 404다.**

**두 곳을 고쳤다.**

1. **원인** — `escalate()`에 `escalationObjectId`를 두어, 활동 로그가 가리키는 대상(제안된 이름은
   로그에서 유용하다)과 escalation 행이 저장하는 값을 분리했다. 등록 거부 경로는 `null`을 저장한다
2. **화면** — 개요가 **실재하는 유물에만** 링크를 건다. 이미 만들어진 잘못된 행(배포본에 남아
   있을 수 있다)에도 링크가 생기지 않는다

`pending_approval` 경로는 원래 `null`을 저장했으므로 거부 경로만의 문제였다.

---

### EA-5 · 강제할 수 없는 것을 강제한다고 적어두지 않는다

`attach_assets`는 "이 워크스페이스에 그 기여가 존재하는가"만 검사한다. 다른 기여자의 기여에도
파일이 붙는다(배포본에서 재현함).

**문서 한 곳이 그렇지 않다고 적고 있었다** — `WEBMCP_TOOLS.md §3B.1`의 "자기 기여에".
배포된 툴 설명 자체는 *"…to a contribution"* 이라 이 주장을 하지 않는다.
(`ERROR_AFTER_FIX.md` 최초 기록에서 카탈로그도 "your own"이라 적었는데 사실이 아니었고,
그 문장도 함께 정정했다.)

**결정 — 코드가 아니라 문서를 고쳤다.**

이 데모에는 개인 신원 모델이 없다. 세션 하나가 워크스페이스 하나이고, 기여에 작성자 식별자가
없다. 소유권을 실제로 걸려면 세션 소유자를 기여에 기록하고 대조해야 하며 **그것은 기능 추가**다.
요청받은 것은 결함 수정이지 신원 도입이 아니다.

강제할 수 없는 규칙을 문서가 약속하고 있는 상태가 더 나쁘다 — 읽는 사람이 없는 보호를 있다고
믿는다. 그래서 문구를 코드에 맞추고, 무엇이 없는지와 무엇을 해야 생기는지를 §3B.1에 적었다.

**남은 결정 (열려 있음)**

| 선택지 | 성격 |
|---|---|
| (a) 현행 유지 | 워크스페이스 경계가 유일한 경계임을 문서가 명시한다. 지금 상태 |
| (b) 세션 소유권 도입 | `submissions`에 세션 식별자를 저장하고 `attach_assets`·`check_submission`에서 대조. 스키마 변경 + 마이그레이션 |

같은 계열로 `check_submission`도 워크스페이스 안 아무 기여의 status·consent·requested_outcome을
돌려준다(본문은 반환하지 않는다). (b)를 고르면 함께 다뤄야 한다.

---

## 2. 관찰 항목 수정

### OB-1 · 저장한 것과 읽어주는 것이 달랐다

`check_submission`은 큐레이터 질문을 **400자로 잘라** 에이전트에 돌려주는데, 입력에는 상한이
없어 5,000자 질문이 그대로 저장됐다. **같은 문장의 두 판본**이 생기고, 기여자가 어느 쪽에
답하는지 아무도 말해주지 않는다.

`lib/domain/types.ts`에 상한을 두고 **저장을 거부**한다.

| 필드 | 상한 | 근거 |
|---|---|---|
| `request_clarification.question` | **400자** | `check_submission`이 읽어주는 길이와 같게 |
| `propose_label_update.draft` | **6,000자** | `WEBMCP_TOOLS.md §3.8`이 이미 선언한 라벨 본문 상한 |

자르지 않고 거부한다 — 자르면 다시 두 판본이 된다. 라벨 쪽은 승인 스냅샷이 불변이고 해시되므로,
무한정 긴 초안은 영구히 저장되고 다시 읽힌다.

콘솔 라우트와 툴 양쪽에 같은 규칙을 걸었다.

### OB-2 · 정의되지 않은 role을 조용히 바꿨다

`POST /api/session {role:"admin"}`이 200과 함께 `community`를 돌려줬다. fail-closed라 안전하지만,
**호출자가 요청하지 않은 역할을 200으로 답하는 것**은 MCP-E1에서 consent에 대해 없앤 바로 그
동작이다. 이제 거부한다. role이 **없으면** 여전히 `community`다 — 그것은 기본값이지 정정이 아니다.

### OB-3 · 깨진 본문이 빈 호출로 읽혔다

`/api/tools/<name>`이 파싱 실패를 `{}`로 삼켰다. 질의 없는 검색, 필터 없는 목록처럼 **그럴듯한
성공**으로 보인다. 이제 `invalid` + `field:"body"`로 거부한다. JSON 배열도 거부한다(인자는
객체여야 한다). 본문이 **아예 없으면** 여전히 인자 없는 호출이다.

### OB-4 · 콘솔 라우트만 다른 오류 형태였다

`{"error":"Approval not found"}` 형태를 툴 표면의 4필드 계약으로 통일했다.

| 라우트 | 후 |
|---|---|
| `approvals/:id/resolve` | `invalid` + `field:"approval_id"` + recovery |
| `escalations/:id/resolve` | `invalid` + `field:"escalation_id"` / 잘못된 action은 `field:"action"` |
| `assets/:id/publish` | `invalid` + `field:"asset_id"` + recovery |
| 세 라우트의 역할 거부 | `denied` + `reason` + `recovery` |

### OB-6 · 필수 표시가 줄바꿈됐다

`.form-stage label`이 **세로 flex 컨테이너**라 라벨 텍스트 노드와 `<b aria-hidden> *</b>`가 각각
별개의 flex 항목이 되어 서로 다른 줄에 놓였다. 화면에서 질문 아래 점 하나가 떠 있는 것처럼 보였다.

라벨 텍스트와 표시를 `<span className="field-name">` 하나로 묶어 **한 항목**으로 만들었다.
기여 폼과 큐레이터 등록 폼 양쪽. CSS 해킹(`:has`, 음수 마진)을 쓰지 않았다 — 구조가 원인이었다.

---

## 3. 수정하지 않은 것

### OB-5 · 하이드레이션 전에는 `getTools()`가 비어 있다

`/curator`로 이동한 직후 읽으면 0개, 잠시 뒤 15개다. 툴 등록은 클라이언트 컴포넌트가 마운트될 때
일어나므로 **이보다 빠를 수 없다.** 서버가 등록할 수 있는 것이 아니다.

명세는 이 상황을 위해 `document.modelContext.ontoolchange`를 둔다. 이동 직후 한 번만 읽는
에이전트는 빈 표면을 보고, 그것은 명세가 이미 답을 가진 문제다. 앱이 할 수 있는 일이 없어
수정하지 않았고, 여기에 적어 둔다.

---

## 4. 검증

문서화된 순서 — dev 정지 → `npm run verify` → dev 기동 → smoke 2회.

| 항목 | 결과 |
|---|---|
| `npm run lint` | 통과 |
| `npm run typecheck` | 통과 |
| 유닛 테스트 | **155/155** |
| `npm run build` | 통과 |
| `npm run test:smoke` | **271/271, 2회 연속** (243 → +28) |
| `npm run eval:tools` | 정적 게이트 통과 |

**새 smoke 검사 28건** (`browser sweep` 섹션, 자체 워크스페이스에서 실행)

| 검사 | 고정하는 것 |
|---|---|
| 48·49·200·2000자 질의가 답을 받는다 | EA-1 |
| 제목 아닌 필드로도 검색되고, 질의 없으면 전체가 나온다 | EA-1 회귀 |
| 비교는 비교로 답하고, 기여 id는 `invalid`, 문구에 "review case"가 없다 | EA-2 |
| `get_review_case`는 그대로 review case로 답한다 | EA-2 회귀 |
| accession 재사용 제안이 거부되고 기존 기록을 이름으로 말한다 | EA-3 |
| 거부된 등록 뒤 콘솔에 없는 유물 링크가 없다 | EA-4 |
| 401자 질문 거부 / 400자 통과 / **읽어준 길이가 저장 길이와 같다** | OB-1 |
| 6001자 라벨 거부 | OB-1 |
| 정의되지 않은 role 거부, 거부가 세션을 바꾸지 않는다 | OB-2 |
| 깨진 JSON·배열 본문 거부, 본문 없음은 통과 | OB-3 |
| 없는 approval·referral·asset이 4필드로 답한다 | OB-4 |

**직접 실측한 것** — 예외 안전망(임시 throw 주입 후 제거), OB-6 렌더(라벨 텍스트와 표시가
같은 줄, 높이 16px).

---

## 5. 배포 후 확인할 것

1. **배포본에 smoke 실행** — `npm run test:smoke -- https://webmcp.chocobear159.workers.dev`.
   271건 전부 통과해야 한다. `/api/reset`으로 자체 워크스페이스를 잡으므로 데모는 오염되지 않는다
2. **EA-4의 기존 행** — `museum_demo_01`에 이미 잘못된 `object_id`를 가진 escalation 행이 남아
   있을 수 있다. 화면 쪽 가드가 링크를 그리지 않는지 개요에서 확인한다(행 자체는 지우지 않는다)
3. **EA-1을 실 브라우저에서** — `document.modelContext`로 긴 질의를 실행해 `TypeError`가 아니라
   결과가 오는지
4. **OB-6 시각 확인** — `/contribute` 2단계에서 별표가 질문과 같은 줄에 있는지

---

## 6. 변경된 파일

| 파일 | 항목 |
|---|---|
| `db/queries.ts` | EA-1 (LIKE 제거) · EA-3 (`objectWithAccession`) |
| `app/api/tools/[name]/route.ts` | EA-1 (안전망) · EA-2 · EA-3 · EA-4 · OB-1 · OB-3 |
| `app/curator/page.tsx` | EA-4 (실재하는 유물에만 링크) |
| `app/api/session/route.ts` | OB-2 |
| `app/api/curator/submissions/[id]/clarify/route.ts` | OB-1 |
| `app/api/curator/approvals/[id]/resolve/route.ts` | OB-4 |
| `app/api/curator/escalations/[id]/resolve/route.ts` | OB-4 |
| `app/api/curator/assets/[id]/publish/route.ts` | OB-4 |
| `lib/domain/types.ts` | OB-1 (길이 상한) |
| `components/community/contribution-form.tsx` | OB-6 |
| `components/curator/register-object.tsx` | OB-6 |
| `app/globals.css` | OB-6 |
| `scripts/smoke.mjs` | 회귀 28건 + 잘못된 기존 검사 1건 수정 |
| `WEBMCP_TOOLS.md` | EA-5 (계약 문구) |
| `ERROR_AFTER_FIX.md` | EA-5 정정 |
