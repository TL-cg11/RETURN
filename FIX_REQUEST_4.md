# FIX_REQUEST_4 — 2차 브라우저 검증에서 나온 결함 수정

- **출처**: 배포본 2차 전수 검증 (2026-08-28, Chrome 151 실 브라우저, WebMCP `executeTool` 경로)
- **작성**: 2026-08-28 · 2번 트랙
- **상태**: 코드 수정 완료, 로컬 검증 완료, **배포 후 재검증 대기**

---

## 0. 처리 요약

| ID | 항목 | 처리 |
|---|---|---|
| F4-1 | `open_return_review`가 `basis` 없이 통과 | **수정** — 선언대로 강제 |
| — | 컬렉션 페이징이 상단으로 튐 | **결함 아님 — 내 오진.** §3 참조 |
| F4-2 | 기여 폼이 지키지 않는 초안 보관 약속 | **수정** — 문구 삭제 (사용자 결정) |
| F4-3 | `attach_assets`의 두 숫자가 불일치 | **수정** — 같은 질문에 답하게 |
| F4-4 | 모르는 툴 이름만 4필드 계약 밖 | **수정** |
| F4-5 | `list_submissions`의 `limit` 조용한 보정 | **수정** — 거부 |

---

## 1. 결함 수정

### F4-1 · 이유 없는 관리권 검토가 사람에게 올라갔다

**있었던 일.** 카탈로그가 `required: ["object_id", "basis"]` 로 선언하는데 핸들러가 강제하지
않았다.

```
open_return_review {"object_id":"moonbird-mask","evidence_ids":["EV-068"]}   → pending_approval
open_return_review {"object_id":"moonbird-mask","basis":"   ", …}            → pending_approval
```

`String(args.basis ?? 'no basis given')` — **없으면 서버가 문구를 지어내고, 공백이면 공백 그대로**
통과시켰다. 감사 로그에 이렇게 남았다.

```
Moonbird Mask ·                     ← 공백만 넣은 호출
Moonbird Mask · no basis given      ← 생략한 호출
Moonbird Mask · A stated reason.    ← 정상
```

**왜 무거운가.** HIGH 등급 행위다. 관리권·반환 검토는 사람에게 "이 주장을 판단해 달라"고 올리는
절차인데, 그 자리에 서버가 지어낸 문구가 들어가면 판단할 주장이 없다. `register_object` 는 같은
`basis` 를 처음부터 거부해왔다 — 두 HIGH 툴이 같은 필드를 다르게 다루고 있었다.

**수정** — `register_object` 와 같은 규칙으로 맞췄다.

```jsonc
{ "outcome": "invalid", "field": "basis",
  "reason": "A stewardship review needs the reason it is being asked for.",
  "recovery": "Say what makes this object a candidate for review, and cite the evidence for it." }
```

**전수 확인.** 이 기회에 **모든 툴의 `required` 파라미터 17개를 하나씩 빼면서** 확인했다.
나머지 16개는 전부 강제되고 있었고, 미강제는 이 하나뿐이었다. (확인 시 다른 이유로 거부되는
경우와 헷갈리지 않도록, 뺀 필드 외에는 전부 유효한 인자로 채워 호출했다.)

---

### F4-2 · 폼이 지키지 않는 약속을 했다 — 문구를 지웠다

기여 마법사 사이드바에 이렇게 적혀 있었다.

> "Your draft stays in this browser until you submit it. You control how the museum may use your contribution."

**앞 문장이 사실이 아니다.** 5단계 중간에 새로고침하면 제목·출처·선택한 자료 종류·단계가 전부
사라지고 1단계로 돌아간다. `localStorage` 에는 `console-nav` 하나뿐이고 `sessionStorage` 는 비어
있다. (같은 페이지에서 `sessionStorage` 에 표식을 심어 새로고침을 넘기는 것을 확인했으므로,
저장소가 막힌 것이 아니라 **폼이 아무것도 저장하지 않는 것**이다.)

**결정 — 사용자가 문구 삭제를 선택.** 남긴 문장은 이것이다.

> "You control how the museum may use your contribution."

지운 문장은 장식이 아니라 **일을 하고 있었다** — 기여자에게 "떠났다 돌아와도 된다"고 말한다.
그러니 거짓인 판본은 없는 것보다 나쁘다. 남은 문장은 사실이고, 이 화면이 실제로 하는 약속이다
(consent 단계가 그 약속을 이행한다).

> 초안 저장을 원하면 별도 요청으로 다루면 된다. 이번 수정은 **약속과 동작을 맞추는 것**이다.

---

### F4-3 · 두 숫자가 서로 다른 질문에 답하고 있었다 — 내가 만든 것이다

MCP-E3 에서 `omitted_asset_ids` 를 "기여에서 되읽기" 로 바꾸면서 `attached` 는 UPDATE 가 바꾼 행
수로 남겨뒀다. 그래서 두 값의 기준이 갈라졌다.

| 호출 | 전 | 후 |
|---|---|---|
| 새 파일 1개 | `attached:1 requested:1 omitted:—` | 그대로 |
| **같은 파일 다시** | `attached:0 requested:1 omitted:—` | **`attached:1`** |
| 새것+이미붙은것+가짜 | `attached:1 requested:3 omitted:[가짜]` | **`attached:2`** |
| 가짜만 | `attached:0 requested:1 omitted:[가짜]` + `invalid` | 그대로 |

전에는 `requested - omitted.length` 와 `attached` 가 어긋났고, 재첨부는 "아무 일도 안 일어났고
실패도 없음" 으로 읽혔다. 데이터는 항상 정확했다(`total_on_contribution` 이 맞았다) — 잘못
읽히는 것은 숫자였고, 하필 MCP-E3 이 고치려던 바로 그 부류다.

**수정** — 두 값 모두 기여에서 되읽는다. `attached = requested - omitted`.

```ts
const omitted = ids.filter((id) => !held.some((asset) => asset.id === id));
const attached = ids.length - omitted.length;
```

**기여에 올라와 있으면 붙은 것이다.** 이번 호출이 올린 것인지는 호출자의 관심사가 아니다.
이제 모든 경우에 `attached + omitted.length === requested` 가 성립한다.

> **기존 smoke 검사 하나가 옛 의미에 의존하고 있었다** — `an already-attached file is not moved
> a second time` 이 `attached === 0` 을 확인했다. 그 검사가 정말 지키려던 것(파일이 중복되지
> 않고 다른 것이 움직이지 않음)을 직접 확인하도록 고쳤다. EA-2 때 `compare_evidence` 검사에서
> 있었던 일과 같다.

---

### F4-4 · 마지막 남은 계약 밖 응답

OB-4 에서 콘솔 라우트 3개를 4필드 계약으로 통일했는데, **툴 라우트 자체의 이 한 줄**을 빠뜨렸다.

```
POST /api/tools/does_not_exist   전 → {"error":"Unknown tool"}
                                 후 → {"outcome":"invalid","field":"name",
                                       "reason":"There is no tool called does_not_exist on this surface.",
                                       "recovery":"Read the registered tool list from document.modelContext.getTools(), …"}
```

이제 이 표면의 모든 응답이 `outcome` 을 싣는다.

---

### F4-5 · 요청하지 않은 페이지 크기를 200으로 답했다

`Math.min(Math.max(Number(args.limit) || 20, 1), 100)` 이 범위를 벗어난 값을 **조용히 구부렸다.**

| 요청 | 전 | 후 |
|---|---|---|
| `limit: -5` | 1건 반환 | `invalid` + `field:"limit"` |
| `limit: 0` | 20건(기본값) 반환 | `invalid` |
| `limit: 2.7` | 2건 반환 | `invalid` |
| `limit: 101` | 100건 반환 | `invalid` |
| `limit: 2` | 2건 | 그대로 |
| 생략 | 20건 | 그대로 — 기본값이지 보정이 아니다 |

MCP-E1(consent)·OB-2(role)·OB-3(본문)에서 없앤 "요청하지 않은 값에 200" 패턴의 마지막 사례다.
영향은 작지만 규칙이 하나가 되는 편이 낫다.

---

## 2. 검증

문서화된 순서 — dev 정지 → `npm run verify` → dev 기동 → smoke 2회.

| 항목 | 결과 |
|---|---|
| `npm run lint` · `typecheck` | 통과 |
| 유닛 테스트 | **155/155** |
| `npm run build` | 통과 |
| `npm run test:smoke` | **290/290, 2회 연속** (271 → +19) |
| `npm run eval:tools` | 정적 게이트 통과 |

**새 smoke 검사 19건** (`second sweep` 섹션, 자체 워크스페이스)

| 검사 | 고정하는 것 |
|---|---|
| basis 없음·공백 거부 / 있으면 승인 큐 도달 / **감사 로그에 `no basis given` 이 없음** | F4-1 |
| 모르는 툴이 4필드로 답하고 이름을 되말함 | F4-4 |
| `limit` -5·0·2.7·101 거부, 2는 정확히 2건, 생략은 기본값 | F4-5 |
| 새 파일·재첨부·혼합·전부실패 네 경우 모두 `attached + omitted = requested` | F4-3 |
| 폼에 초안 보관 문구가 없고, 통제 문구는 남아 있음 | F4-2 |

**중간에 한 번 나온 500은 결함이 아니다.** 2회차에서 `GET /curator/submissions` 가 500을 냈는데,
로그를 보면 miniflare 의 `dispatchFetch` 에서 난 `fetch failed` 였다 — 같은 실행에서 860ms 전에
정상 렌더된 페이지다. 이 세션 내내 로컬 dev 워커가 간헐적으로 요청을 놓친(ECONNRESET) 것과 같은
현상이다. 이후 2회 연속 290/290 으로 확인했다.

---

## 3. 결함이 아니었던 것 — 컬렉션 페이징

2차 검증에서 "페이징이 여전히 상단으로 튄다"고 보고했다. **오진이었다.**

`components/community/collection-browser.tsx` 의 `choose()` 는 이렇게 동작한다.

- 클릭을 `preventDefault` 하고 **클라이언트에서** 페이지를 바꾼다
- `pushState` 로 URL 을 갱신하되 **해시를 일부러 비운다** — 새 해시를 넣으면 앵커 스크롤이
  일어나기 때문이다. `href` 의 `#collection` 은 **JS 없는 환경용 fallback** 이다
- 클릭 직전 뷰포트를 기억했다가 `useLayoutEffect` 에서 페인트 전에 복원한다

**재측정 결과 의도대로 동작한다.** 컬렉션 위치(1065px)로 스크롤한 뒤 Next 를 누르면 scrollY 가
1065 로 유지되고 목록만 교체된다.

**내 측정이 틀린 이유는 둘이다.**

1. 클릭 **전에** 스크롤을 0으로 만들어 놓고, "0으로 복원됨" 을 "상단으로 튐" 으로 읽었다
2. 사전 스크롤 자체가 안 먹었다 — 루트에 `scroll-behavior: smooth` 가 걸려 있고,
   **백그라운드 탭에서는 부드러운 스크롤 애니메이션이 돌지 않는다.** `behavior:'instant'` 로
   바꾸자 즉시 동작했다

> **검증 시 주의로 남긴다.** 확장으로 만든 탭은 기본이 백그라운드다. 스크롤이 관련된 것을
> 측정할 때는 `behavior:'instant'` 를 쓰거나 탭을 전면으로 올려야 한다. 이 함정 때문에
> 정상 동작을 결함으로 보고했다.

---

## 4. 배포 후 확인할 것

1. **배포본에 smoke 실행** — `npm run test:smoke -- https://webmcp.chocobear159.workers.dev`.
   290건 전부 통과해야 한다
2. **F4-1 을 감사 로그로** — 큐레이터 콘솔 Activity 에 `no basis given` 이 한 줄도 없어야 한다.
   **배포본에는 이전 호출로 만들어진 기존 행이 남아 있을 수 있다** — 새로 생기지 않는지를 본다
3. **F4-2 를 화면으로** — `/contribute` 사이드바에 초안 보관 문구가 없는지
4. **F4-3 을 실 브라우저에서** — `executeTool` 로 같은 파일을 두 번 붙여 `attached: 1` 이 나오는지

---

## 5. 변경된 파일

| 파일 | 항목 |
|---|---|
| `app/api/tools/[name]/route.ts` | F4-1 · F4-3 · F4-4 · F4-5 |
| `components/community/contribution-form.tsx` | F4-2 |
| `scripts/smoke.mjs` | 회귀 19건 + 옛 의미에 의존하던 기존 검사 1건 수정 |
