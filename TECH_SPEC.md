# RE:TURN — 기술 기능 명세서 (Technical Feature Specification)

> 이 문서는 `RETURN_PLAN.md`의 제품 비전을 **구축해야 할 기술 기능(capability) 단위**로 재정리한 것이다.
> 개별 WebMCP 툴 18개의 인자·스키마 카탈로그는 별도 문서로 분리한다(이 문서 범위 밖).
> 각 항목은 계획서 비전과 현재 `return/` 구현 사이의 **구축 대상 격차**를 반영하며,
> 검토 중 발견한 계획서↔구현 불일치는 §N에 개선 권고로 정리한다.

**상태 범례**
`[✓ built]` 구현됨 · `[~ stub]` 데모 스텁만 있음 · `[✗ todo]` 미구현 · `[⚠ fix]` 구현됐으나 교정 필요

---

## 0. 아키텍처 한 줄 요약

RE:TURN은 "18개 툴 모음"이 아니라 **증거 수집 → 검토 → 서버 정책 판정 → 인간 승인 → 공식 기록 개정**을 완결하는 **감사 가능한(auditable) 시스템**이다. 제품의 척추는 UI가 아니라 **모든 consequential action이 통과하는 서버측 Policy Gateway**(§D)와 **불변 승인 파이프라인**(§E)이다.

```
Community Agent ─┐
Curator Agent  ──┤ WebMCP thin client (execute → API fetch)
                 ▼
        /api/tools/[name]  ·  role-scoped API routes
                 │
        ┌────────▼─────────┐
        │  Policy Gateway  │  (pure evaluate(): schema→role→tenancy→risk→consent→authority→provenance)
        └────────┬─────────┘
                 ▼
          Cloudflare D1 (Drizzle)  +  Activity/Audit log  +  Realtime events
                 ▲
   Curator UI ────┘  (동일 API·gateway 경로)
```

---

## A. 세션 · 테넌시 (Session & Tenancy)

| ID | 기능 | 상태 |
|---|---|---|
| A1 | **서명 쿠키 세션** — `museum_id` + `role`을 signed cookie로 발급/검증 | `[⚠ fix]` |
| A2 | **최초 방문 부트스트랩** — 첫 방문 시 `museum_id` 생성 + seed 주입 | `[~ stub]` |
| A3 | **역할 전환** — community ↔ curator, `museum_id` 유지, 페이지 refresh 허용 | `[~ stub]` |
| A4 | **Fresh museum reset** — 새 `museum_id` + 재시드, 이전 세션 격리 | `[~ stub]` |
| A5 | **서버측 역할 재검증** — 모든 API에서 role 재확인, mismatch 시 `403` | `[⚠ fix]` |
| A6 | **멀티테넌트 스코핑** — 모든 쿼리를 세션 `museum_id`로 강제 scope | `[✗ todo]` |

**교정 필요(⚠):** 현재 `route.ts`류는 `cookie.includes('role=curator')`로 role을 판정한다. 이는 (1) 서명 검증이 없어 위조 가능하고, (2) `role=curator_ui`도 substring 매칭되어 오판정한다. → HMAC 서명 쿠키 + 정확한 role 파싱으로 교체.
**미구현(✗):** `museumMatch`가 정책 입력에 항상 `true`로 전달되고 `museum_id`가 `'museum_demo_01'`로 하드코딩됨 → 실제 DB 대조 기반 tenancy로 교체.

---

## B. 데이터 · 영속화 (Data & Persistence)

| ID | 기능 | 상태 |
|---|---|---|
| B1 | **도메인 스키마 12엔티티** — Museum, Object, Asset, Evidence, ProvenanceEvent, Submission, Claim, LabelDraft, LabelPublication, ReviewCase, Approval, Escalation, Activity | `[~ stub]` |
| B2 | **런타임/DB 확정 — Cloudflare D1 (SQLite) + Drizzle ORM** | `[✓ built]` |
| B3 | **불변식(invariant) 강제** (아래) | `[✗ todo]` |
| B4 | **Revision 보존** — LabelPublication은 수정 없이 새 revision, 이전 official label 이력 보존 | `[✗ todo]` |
| B5 | **마이그레이션 + 시드 파이프라인** — `drizzle` migration + DB seed 생성기 | `[~ stub]` |

**B2 결정 사항:** 실제 코드(`db/index.ts`가 `drizzle-orm/d1`·`cloudflare:workers`)와 README가 모두 **Cloudflare D1** 기준이다. 계획서 §15의 "Neon Postgres"는 **outdated** → 명세는 D1(SQLite)로 통일한다(§N-1 권고).

**B3 불변식 목록:**
- 모든 row에 `museum_id` 존재.
- community actor는 authority를 `verified`로 만들 수 없다.
- published assertion은 evidence ref ≥ 1.
- `verified_fact`는 verified evidence ≥ 1 참조.
- consent가 허용하지 않는 evidence body는 public API 응답에 포함 금지.
- evidence는 어떤 agent tool로도 삭제 불가.
- 실제 object return 상태 컬럼은 만들지 않는다(ReviewCase만 생성).

**개선(스키마 확장 권고):** 현재 `approvals` 테이블에 `expires_at`가 없어 `expired` 상태(E4)를 표현할 수 없다 → `expires_at` 추가. `activity` 테이블은 `actor/action/detail`만 있어 감사가 빈약 → `actor_type, tool, risk, policy_decision, result` 추가(§K, §N-4).

---

## C. 증거 의미론 (Authority · Consent · Visibility · Assertion)

| ID | 기능 | 상태 |
|---|---|---|
| C1 | **2단계 Authority** `submitted` \| `verified` (3번째 단계 금지). community는 verified 부여 불가 | `[~ stub]` |
| C2 | **Consent 3단계 강제** `private` / `public_anonymous` / `public_attributed` — 공개 출력·인용 시 서버 강제. `research_only`는 FR-X1에서 제거(어느 코드 경로도 `private`와 구분하지 않았다) | `[~ stub]` |
| C2b | **`publish_asset` (MEDIUM)** 자산의 공개 여부는 큐레이터의 행위이며 게이트웨이를 통과한다. `consent=private` 은 거부 | `[✓ done]` |
| C2c | **`register_object` (HIGH)** 새 유물 등록. 에이전트는 제안, 인간이 생성. 커뮤니티 불가 (FR-X3) | `[✓ done]` |
| C3 | **Visibility 3단계** `public` / `restricted` / `sealed`. sealed는 agent tool output에서 완전 제외 | `[✗ todo]` |
| C4 | **Assertion mode 3종** `verified_fact` / `attributed_claim` / `open_question`. 각 assertion ref ≥ 1; open_question은 경계 evidence ≥ 2 또는 명시적 gap record 참조 | `[~ stub]` |

**아키텍처 개선(권고):** 현재 이 핵심 도메인 타입들이 데모 파일 `lib/demo-data.ts`에 선언돼 있다 → `lib/domain/types.ts`(또는 `lib/policy/types.ts`)로 이전해 데모 데이터와 도메인 계약을 분리한다(§N-5).

---

## D. 정책 게이트웨이 (Policy Gateway) — 제품의 척추

| ID | 기능 | 상태 |
|---|---|---|
| D1 | **순수 함수 `evaluate(tool, args, actor, ctx)`** — DOM/React/DB/network import 금지, resolved record를 `ctx`로 수신, client preview·server enforcement 공용 | `[~ stub]` |
| D2 | **Verdict 타입** `allow` / `queue`(risk, reason) / `deny`(policy, message, next, escalate?) | `[~ stub]` |
| D3 | **10단계 판정 순서** schema→role→tenancy→record존재→risk→consent/visibility→assertion×authority→justification provenance binding→HIGH시 immutable snapshot→activity log | `[✗ todo]` |
| D4 | **Core provenance rule** — HIGH↑ agent action의 refs가 비었거나 전부 submitted면 공식 행동 권한 없음 → **deny + escalation** | `[⚠ fix]` |
| D5 | **내용 미판정 원칙** — keyword/injection/의도/역사사실/증언감정 판정 안 함. source authority만 검사 | `[~ stub]` |
| D6 | **Denial ≠ dead end** — deny 시 `escalation_id`·`message`·`next` 반환, agent는 다른 작업 계속 | `[✗ todo]` |
| D7 | **Escalation 레코드 자동 생성** — submitted-only 거부 등에서 curator escalation 생성 | `[✗ todo]` |

**D4 교정 필요(⚠):** 현재 `evaluate.ts`의 core provenance rule은 `action === 'publish_label'`에만 적용된다. 그 결과 `open_return_review`는 refs가 submitted-only여도(심지어 비어 있어도) 항상 `pending_approval`로 queue된다. 계획서 §9.4/§8.10은 **모든 HIGH↑ agent action**에 규칙을 요구한다 → 규칙을 `risk >= HIGH && actor_type === 'agent'` 전체로 일반화(§N-2).

**D4 판정 예시(목표):**
```
propose_label_update  refs=[submitted oral history]        → denied + curator escalation
open_return_review    refs=[submitted only]                → denied + curator escalation   ← 현재 통과함(버그)
propose_label_update  refs=[verified accession, verified photo, reviewed oral]  → pending_approval
```

---

## E. 위험 · 승인 (Risk & Approval)

| ID | 기능 | 상태 |
|---|---|---|
| E1 | **4위험 등급 처리** LOW=즉시+기록 / MEDIUM=즉시+피드강조 / HIGH=미실행+queue / CRITICAL=항상 거부(큐 진입 금지) | `[~ stub]` |
| E2 | **불변 승인 snapshot** — tool, canonical args, draft body, assertion list, evidence refs, refs authority, refs consent, target object version, **SHA-256 hash** 저장 | `[~ stub]` |
| E3 | **Tampering 탐지** — 승인 실행 직전 현재값 vs snapshot 재비교, 불일치 시 `approval_snapshot_mismatch` deny | `[✗ todo]` |
| E4 | **승인 상태** `pending` / `approved` / `approved_with_edit` / `rejected` / `expired`. 만료·재사용 방지 | `[⚠ fix]` |
| E5 | **`approve_with_edit` 트랜잭션** (아래 9단계) | `[⚠ fix]` |
| E6 | **비차단 approval polling** — polling 중 blocking 없이 병행 작업 | `[~ stub]` |

**E5 교정 필요(⚠):** 이 기능은 제품의 시그니처(§11)지만, 현재 `approvals/[id]/resolve/route.ts`는 `approved`/`rejected`만 허용하고 `approve_with_edit`를 받지 않는다. 또한 승인 직전 **snapshot hash 재검증 없이** 바로 INSERT하며, `object_version`을 `3`으로 하드코딩한다. → 아래 단일 트랜잭션으로 구현:

1. approval snapshot 재검증 (hash + object_version 대조)
2. edited body schema 검증
3. object version 확인
4. 이전 official label을 revision history에 보존
5. 새 LabelPublication 생성
6. evidence refs 연결
7. approval `approved_with_edit`로 resolved
8. activity 기록
9. realtime event 발행

**E4 교정:** `expired` 상태를 위해 approvals에 `expires_at` 필요(§B, §N-3).

---

## F. API 응답 계약 · 실행 경로

| ID | 기능 | 상태 |
|---|---|---|
| F1 | **4개 표준 상위 상태** `applied` / `pending_approval` / `denied` / `invalid`. 모든 non-success에 `next` 필수 | `[~ stub]` |
| F2 | **단일 WebMCP 실행 엔드포인트** `/api/tools/[name]` dispatcher (계획서엔 없던 좋은 설계 — 유지) | `[~ stub]` |
| F3 | **Community 실행경로** evidence/claim/submission/collection — role·tenancy·input·asset ownership 검증 → policy → insert(authority=submitted) → activity → realtime | `[~ stub]` |
| F4 | **Curator 실행경로** summary/objects/submissions/cases/labels(propose)/reviews/approvals(resolve) | `[~ stub]` |
| F5 | **게이트웨이 단일 통과 강제** — consequential route는 반드시 gateway 경유(UI 버튼도 동일 API·gateway) | `[✗ todo]` |

**주의:** 현재 `/api/tools/[name]/route.ts`는 하드코딩된 데모 데이터를 반환한다(예: `get_object_detail`은 항상 `moonbird` 반환) → 실제 DB 조회 + tenancy scope + gateway 경유로 교체.

---

## G. WebMCP 등록 · 어댑터 계층 ★핵심 교정 지점★

| ID | 기능 | 상태 |
|---|---|---|
| G1 | **property 위치 어댑터 — `document.modelContext` 우선, `navigator.modelContext`는 legacy fallback** (`document.modelContext ?? navigator.modelContext`), navigator 사용 시 deprecation 경고 | `[✓ built]` |
| G2 | **해제 = AbortController** — 등록별 `AbortController` → spec에 `signal` 동봉 → unmount·role전환·재등록 전 `abort()` | `[✓ built]` |
| G3 | **역할 조건부 등록** — community 페이지는 curator tool을 절대 `registerTool()` 하지 않음(등록 + 서버검증 이중 방어) | `[✓ built]` |
| G4 | **context는 description에 baked-in** — `provideContext()`/`clearContext()`는 제거됨, 명세·타입에서 완전 제외 | `[✓ built]` |
| G5 | **Annotation** read=`readOnlyHint:true`, write=`false`, submitted 반환 tool=`untrustedContentHint:true` | `[✓ built]` |
| G6 | **크기·형식 제약** name ≤30자, description ≤500자, param description ≤150자(전 파라미터 필수), 단건 output ~1.5K자(ID/요약/ref 반환), 목록 output은 페이지 크기에 유계 | `[✓ built]` |
| G7 | **thin client** execute는 내부 API fetch만, 중복 등록 방지, feature detection | `[✓ built]` |

**검증된 사실(2026-08 기준 웹 검색):**
- WebMCP getter는 2026-05-27 Web ML CG draft에서 `Navigator` → `Document`로 이동. `navigator.modelContext`는 Chromium 150에서 **deprecated**, `document.modelContext.registerTool()`가 현재 방식.
- WebMCP에 **`unregisterTool()` 메서드는 없다.** 유일한 정식 해제 경로는 등록 시 `AbortSignal` 전달 후 `abort()`.
- `provideContext()`/`clearContext()`는 2026-03-05 draft에서 제거됨.

**G2 구현 노트:** `registerTool`에 넘기는 spec에 `signal`을 동봉하고, cleanup이 `abort()`한다. 다만 **abort는 응답이 없는 요청**이라 브라우저가 실제로 해제했는지 확인할 방법이 없다. 따라서 등록된 이름을 재등록 가능 상태로 되돌리는 것은 그 브라우저가 구형 `unregisterTool`도 함께 제공할 때로 한정한다. 이름을 붙들면 등록 한 번을 건너뛰는 비용이고, 잘못 풀면 다음 마운트에서 `InvalidStateError: Duplicate tool name`이 발생해 React commit이 통째로 무너진다.

**측정 기록:** 이 항목을 착수할 때 `register.ts`는 이미 명시적 guard로 재작성돼 있었고(조용한 no-op 아님), 역할 전환이 전체 페이지 로드라 새 ModelContext를 받으므로 **실제 도구 잔존은 발생하지 않는 상태였다.** G2는 버그 수정이 아니라 스펙 정합성 작업이었다.

---

## H. 실시간 (Realtime)

| ID | 기능 | 상태 |
|---|---|---|
| H1 | **이벤트 3종** submission 생성→curator inbox badge / approval resolution→public label / activity feed 갱신 | `[✗ todo]` |
| H2 | **Cross-surface 반영** 좌(제출)→우(inbox), 우(승인)→좌(label) 실시간 | `[✗ todo]` |
| H3 | **Fallback** SSE 우선, 불안정 시 2초 polling. 데모 안정성 우선 | `[✗ todo]` |

---

## I. 도메인 기능 (Label · Provenance · Evidence)

| ID | 기능 | 상태 |
|---|---|---|
| I1 | **Label front/back "flip"** — "현재 말하는 것" ↔ "기록이 아직 묻는 것" | `[✓ built]` |
| I2 | **Label diff** — before/after 비교(승인 drawer) | `[✗ todo]` |
| I3 | **Provenance timeline + gap 탐지** — event별 status(claimed/verified/disputed/gap)·authority, gap 시각화 | `[~ stub]` |
| I4 | **Evidence 비교** — 확인된 사실 / 출처있는 주장 / 충돌 / 미답 질문 / 공개·인용 제한 분리 출력 | `[~ stub]` |
| I5 | **내부 timeline draft 빌더** — 공식 timeline 미변경, 초안·gap·conflict·미답질문 반환 | `[~ stub]` |

---

## J. UI 표면 (Surfaces)

| ID | 기능 | 상태 |
|---|---|---|
| J1 | **Community** home(`/`), object detail(label flip), 7단계 contribution flow, submission status | `[~ stub]` |
| J2 | **Curator** dashboard, submission inbox(blue badge + untrustedContentHint), evidence desk(`/curator/cases/[id]` 좌우 대조), case detail, 3칼럼 label editor(current/agent draft/curator edit + mode badge), **전역 approval drawer**, activity feed | `[~ stub]` |
| J3 | **디자인 토큰** ivory/charcoal, official=deep green, submitted=cobalt, conflict=amber, gap=dotted red, restricted=violet+lock, editorial serif + sans | `[~ stub]` |
| J4 | **접근성** 의미있는 alt, 색상만으로 상태 구분 금지, keyboard로 flip/drawer/diff, focus trap+Escape, reduced motion, consent 평이한 언어 | `[✗ todo]` |

---

## K. 활동 · 감사 (Activity & Audit)

| ID | 기능 | 상태 |
|---|---|---|
| K1 | **전수 로깅** — 모든 action을 `actor_role, actor_type, tool, action, target, risk, policy_decision, result`와 함께 기록 | `[⚠ fix]` |
| K2 | **명명된 참여자 피드** — Community Agent / Curator Agent / Policy Gateway / (이름) Curator / System | `[✓ built]` |

**K1 교정:** 현재 `activity` 테이블은 `actor/action/detail`만 저장 → 위 감사 필드로 확장(§B, §N-4). 감사 로그는 "인간과 에이전트가 함께 기록을 만들었다"는 데모 서사와 정책 강제의 증거이므로 필수.

---

## L. 테스트 · 품질

| ID | 기능 | 상태 |
|---|---|---|
| L1 | **정책 unit test ≥35** — role/tenancy, authority, consent, visibility, risk, approval integrity, injection 3변종(내용 무관·동일 authority rule 검증) | `[~ stub]` |
| L2 | **API 통합 테스트** — e2e 제출, inbox 가시성, submitted→public label 자동반영 안 됨, approval 트랜잭션, realtime, 403, reset 격리 | `[✗ todo]` |
| L3 | **WebMCP eval** — gap 검색, 특정 사진 관련 object 찾기, evidence 제출, batch 검토, label draft, submitted-only 시도 후 recovery, polling 중 병행 | `[~ partial]` — 정적 게이트(컨텍스트 비용·유사도·설명 적합성)는 구현·통과. 시나리오 7종은 `EVAL_SCENARIOS`에 채점 가능한 형태로 고정. **선택 정확도는 모델 실행 필요** (`npm run eval:tools`) |

**핵심 회귀 테스트(권고 추가):** D4 일반화를 지키기 위해 "`open_return_review` submitted-only → denied" 케이스를 반드시 포함(현재 버그를 고정).

---

## M. 운영 (Ops)

| ID | 기능 | 상태 |
|---|---|---|
| M1 | **Asset 파이프라인** — 업로드 자산 먼저 `Asset` record 생성 → tool은 `asset_ids`만 수신 → 서버가 type/size/visibility 검증 | `[✗ todo]` |
| M2 | **Seed dataset** — Halcyon 박물관 + 유물 8종 + 제출 3~5종 + injection 3종(dealer memo/catalog footer/위장 첨부에 배치, 공동체를 공격자로 묘사 금지) | `[~ stub]` |
| M3 | **배포·문서** — 프로덕션 배포, fresh museum 최종 테스트, public repo, README, license, <3분 데모 영상, 모든 데이터 fictional 명시 | `[~ stub]` |

---

## N. 계획서(RETURN_PLAN.md) 수정 권고

검토 중 발견한 계획서↔구현 불일치. 이 명세는 아래 교정본을 canonical로 채택한다.

| # | 계획서 위치 | 현재 서술 | 권고 |
|---|---|---|---|
| N-1 | §15 기술 스택 | "Neon Postgres" | **Cloudflare D1 (SQLite) + Drizzle + Workers 런타임**으로 교정(실제 코드·README와 일치) |
| N-2 | §9.4 / §8.10 | core provenance rule을 문장 서술로만 | "**모든 HIGH↑ agent action**에 적용"을 명시적 조건(`risk>=HIGH && actor_type==='agent'`)으로 못박기 — 현재 구현은 publish_label에만 적용되는 버그 |
| N-3 | §12 Approval / §8.11 | `expired` 상태만 언급, TTL 필드 없음 | approvals에 `expires_at` 추가, 만료 판정 로직 명시 |
| N-4 | §12 Activity | 실제 테이블은 `actor/action/detail`만 | 계획서대로 `actor_type/tool/risk/policy_decision/result` 컬럼 확정 |
| N-5 | §16 repo 구조 | `lib/db/`, `lib/policy/{rules,authority,consent}.ts`, `lib/webmcp/{register-community,register-curator,schemas,descriptions}.ts` | 실제 구조로 갱신: `db/`, `lib/policy/{types,evaluate,rules.test}.ts`, `lib/webmcp/register.ts`, `lib/demo-data.ts`, `app/api/tools/[name]/route.ts`(단일 dispatcher) |
| N-6 | §13 Seed | "Meridian Museum" + Rain Drum/Salt Map/Glass Seed/River Bell/Amber Transit/Twin Canoe/Star Loom | 실제 시드 채택: **"The Halcyon Museum of Material Memory"** + Moonbird Mask/Riverstone Vessel/Woven Signal Cloth/Tide Listening Stone/Reed Memory Box/Four Winds Bowl/Dawn Marker/Harbor Thread Map |
| N-7 | §13.3 Moonbird | 제작 "1940년대" | 실제 시드는 **"c. 1930"** (gap 1959–1968은 유지). 하나로 통일 |
| N-8 | §18.1 / §15 | "role 전환 시 unregister", "signed cookies" | (a) unregister는 **AbortController**로 명시(unregisterTool 부재), (b) 실제 서명 쿠키 구현으로 `includes()` 검사 교체 |

---

## 부록: 검증 출처 (WebMCP 사실)

- [WebMCP Draft — Web ML CG](https://webmachinelearning.github.io/webmcp/)
- [WebMCP 명세 저장소](https://github.com/webmachinelearning/webmcp)
- [Chrome WebMCP 가이드/EPP](https://developer.chrome.com/blog/webmcp-epp)
- WebMCP in Chrome 149 (dev.to), WebMCP Cheat Sheet (webfuse.com) — navigator→document 이동, unregisterTool 부재, provideContext 제거 확인

> 유의: 위 WebMCP 사실은 2026-08 웹 검색에 근거한다. 최종 심사 브라우저의 실제 E2E 테스트에서 특정 구형 런타임(navigator 전용 또는 `unregisterTool` 제공)이 필수로 확정되면 §G1·G2 우선순위가 뒤집히며, 그 경우에도 별도 compatibility adapter로 격리한다.
