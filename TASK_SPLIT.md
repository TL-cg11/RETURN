# RE:TURN — 데모 구현 분담표

> `TECH_SPEC.md`의 기능 ID **62개**를 실제 코드 상태로 재검증하고 2인 분담으로 정리한 문서.
> 기준 커밋: `b630c57` · 대상: 3분 데모 시나리오(`RETURN_PLAN.md` §19) 완주

---

## ⚠️ 먼저 읽을 것

**`TECH_SPEC.md`의 상태 라벨(`~` / `✗`)은 실제보다 비관적이다.**
`~`·`✗`로 적혀 있지만 이미 동작하는 항목이 19개다. 스펙 문서를 AI에 통째로 주면
멀쩡히 동작하는 코드를 다시 만든다. **아래 §1 목록은 건드리지 말 것.**

---

## §0. 갈라지기 전에 — 공동 작업

순서대로 끝내고 브랜치를 나눈다.

1. `npm install` → `npm run verify` → `npm run dev`
2. `npm run test:smoke -- http://localhost:3000` **초록 확인**
   - 현재 `node_modules`가 없다. 한 번도 실행되지 않았을 수 있으므로 여기서 막히면 먼저 해결한다.
   - `vinext 1.0.0-beta` + `@cloudflare/vite-plugin` 조합이라 초기 부팅에 시간이 걸릴 수 있다.
3. **스키마 6종을 한 번에 추가**하고 커밋
   - `objects`, `evidence`, `provenance_events`, `label_publications`, `escalations`
   - `activity` 컬럼 확장 (`actor_type`, `tool`, `risk`, `policy_decision`, `result`)
   - 한 사람이 `db/setup.ts` + `db/schema.ts`에 몰아서 작성한다.
     이후 두 트랙 모두 이 파일을 건드리지 않으므로 **머지 충돌이 사라진다.**
4. **`git worktree`로 작업 디렉터리 분리**
   - 같은 폴더에서 두 개의 AI 세션을 돌리면 서로의 파일을 덮어쓴다.

---

## §1. 이미 완료 — 손대지 마세요 (19개)

| ID | 기능 | 스펙 라벨 | 실제 상태 |
|---|---|---|---|
| B2 | D1 + Drizzle 런타임 | `✓` | 동작 |
| C1 | 2단계 authority (submitted / verified) | `~` | 서버 강제 중 |
| C2 | consent 4단계 강제 | `~` | `publicSubmission()`이 body 차단 |
| D1 | 순수함수 `evaluate()` | `~` | DOM·DB import 없음, 순수 |
| D5 | 내용 미판정 원칙 | `~` | 지켜짐 |
| E1 | 4위험 등급 처리 | `~` | LOW / MEDIUM / HIGH / CRITICAL 동작 |
| E6 | 비차단 approval polling | `~` | `check_approval` 동작 |
| F1 | 4개 표준 응답 상태 | `~` | 동작 |
| F2 | 단일 툴 dispatcher | `~` | 287줄, 툴 18개 전부 실핸들러 |
| F3 · F4 | community / curator 실행경로 | `~` | 동작 *(actor 하드코딩만 1번이 수정)* |
| G3 | 역할 조건부 등록 | `✓` | 동작 |
| G4 | context baked-in | `✓` | 동작 |
| G5 | annotation (readOnly / untrusted) | `✓` | 동작 |
| G7 | thin client execute | `✓` | 동작 |
| I1 | label flip | `✓` | 동작 |
| I4 | evidence 비교 | `~` | `get_review_case` 동작 |
| I5 | timeline draft 빌더 | `~` | `build_provenance_timeline` 동작 |
| J1 | Community UI 전체 | `~` | 홈 · 상세 · 5단계 폼 · 상태 완성 |
| J3 | 디자인 토큰 | `~` | `globals.css` 252줄 |
| K2 | 명명된 참여자 피드 | `✓` | 동작 |

---

## §2. 1번 사람 — "눌렀을 때 진짜 바뀌게" (24개)

한 줄 요약: **지금은 승인 버튼을 눌러도 공개 라벨이 그대로다.** 그걸 고친다.

### A1 · 유물·증거·타임라인 DB 이전

| ID | 기능 | 지금 상태 |
|---|---|---|
| B1 | 도메인 스키마 확장 (objects / evidence / provenance_events / label_publications) | 4개 테이블만 존재 |
| B5 | 마이그레이션 + 시드 파이프라인 | 시드는 되나 상수 기반 |
| C3 | visibility 3단계 (public / restricted / sealed) | 타입만 존재, 항상 `'public'` 하드코딩 |
| I3 | provenance timeline + gap | 동작하나 `lib/records.ts` 상수에서 생성 |
| M2 | seed dataset (+ injection 3종 추가) | 객체 8 · 제출 3 존재, injection 없음 |
| N-6 · N-7 | 시드 이름 · 제작연도 문서 통일 | — |

> `lib/demo-data.ts` + `lib/records.ts`의 상수를 DB 쿼리로 교체한다.
> 호출부는 툴 8곳 + 페이지 4곳.
> **다른 모든 1번 작업의 바닥 공사이므로 가장 먼저 한다.**

### A2 ⭐ · 승인 → 공개 라벨 반영

| ID | 기능 | 지금 상태 |
|---|---|---|
| **B4** | **revision 보존 — 승인이 새 label revision 발행** | **없음** |
| E5 | `approve_with_edit` 트랜잭션 완성 | UI · API는 동작, 라벨 미반영 |
| F5 | 게이트웨이 단일 통과 강제 | `app/api/curator/approvals/[id]/resolve/route.ts`가 `evaluatePolicy()`를 **아예 호출하지 않음** |

> **데모 장면 5의 핵심.** 2번의 B4(실시간)가 이 작업을 기다린다.

### A3 · label diff

| ID | 기능 | 지금 상태 |
|---|---|---|
| I2 | approval drawer에 before / after 비교 | 없음 |

### A4 · 승인 무결성

| ID | 기능 | 지금 상태 |
|---|---|---|
| E2 | snapshot에 args · assertion · refs 포함 | 본문 + hash + object_version만 |
| E3 | tampering 탐지 — 실행 직전 현재값 재비교 | 없음 |
| E4 | `expired` 상태 + `expires_at` | 컬럼 없음 |
| N-3 | `expires_at` 스키마 반영 | — |

### A5 · 세션 · 테넌시

| ID | 기능 | 지금 상태 |
|---|---|---|
| A1 | HMAC **서명 쿠키** | 평문 쿠키 → 브라우저에서 `role=curator`로 고치면 통과 |
| A2 | 최초 방문 부트스트랩 | reset 경로에서만 `museum_id` 쿠키 발급 |
| A3 | 역할 전환 | 동작 (서명만 적용) |
| A4 | Fresh museum reset | 동작 (서명만 적용) |
| A5 | 서버측 역할 재검증 | 체크는 하나 쿠키가 평문 |
| A6 | **멀티테넌트 스코핑** | `museumMatch: true` 하드코딩 |
| F3 · F4 | 툴 핸들러가 **세션 role**을 정책에 전달 | `actor: 'curator'` 고정 |
| B3 (일부) | 불변식 — 모든 row에 `museum_id`, community는 verified 부여 불가 | — |
| N-8b | 서명 쿠키로 `includes()` 검사 교체 | — |

### A6 · 테스트

| ID | 기능 | 지금 상태 |
|---|---|---|
| L1 | 정책 unit 테스트 확장 | 32개 존재 → revision · tampering · 403 추가 |
| L2 | API 통합 테스트 | smoke 60여 체크 존재 → 위 케이스 추가 |

### 덤

| ID | 기능 | 지금 상태 |
|---|---|---|
| J4 (community) | 키보드 flip, 색상 단독 의존 제거 | 없음 |

---

## §3. 2번 사람 — "막을 건 막고, 화면이 살아있게" (18개)

한 줄 요약: **지금은 위험한 요청이 일부 통과하고, 화면이 저절로 안 움직인다.** 그걸 고친다.

### B1 · 정책 규칙 일반화

| ID | 기능 | 지금 상태 |
|---|---|---|
| **D4** | **core provenance rule을 `risk >= HIGH && actor_type === 'agent'` 전체로 적용** | `publish_label`에만 적용 → `open_return_review`가 submitted-only 증거로도 통과. **데모 장면 4가 실제로는 뚫려 있다.** |
| D3 | 10단계 판정 순서 정리 | 순서 미정리 |
| C4 | `open_question`은 경계 evidence ≥ 2 또는 gap record 참조 | assertion 3종 생성은 되나 이 하위 규칙만 없음 |
| B3 (일부) | 불변식 — published assertion은 ref ≥ 1, `verified_fact`는 verified ref ≥ 1 | — |
| N-2 | 계획서에 명시적 조건으로 못박기 | — |

> **회귀 테스트 필수**: `open_return_review` + submitted-only refs → `denied`

### B2 ⭐ · escalation 완성

| ID | 기능 | 지금 상태 |
|---|---|---|
| D7 | escalations 테이블 + 자동 생성 | 없음 |
| D6 | deny 응답에 `escalation_id` / `next` | `recovery` 문구만 |
| D2 | verdict 타입에 `escalate` 필드 | 없음 |
| J2 | 큐레이터 화면에 escalation 카드 | 없음 (나머지 curator UI는 완성) |

> "막기만 하는 게 아니라 사람에게 넘긴다"가 이 제품의 핵심 메시지다.
> 현재는 `escalated_to_curator: true` 플래그만 반환하고 아무 레코드도 남지 않는다.

### B3 · 감사 로그

| ID | 기능 | 지금 상태 |
|---|---|---|
| K1 | 전수 로깅 — `actor_type` / `tool` / `risk` / `policy_decision` / `result` | `actor` / `action` / `detail`만 저장 |
| N-4 | activity 컬럼 확정 | — |

### B4 ⭐ · 실시간 좌 ↔ 우

| ID | 기능 | 지금 상태 |
|---|---|---|
| H1 | 이벤트 3종 (제출 생성 / 승인 해결 / 피드 갱신) | **없음** |
| H2 | cross-surface 반영 — 좌(제출) → 우(inbox), 우(승인) → 좌(라벨) | `router.refresh()`만 |
| H3 | SSE 우선 + 2초 polling fallback | `EventSource` 사용 0건 |

> **1번의 A2가 끝난 뒤에 착수한다.** 2번 작업 중 가장 마지막.
> split screen 데모의 생명이므로 fallback을 반드시 붙인다.

### B5 · WebMCP 등록 교정

| ID | 기능 | 지금 상태 |
|---|---|---|
| G2 | **AbortController로 해제 교체** | `lib/webmcp/register.ts`가 존재하지 않는 `unregisterTool?.()` 호출 → optional chaining 때문에 **조용한 no-op**. 역할 전환 시 이전 도구가 잔존 |
| G1 | `document.modelContext ?? navigator.modelContext` + deprecation 경고 | `document`만 확인 |
| G6 | 출력 크기 제약 검증 (name ≤ 30 / description ≤ 500 / output ~1.5K) | 대체로 지켜지나 검증 없음 |
| N-8a | 계획서에 AbortController 명시 | — |

### B6 · 배포 · 마감

| ID | 기능 | 지금 상태 |
|---|---|---|
| M3 | `wrangler deploy`, fresh museum 최종 테스트, README 갱신, 3분 영상 | 배포 안 됨 |
| L3 | WebMCP eval (7종 시나리오) | 없음 |
| N-1 · N-5 | 문서 교정 — Neon → D1, repo 구조 실제화 | — |

### 덤

| ID | 기능 | 지금 상태 |
|---|---|---|
| J4 (curator) | 색상 단독 의존 제거 *(drawer focus trap · Escape는 이미 구현됨)* | 일부 |

---

## §4. 만들지 않는 것 (1개)

| ID | 기능 | 이유 |
|---|---|---|
| M1 | asset 업로드 파이프라인 | 준비된 가상 자산 1개로 대체. `RETURN_PLAN.md`에 명시된 MVP 제외 항목 |

추가로 `RETURN_PLAN.md` §22 **Do not build** 전체와 **Nice to have** 7종은 데모 범위 밖이다.

---

## §5. 진행 순서

```
공동   npm install → 실행 확인 → 스키마 6종 추가 → worktree 분리
         │
1번    A1 → A2 → A3 → A4 → A5 → A6
2번    B1 → B2 → B3 → B5 → (A2 완료 후) B4 → B6
         │
공동   배포 · fresh museum 최종 테스트 · 3분 영상
```

**순서 규칙 두 가지**

- 1번은 `A1 → A2`를 최우선. 2번의 B4가 대기 중이다.
- 2번은 `B4`를 가장 뒤로. A2가 없으면 후반부를 붙일 수 없다.

### 의존 지점

| 의존 | 내용 |
|---|---|
| 2번 B4 → 1번 A2 | "승인 → 공개 라벨" 실시간 반영은 A2 완료 후 |
| 2번 B3 → 1번 A1 | 감사 로그가 evidence id를 제대로 기록하려면 A1 필요. 급하면 submission id로 선행 가능 |

---

## §6. AI로 구현할 때

1. **`TECH_SPEC.md`를 통째로 주지 말 것.** §1의 19개를 다시 만든다.
   이 문서의 해당 섹션만 근거로 주고 *"기존 코드 유지, 이 부분만 수정"*을 명시한다.
2. **매 작업 끝에 검증을 강제한다.**
   ```
   npm run verify && npm run test:smoke -- http://localhost:3000
   ```
   툴 핸들러 하나를 고치면 smoke 60여 체크 중 어디가 깨지는지 즉시 드러난다.
3. **커밋 단위 = 이 문서의 소제목 하나** (A1, A2, B1 …).
   여러 개를 한 번에 시키면 리뷰가 불가능해진다.

---

## §7. 완료 판정

체크리스트가 아니라 **새 워크스페이스에서 3분 시나리오 5장면 완주**로 판정한다.

| 장면 | 확인 사항 | 담당 |
|---|---|---|
| 1 | Moonbird Mask 라벨 flip · 1959–1968 gap 표시 | 1번 (A1) |
| 2 | 커뮤니티 제출 → 큐레이터 inbox에 **자동** 등장 | 2번 (B4) |
| 3 | 1959 사진 ↔ 1968 인보이스 대조 · 라벨 초안 | 완료됨 |
| 4 | `open_return_review` + submitted-only → **거부 + escalation 카드 생성** | 2번 (B1 · B2) |
| 5 | 승인 → 왼쪽 공개 라벨이 새 문장으로 **자동 교체** | 1번 (A2) + 2번 (B4) |

장면 4와 5가 통과하면 나머지는 따라온다.

---

## 합계

| 구분 | 개수 |
|---|---|
| 이미 완료 | 19 |
| 1번 사람 | 24 |
| 2번 사람 | 18 |
| 만들지 않음 | 1 |
| **총계** | **62** |
