# A1 · 유물·증거·타임라인 DB 이전 — 구현 및 테스트 보고서

> 대상 저장소: `return/`  
> 기준 문서: `TASK_SPLIT.md`의 **1번 담당 A1**  
> 목적: 정적 데모 상수로 제공되던 유물·증거·타임라인·공개 라벨을 tenant별 Cloudflare D1 데이터로 이전한다.

---

## 0. 처음 보는 사람을 위한 쉬운 설명

### 0.1 이 프로젝트는 무엇을 하는가

RE:TURN은 박물관 유물 기록을 보여주고, 공동체가 새로운 사진·문서·기억을 제출하면 큐레이터가 검토할 수 있게 만든 데모다.

예를 들어 Moonbird Mask에는 다음 정보가 있다.

- 박물관이 현재 공개하는 유물 설명
- 언제 어디에 있었는지를 보여주는 timeline
- 기록이 비어 있는 `1959–1968` 구간
- 공동체가 제출한 1959년 사진
- 박물관이 확인한 1968년 invoice
- 아직 답하지 못한 질문

사용자는 왼쪽 Community 화면에서 유물 기록을 보고 자료를 제출한다. 큐레이터는 오른쪽 Curator 화면에서 제출 자료와 기존 기록을 비교한다.

### 0.2 가장 단순한 작동 구조

브라우저에서 Moonbird Mask를 열면 다음 순서로 작동한다.

```text
사용자
  → /objects/moonbird-mask 페이지 요청
  → 현재 사용자의 museum_id 확인
  → db/queries.ts에 Moonbird 데이터를 요청
  → D1 데이터베이스에서 해당 museum의 row 검색
  → object + 현재 label + timeline을 조합
  → React 페이지가 화면을 그림
```

공동체가 자료를 제출하면 다음 순서로 작동한다.

```text
사용자 입력
  → /api/community/evidence
  → session role과 museum_id 확인
  → 입력한 object가 현재 museum에 있는지 DB에서 확인
  → submissions 테이블에 received 상태로 저장
  → activity 기록 생성
  → submission ID를 사용자에게 반환
```

WebMCP agent가 유물을 검색할 때도 같은 DB를 사용한다.

```text
Agent
  → search_collection 도구 호출
  → /api/tools/search_collection
  → session museum_id 확인
  → public object만 DB에서 검색
  → JSON 결과 반환
```

즉, 일반 웹 화면과 agent 도구가 서로 다른 가짜 데이터를 쓰는 것이 아니라 같은 데이터베이스를 읽는다.

### 0.3 A1 이전에는 어떻게 작동했는가

A1 이전에는 유물 정보가 데이터베이스에 저장되어 있지 않았다. 다음과 비슷한 JavaScript 배열이 `lib/demo-data.ts` 안에 직접 들어 있었다.

```ts
const collection = [
  { id: 'moonbird-mask', title: 'Moonbird Mask', gap: '1959–1968' },
  // 나머지 유물...
];
```

페이지는 DB에 질문하지 않고 이 배열을 바로 읽었다.

```text
페이지
  → demo-data.ts 배열 읽기
  → records.ts가 label과 timeline을 코드로 조합
  → 화면 표시
```

이 방식은 처음 데모 화면을 빠르게 만들 때는 편하다. 하지만 다음 문제가 있다.

- DB에서 object를 수정해도 화면이 바뀌지 않는다.
- 새 workspace를 만들어도 같은 전역 배열을 본다.
- 현재 label revision을 DB에 보존할 수 없다.
- sealed evidence를 DB query 단계에서 숨길 수 없다.
- 화면과 agent가 실제 저장된 기록을 함께 사용한다고 보기 어렵다.

### 0.4 A1 이후에는 어떻게 작동하는가

A1 이후 `lib/demo-data.ts`에는 더 이상 유물 배열이 없다. 기존 policy 파일이 사용하는 type export만 남아 있다.

실제 데이터는 다음처럼 분리된다.

```text
objects
  → 유물의 기본 정보

evidence
  → 사진, invoice, oral history 같은 근거

provenance_events
  → 시간순 사건과 기록 gap

label_publications
  → 박물관이 공개한 label revision
```

`lib/records.ts`도 데이터를 직접 만들지 않는다. 이 파일은 DB query 함수를 사용하기 편하게 묶어 주는 얇은 연결 역할을 한다.

```text
페이지/API
  → lib/records.ts
  → db/queries.ts
  → db/setup.ts가 DB 준비 여부 확인
  → Cloudflare D1
```

### 0.5 주요 파일의 역할

| 파일 | 쉬운 설명 |
|---|---|
| `app/page.tsx` | Community 첫 화면을 그린다. DB에서 유물 목록을 받는다. |
| `app/objects/[id]/page.tsx` | 유물 상세, label, timeline을 그린다. |
| `app/api/tools/[name]/route.ts` | WebMCP 도구 이름에 맞는 서버 작업을 실행한다. |
| `app/api/community/evidence/route.ts` | 공동체 자료 제출을 받아 DB에 저장한다. |
| `lib/session.ts` | 지금 사용자의 role과 museum ID를 읽는다. |
| `lib/records.ts` | object record, evidence, collection 조회를 한곳에서 호출하게 해 준다. |
| `db/queries.ts` | 실제 SQL을 실행하고 DB row를 화면에서 쓰기 좋은 형태로 바꾼다. |
| `db/setup.ts` | 테이블이 있는지 확인하고 새 workspace를 시드한다. |
| `db/seed-data.ts` | 처음 생성할 가상 박물관 데이터의 원본이다. |
| `db/schema.ts` | Drizzle이 이해하는 최종 테이블 구조다. |
| `drizzle/*.sql` | 빈 DB 또는 기존 DB를 순서대로 업그레이드하는 SQL이다. |

### 0.6 자주 나오는 용어

| 용어 | 쉬운 뜻 |
|---|---|
| row | DB 테이블에 저장된 한 줄의 데이터 |
| query | DB에 데이터를 찾거나 저장해 달라고 요청하는 것 |
| tenant | 서로 데이터가 섞이면 안 되는 독립 workspace 또는 박물관 |
| `museum_id` | 어떤 박물관의 데이터인지 구분하는 값 |
| seed | 새 workspace에 처음 넣어 주는 기본 데모 데이터 |
| migration | 기존 DB 구조를 새 구조로 순서대로 바꾸는 SQL |
| authority | 자료가 제출 상태인지 기관 검토 상태인지 나타내는 값 |
| consent | 자료를 공개·인용할 수 있는 범위 |
| visibility | 자료의 존재와 접근 범위를 public/restricted/sealed로 구분한 값 |
| provenance | 유물이 언제 어디에 있었고 누구를 거쳤는지에 대한 이력 |
| gap | provenance 문서가 비어 있어 이동이나 보관 경로를 확인할 수 없는 기간 |
| label | 관람객에게 보여 주는 박물관의 공식 설명 |
| revision | 기존 label을 지우지 않고 새로 추가한 다음 버전 |
| pointer | 현재 사용 중인 다른 row의 ID를 가리키는 값 |

### 0.7 `museum_id`가 왜 필요한가

이 프로젝트에서는 reset을 누를 때 새로운 demo museum workspace가 만들어질 수 있다.

두 workspace 모두 `moonbird-mask`라는 동일한 object ID를 가질 수 있다. 따라서 ID만 검색하면 데이터가 섞일 수 있다.

잘못된 조회:

```sql
SELECT * FROM objects WHERE id = 'moonbird-mask';
```

현재 조회 방식:

```sql
SELECT *
FROM objects
WHERE museum_id = ?
  AND id = 'moonbird-mask';
```

`?`에는 현재 session의 museum ID가 들어간다. 따라서 다른 workspace의 Moonbird row가 반환되지 않는다.

### 0.8 label pointer는 어떻게 작동하는가

`objects` 테이블 안에 label 본문을 직접 덮어쓰지 않는다.

```text
objects.current_label_id
  → label_publications의 현재 revision ID
```

예:

```text
Moonbird object
  current_label_id = LBL-moonbird-mask-R3

label_publications
  R1 = 최초 label
  R2 = 두 번째 label
  R3 = 현재 label
```

페이지는 object와 `current_label_id`가 가리키는 publication을 join해서 현재 문장을 표시한다.

나중에 A2가 완료되면 승인할 때 R3을 수정하는 대신 R4를 추가하고, `current_label_id`만 R4로 바꾼다. 이 구조 덕분에 이전 공식 문장을 잃지 않는다.

### 0.9 public / restricted / sealed의 차이

이를 박물관 자료실에 비유하면 다음과 같다.

- `public`: 전시실에서 누구나 볼 수 있는 자료
- `restricted`: 자료가 있다는 것은 알 수 있지만 본문 열람에는 제한이 있는 자료
- `sealed`: agent나 공개 사용자는 자료의 존재 자체를 알 수 없는 봉인 자료

예를 들어 agent가 restricted와 sealed evidence ID를 함께 요청하면:

```text
restricted
  → 제목이나 제한 상태는 나올 수 있음
  → 본문은 null 또는 withheld

sealed
  → evidence 배열에 나오지 않음
  → 본문도 나오지 않음
```

### 0.10 seed와 실제 사용 데이터의 관계

seed는 매 요청마다 DB를 초기 상태로 되돌리는 기능이 아니다.

작동 방식:

```text
요청 발생
  → 해당 museum에 object가 있는지 확인
  → 있으면 기존 데이터를 그대로 사용
  → 없으면 demo dataset을 한 번 생성
```

따라서 사용자가 만든 submission이나 변경 상태를 매번 덮어쓰지 않는다. `INSERT OR IGNORE`도 이미 같은 key가 있는 row를 보존한다.

---

## 1. A1에서 처리한 범위

A1은 아래 기능 ID를 대상으로 한다.

| ID | 적용 내용 |
|---|---|
| B1 | `objects`, `evidence`, `provenance_events`, `label_publications` 테이블 추가 |
| B5 | 순서가 있는 SQL 마이그레이션과 idempotent workspace 시드 파이프라인 추가 |
| C3 | `public`, `restricted`, `sealed` visibility를 DB 조회 단계에서 적용 |
| I3 | provenance timeline과 gap을 `lib/records.ts` 상수가 아닌 DB event로 생성 |
| M2 | 유물 8종, 기본 제출 3종, evidence 및 indirect injection 3종 시드 |
| N-6 | 박물관과 유물 이름을 실제 데모 데이터인 Halcyon 컬렉션으로 통일 |
| N-7 | Moonbird Mask 제작 시기를 `c. 1930`으로 통일하고 `1959–1968` gap 유지 |

A1에서 다루지 않은 범위:

- 정책 규칙 일반화
- escalation 생성·표시
- activity 감사 필드 확장
- SSE와 polling 기반 실시간 갱신
- WebMCP 등록 해제 방식
- 승인 실행 시 새 label revision을 발행하는 A2
- approval tampering·만료·재검증을 완성하는 A4

현재 최종 `SCHEMA.md`에는 이후 공동/다른 트랙에서 추가된 governance 스키마까지 포함되어 총 9개 테이블이 있지만, **A1이 직접 추가한 핵심 도메인 테이블은 4개**다.

---

## 2. 이전 상태와 현재 상태

### 2.1 한눈에 보는 Before / After

| 항목 | A1 이전 | A1 적용 후 |
|---|---|---|
| 컬렉션 데이터 | `lib/demo-data.ts`의 배열 상수 | D1 `objects` 조회 |
| 객체 상세 | `lib/records.ts`가 상수를 조합 | `objects` + 현재 `label_publications` + `provenance_events` 조회 |
| 공개 라벨 | `moonbird.label` 문자열 | `objects.current_label_id`가 가리키는 publication body |
| evidence | Moonbird 전용 상수 2개 | tenant별 `evidence` row |
| timeline | 코드에서 즉석 생성 | tenant별 `provenance_events` row |
| gap | `gap` 문자열과 코드 분기 | object의 대표 gap + 명시적 `status='gap'` event |
| visibility | 타입만 있고 사실상 항상 public | public/restricted/sealed 조회 필터 적용 |
| workspace reset | 제출·승인만 새 workspace에 생성 | 유물·evidence·timeline·label까지 새 workspace에 독립 생성 |
| tenant 격리 | 정적 상수라 모든 workspace가 같은 메모리 데이터 사용 | 모든 쿼리가 session `museum_id`를 조건으로 사용 |
| 시드 ID | 일부 전역 고정 ID | 복합 PK 또는 workspace별 ID를 사용해 fresh workspace 간 충돌 방지 |
| 페이지 함수 | 동기 상수 조회 | async server-side DB 조회 |

### 2.2 화면이 비슷해 보여도 달라진 핵심

A1은 UI 재디자인 작업이 아니다. 따라서 첫 화면의 유물 8개와 Moonbird Mask의 내용은 의도적으로 이전과 비슷하게 보인다.

실제 차이는 데이터 흐름에 있다.

```text
A1 이전

page / tool
  → lib/demo-data.ts
  → lib/records.ts에서 timeline 조립
  → 항상 같은 상수 반환

A1 적용 후

page / tool
  → session museum_id 확인
  → db/queries.ts
  → Cloudflare D1
     ├─ objects
     ├─ evidence
     ├─ provenance_events
     └─ label_publications
  → consent/visibility에 맞게 결과 변환
```

이제 DB의 현재 label pointer나 visibility가 바뀌면 페이지와 도구 결과도 같은 데이터를 읽는다. 이전에는 DB를 수정해도 페이지가 정적 상수를 계속 표시했다.

---

## 3. 추가된 A1 스키마

### 3.1 `objects`

유물의 공식 레코드와 현재 공개 라벨 pointer를 저장한다.

주요 필드:

- `(museum_id, id)` 복합 기본키
- `accession_number`
- `title`, `description`, `origin`, `period`, `object_type`, `material`
- `current_label_id`
- `visibility`
- `provenance_completeness`
- `provenance_gap`
- `questions` JSON
- `version`

핵심 동작:

- 같은 `moonbird-mask` ID를 여러 workspace에서 사용할 수 있다.
- public 페이지는 public object만 읽는다.
- curator UI는 tenant 내부 object를 읽을 수 있다.
- agent 조회에서는 sealed object를 제외할 수 있다.

### 3.2 `evidence`

사진, 문서, 구술 기록, access request 등의 evidence를 저장한다.

주요 필드:

- `(museum_id, id)` 복합 기본키
- `object_id`
- `type`, `title`, `body`
- `source_name`, `source_relationship`
- `date_or_period`, `place`
- `authority`: `submitted` 또는 `verified`
- `consent`: 4단계
- `visibility`: 3단계
- `submitted_by`, `verified_by`, `verified_at`

### 3.3 `provenance_events`

timeline을 코드에서 만들지 않고 event row로 보존한다.

주요 필드:

- `(museum_id, id)` 복합 기본키
- `object_id`
- `start_date`, `end_date`
- `title`, `detail`
- `custodian`, `location`
- `status`: `claimed`, `verified`, `disputed`, `gap`
- `authority`
- `evidence_refs` JSON
- `is_gap`
- `sort_order`

Moonbird Mask에는 다음 event가 저장된다.

1. `c. 1930` — Mask made
2. `1959` — Community photograph
3. `1959–1968` — Movement unknown, 명시적 gap
4. `1968` — Museum acquisition
5. `2026` — Joint research opened

### 3.4 `label_publications`

공개 라벨 revision을 보존하기 위한 테이블이다.

주요 필드:

- `(museum_id, id)` 복합 기본키
- `object_id`
- `title`, `body`
- `assertions` JSON
- `evidence_refs` JSON
- `revision_number`
- `approved_by`
- `published_at`, `superseded_at`

제약:

- `(museum_id, object_id, revision_number)` UNIQUE
- `objects.current_label_id`가 현재 공개 revision을 가리킨다.

A1은 기존 공식 label을 publication row로 이전하고 읽기 경로를 연결했다. 인간 승인 후 **새 revision을 추가하는 쓰기 트랜잭션은 A2 범위**다.

---

## 4. 마이그레이션과 런타임 호환 경로

### 4.1 SQL 마이그레이션

| 파일 | 역할 |
|---|---|
| `return/drizzle/0000_return_foundation.sql` | 기존 museums/submissions/approvals/activity |
| `return/drizzle/0001_domain_records.sql` | A1의 4개 도메인 테이블 |
| `return/drizzle/0002_governance_audit.sql` | 이후 governance 컬럼, escalations, unique accession |

빈 DB에는 반드시 `0000 → 0001 → 0002` 순서로 한 번씩 적용한다.

검증 결과:

- 세 migration을 빈 SQLite DB에 순서대로 적용 성공
- 최종 업무 테이블 9개 확인
- 최종 사용자 정의 인덱스 9개 확인
- `uq_objects_museum_accession`은 `0002`에서 추가됨

### 4.2 `ensureDatabase()` 호환 경로

개발·데모 환경에서는 첫 요청 시 `ensureDatabase()`가 다음을 수행한다.

1. 누락된 테이블 생성
2. legacy submissions/approvals/activity 컬럼 확인
3. 누락된 컬럼만 추가
4. 기존 row backfill
5. 해당 `museum_id`에 object가 없다면 전체 demo dataset 시드

시드는 `INSERT OR IGNORE`를 사용해 반복 호출해도 기존 사용자 상태를 덮어쓰지 않는다.

---

## 5. 시드 데이터

### 5.1 유물 8종

| ID | 이름 | 대표 상태 |
|---|---|---|
| `moonbird-mask` | Moonbird Mask | 1959–1968 gap |
| `riverstone-vessel` | Riverstone Vessel | complete record |
| `woven-signal-cloth` | Woven Signal Cloth | 1946–1952 gap |
| `tide-listening-stone` | Tide Listening Stone | stable record |
| `reed-memory-box` | Reed Memory Box | 1921–1934 gap |
| `four-winds-bowl` | Four Winds Bowl | context added |
| `dawn-marker` | Dawn Marker | stable record |
| `harbor-thread-map` | Harbor Thread Map | 1939–1951 gap |

### 5.2 Moonbird evidence와 injection fixture

일반 evidence:

- `EV-068`: verified 1968 gallery invoice
- `EV-059`: submitted 1959 community photograph
- `EV-OH-059`: submitted oral history
- `EV-CAT-061`: submitted catalog excerpt
- `EV-NAME-REQ`: restricted naming/display request

간접 injection 테스트 evidence:

- `EV-INJ-DEALER`: restricted dealer memo
- `EV-INJ-CATALOG`: restricted catalog footer
- `EV-INJ-SEALED`: sealed system-styled attachment

공동체 구성원을 공격자로 표현하지 않고, 공격 문구는 출처 불명의 legacy/dealer/catalog 자료에 배치했다.

### 5.3 시드 수량

| 종류 | 수량 |
|---|---:|
| objects | 8 |
| evidence | 8 |
| indirect injection evidence | 3 |
| provenance events | 29 |
| label publications | 8 |
| submissions | 3 |
| seeded pending approvals | 1 |

---

## 6. visibility와 consent 동작 변화

### 6.1 조회 결과 행렬

| 데이터 | Public page/tool | Curator agent tool | Human curator UI |
|---|---|---|---|
| public + public consent | 본문 포함 | 본문 포함 | 본문 포함 |
| restricted | 제외 또는 본문 withheld | metadata 가능, 본문 withheld | 전체 검토 가능 |
| sealed | 존재 자체 제외 | 존재 자체 제외 | 권한 있는 인간 검토 경로에서만 가능 |
| public_anonymous | 제출자 익명화 | 제출자 익명화 | 내부 원본 검토 가능 |
| research_only/private | 공개 본문 제외 | 본문 withheld | 내부 검토 가능 |

### 6.2 A1 이전과의 차이

A1 이전:

- `Visibility` 타입은 있었지만 evidence 조회가 항상 `'public'`처럼 처리됐다.
- sealed fixture 자체가 없었다.
- public/agent/human 조회 경로가 DB query 수준에서 분리되지 않았다.

A1 적용 후:

- public object query는 `visibility='public'`을 강제한다.
- agent query는 sealed row를 SQL 결과에서 제외한다.
- restricted/research-only/private body는 응답 변환 시 `null` 또는 withheld 문구로 바뀐다.
- public anonymous source는 익명화된다.
- 정책 검사는 sealed metadata를 내부적으로 확인할 수 있지만 agent 응답에는 내용을 노출하지 않는다.

---

## 7. 변경된 페이지와 도구

### 7.1 Community 페이지

- `/`
  - collection과 featured object를 DB에서 조회
- `/objects/[id]`
  - object, 현재 label, questions, timeline을 DB에서 조회
- `/contribute`
  - object picker 목록을 DB에서 조회한 뒤 client component에 전달
- `/submissions/[id]`
  - submission의 object 제목을 tenant DB에서 조회

### 7.2 Curator 페이지

- `/curator`
  - object/gap 요약을 DB에서 계산
- `/curator/objects`
  - tenant object 목록과 submission 수를 조합
- `/curator/submissions`
  - object filter를 DB object 목록으로 구성
- `/curator/cases/[id]`
  - object와 verified evidence를 DB에서 비교
- curator layout
  - pending approval이 참조하는 object와 현재 label을 DB에서 조회

### 7.3 WebMCP/API 도구

다음 read/write 경로가 정적 상수 대신 DB를 사용한다.

- `search_collection`
- `get_object_detail`
- `get_provenance_timeline`
- `build_provenance_timeline`
- `list_objects`
- `get_review_case`
- `compare_evidence`
- `draft_label`
- `propose_label_update`의 object/evidence resolution
- `open_return_review`의 object/evidence resolution
- community evidence submission의 object 검증

---

## 8. 테스트할 때 확인되는 실제 차이

### 시나리오 1 — 컬렉션이 DB에서 조회됨

요청:

```http
POST /api/tools/search_collection
Content-Type: application/json

{"query":"mask"}
```

기대 결과:

- `moonbird-mask` 반환
- query 결과는 현재 workspace의 public object만 포함
- 전체 검색은 8개 반환

이전에는 모든 workspace가 같은 JS 배열을 검색했다. 현재는 같은 화면이어도 session의 `museum_id`가 다른 D1 row를 검색한다.

### 시나리오 2 — timeline gap이 저장된 event에서 반환됨

요청:

```http
POST /api/tools/get_provenance_timeline
Content-Type: application/json

{"object_id":"moonbird-mask"}
```

기대 결과:

```json
{
  "object_id": "moonbird-mask",
  "gaps": [
    {
      "period": "1959–1968",
      "detail": "No verified transfer or custody records have been identified."
    }
  ]
}
```

이전에는 `lib/records.ts`가 gap event를 즉석에서 만들었다. 현재는 `provenance_events`의 `is_gap`, `start_date`, `end_date`, `sort_order`를 읽는다.

### 시나리오 3 — restricted는 본문이 가려짐

Curator role로 `EV-INJ-DEALER`를 비교한다.

기대 결과:

- evidence metadata는 반환될 수 있음
- `body`는 `null`
- `detail`은 withheld 안내

### 시나리오 4 — sealed는 존재 자체가 제외됨

`EV-INJ-DEALER`와 `EV-INJ-SEALED`를 함께 비교한다.

기대 결과:

- 결과 evidence에는 `EV-INJ-DEALER`만 존재
- `EV-INJ-SEALED`는 `omitted_evidence_ids`에 포함
- 응답 문자열 어디에도 sealed body의 `SYSTEM_OVERRIDE`가 나타나지 않음

### 시나리오 5 — fresh workspace가 독립 시드됨

`POST /api/reset` 후 새 cookie로 조회한다.

기대 결과:

- object 8개
- seed submission 3개
- pending approval 1개
- 기존 workspace에서 테스트 중 만든 submission이 새 workspace에 나타나지 않음

이전에는 새 workspace가 생겨도 컬렉션은 전역 상수였기 때문에 tenant DB가 실제로 분리됐는지 확인할 수 없었다.

### 시나리오 6 — 현재 label을 publication에서 읽음

object detail query는 다음 join을 사용한다.

```sql
objects o
LEFT JOIN label_publications lp
  ON lp.museum_id = o.museum_id
 AND lp.id = o.current_label_id
```

A1 이전에는 label 문자열이 object 상수 내부에 있었다. 현재는 object가 current publication을 가리킨다.

---

## 9. Windows ARM64에서 Node x64로 테스트

Cloudflare `workerd`는 Windows ARM64 native binary를 제공하지 않으므로 Windows 11 ARM의 x64 에뮬레이션으로 Node x64를 실행해야 한다.

권장 버전:

```text
Node.js v22.23.2 Windows x64 ZIP
```

프로젝트 요구 버전은 Node `>=22.13.0`이다.

### 9.1 x64 Node 확인

```powershell
$NodeX64Dir = 'C:\Users\jsmd0\Tools\node-v22.23.2-win-x64'
$env:Path = "$NodeX64Dir;$env:Path"

node -p "process.version + ' / ' + process.arch + ' / ' + process.platform"
```

필수 출력:

```text
v22.23.2 / x64 / win32
```

`arm64`가 출력되면 테스트를 계속하지 말고 PATH를 바로잡는다.

### 9.2 의존성 재설치

ARM Node로 설치된 `node_modules`에는 잘못된 native optional dependency가 들어 있으므로 재사용하면 안 된다.

실행 중인 dev 서버를 종료한 뒤:

```powershell
Set-Location 'C:\Users\jsmd0\Documents\WebMCP\return'

Remove-Item -LiteralPath '.\node_modules' -Recurse -Force
Remove-Item -LiteralPath '.\dist' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '.\.next' -Recurse -Force -ErrorAction SilentlyContinue

npm ci
```

주의:

- `package-lock.json`은 삭제하지 않는다.
- `--ignore-scripts`를 사용하지 않는다.
- `npm_config_arch=x64`만 설정하는 방식은 사용하지 않는다. 실제 `node.exe`가 x64여야 한다.
- `.wrangler`를 삭제하면 로컬 D1 데이터도 사라질 수 있으므로 fresh DB가 꼭 필요한 경우에만 별도로 백업 후 삭제한다.

### 9.3 정적·단위·빌드 검증

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

한 번에 실행:

```powershell
npm run verify
```

성공 기준:

- ESLint error 0
- TypeScript error 0
- unit test 51개 이상 통과
- `vinext build` 성공
- `Unsupported platform: win32 arm64 LE`가 나타나지 않음

### 9.4 dev + smoke

터미널 A:

```powershell
$NodeX64Dir = 'C:\Users\jsmd0\Tools\node-v22.23.2-win-x64'
$env:Path = "$NodeX64Dir;$env:Path"
Set-Location 'C:\Users\jsmd0\Documents\WebMCP\return'

npm run dev
```

`http://localhost:3000`이 준비된 뒤 터미널 B:

```powershell
$NodeX64Dir = 'C:\Users\jsmd0\Tools\node-v22.23.2-win-x64'
$env:Path = "$NodeX64Dir;$env:Path"
Set-Location 'C:\Users\jsmd0\Documents\WebMCP\return'

node -p "process.arch"
npm run test:smoke -- http://localhost:3000
```

---

## 10. A1 검증 결과

| 검증 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| 정책/WebMCP unit test | 51/51 통과 |
| seed invariant | objects 8, evidence 8, injection 3, timeline 29, labels 8, submissions 3 확인 |
| migration chain | 0000→0001→0002 적용 성공 |
| 최종 migration tables | 9개 확인 |
| 최종 migration indexes | 9개 확인 |
| ARM64 native build | `workerd`가 win32-arm64를 지원하지 않아 실행 불가 |
| Node x64 build/smoke | x64 Node로 clean install 후 실행 필요 |

---

## 11. 현재 smoke 테스트에서 미리 수정할 항목

최종 approval 상태 모델은 편집 승인을 `approved_with_edit`로 저장한다.

현재 `return/scripts/smoke.mjs`의 다음 기대값은 예전 값이다.

```js
afterResolve.json?.status === 'approved'
```

최종 스키마/API 기준 기대값:

```js
afterResolve.json?.status === 'approved_with_edit'
```

이 항목은 A1 DB 이전 실패가 아니라 이후 approval 상태 모델이 변경되면서 smoke assertion이 뒤처진 것이다.

또한 현재 approval resolve는 아직 새 `label_publications` revision과 `objects.current_label_id` 변경을 수행하지 않는다. 따라서 **승인 후 public label 변경 검증은 A2 완료 후 추가**해야 한다.

---

## 12. 최종 판정

A1의 완료 기준은 다음과 같다.

- 유물·evidence·timeline·현재 label이 정적 상수가 아닌 D1에서 조회된다.
- 모든 조회가 session `museum_id`로 scope된다.
- fresh workspace가 독립된 전체 demo record를 갖는다.
- Moonbird Mask의 `c. 1930`, `1959–1968` 기록이 일관된다.
- restricted body가 공개/agent 응답에서 가려진다.
- sealed evidence가 agent 출력에서 완전히 제외된다.
- migration과 seed가 새 DB와 기존 개발 DB 모두에서 동작한다.

위 A1 데이터 기반은 구현되어 있다. 다음 단계인 A2가 이 기반 위에서 immutable `label_publications` revision을 추가하고 current label pointer를 교체해야 한다.
