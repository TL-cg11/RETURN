# RE:TURN Database Schema

RE:TURN은 Cloudflare D1(SQLite)과 Drizzle ORM을 사용한다. 이 문서는 팀 공통 스키마의 기준이며, 실제 정의는 `return/db/schema.ts`, 배포용 변경은 `return/drizzle/`의 SQL 마이그레이션을 따른다.

## 1. 최종 테이블 구성

업무 테이블은 총 9개다.

| 테이블 | 역할 |
|---|---|
| `museums` | 박물관 workspace의 루트 레코드 |
| `objects` | 소장품 공식 레코드와 현재 라벨 포인터 |
| `evidence` | 제출·검증된 사진, 문서, 구술 기록 등의 근거 |
| `provenance_events` | 소장품 이동·보관 이력과 명시적인 기록 공백 |
| `submissions` | 커뮤니티가 제출한 검토 요청 |
| `label_publications` | 수정하지 않는 공식 라벨 revision 이력 |
| `approvals` | 공식 변경 전 인간 승인을 기다리는 불변 snapshot |
| `escalations` | 정책상 거부된 요청을 큐레이터 검토로 넘긴 기록 |
| `activity` | 인간·에이전트·정책 게이트웨이의 감사 로그 |

`sqlite_stat1`은 SQLite가 쿼리 최적화에 사용하는 내부 통계 테이블이며 업무 스키마에 포함하지 않는다.

## 2. 관계 개요

```text
museums
  ├─ objects
  │    ├─ evidence
  │    ├─ provenance_events
  │    ├─ submissions
  │    ├─ label_publications
  │    ├─ approvals
  │    └─ escalations
  └─ activity

objects.current_label_id
  └─ label_publications.id

submissions.evidence_refs[]
provenance_events.evidence_refs[]
label_publications.evidence_refs[]
approvals.args_snapshot.evidence_refs[]
  └─ evidence.id
```

모든 tenant 소유 레코드는 `museum_id`로 scope한다. 현재 D1 스키마는 물리적 foreign key 대신 `(museum_id, id)` 조회와 서버 정책으로 tenant 경계를 강제한다.

## 3. 테이블 상세

### 3.1 `museums`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK | workspace ID |
| `name` | TEXT | NOT NULL | 박물관 표시 이름 |
| `created_at` | INTEGER | NOT NULL | Unix epoch milliseconds |

### 3.2 `objects`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | composite PK | workspace 내부 소장품 ID |
| `museum_id` | TEXT | composite PK, NOT NULL | tenant scope |
| `accession_number` | TEXT | NOT NULL | 등록 번호 |
| `title` | TEXT | NOT NULL | 소장품 이름 |
| `description` | TEXT | NOT NULL | 설명 |
| `origin` | TEXT | NOT NULL | 기록된 지역 |
| `period` | TEXT | NOT NULL | 제작 시기 |
| `object_type` | TEXT | NOT NULL | 소장품 종류 |
| `material` | TEXT | NOT NULL | 재료 |
| `acquisition_date` | TEXT | NULL | 취득일 또는 취득 시기 |
| `current_label_id` | TEXT | NULL | 현재 공개 중인 `label_publications.id` |
| `visibility` | TEXT | NOT NULL, default `public` | `public`, `restricted`, `sealed` |
| `provenance_completeness` | INTEGER | NOT NULL, default `0` | provenance 완성도 |
| `provenance_gap` | TEXT | NULL | 대표 기록 공백 |
| `record_status` | TEXT | NOT NULL | 레코드 검토 상태 |
| `display_tone` | TEXT | NOT NULL | UI 표시 tone |
| `questions` | TEXT | NOT NULL, JSON array | 공개 질문 목록 |
| `version` | INTEGER | NOT NULL, default `1` | 승인 무결성 검사용 버전 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `updated_at` | INTEGER | NOT NULL | 수정 시각 |

키와 인덱스:

- PK: `(museum_id, id)`
- UNIQUE: `(museum_id, accession_number)`
- INDEX: `(museum_id, visibility)`

### 3.3 `evidence`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | composite PK | evidence ID |
| `museum_id` | TEXT | composite PK, NOT NULL | tenant scope |
| `object_id` | TEXT | NOT NULL | 연결된 소장품 |
| `type` | TEXT | NOT NULL | 사진, 문서, 구술 기록 등의 유형 |
| `title` | TEXT | NOT NULL | 제목 |
| `body` | TEXT | NOT NULL | 자료 내용 또는 설명 |
| `source_name` | TEXT | NOT NULL | 출처 이름 |
| `source_relationship` | TEXT | NOT NULL | 출처와 자료의 관계 |
| `date_or_period` | TEXT | NOT NULL | 관련 날짜 또는 시기 |
| `place` | TEXT | NOT NULL | 관련 장소 |
| `authority` | TEXT | NOT NULL | `submitted` 또는 `verified` |
| `consent` | TEXT | NOT NULL | `private`, `public_anonymous`, `public_attributed` |
| `visibility` | TEXT | NOT NULL, default `public` | `public`, `restricted`, `sealed` |
| `submitted_by` | TEXT | NOT NULL | 제출자 |
| `verified_by` | TEXT | NULL | 검토한 큐레이터 |
| `verified_at` | INTEGER | NULL | 검토 시각 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `updated_at` | INTEGER | NOT NULL | 수정 시각 |

키와 인덱스:

- PK: `(museum_id, id)`
- INDEX: `(museum_id, object_id, visibility)`

### 3.4 `provenance_events`

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | composite PK | event ID |
| `museum_id` | TEXT | composite PK, NOT NULL | tenant scope |
| `object_id` | TEXT | NOT NULL | 연결된 소장품 |
| `start_date` | TEXT | NOT NULL | 시작 시기 |
| `end_date` | TEXT | NULL | 종료 시기 |
| `title` | TEXT | NOT NULL | event 제목 |
| `detail` | TEXT | NOT NULL | event 설명 |
| `custodian` | TEXT | NULL | 보관자 또는 소유 주체 |
| `location` | TEXT | NULL | 장소 |
| `status` | TEXT | NOT NULL | `claimed`, `verified`, `disputed`, `gap` |
| `authority` | TEXT | NOT NULL | `submitted` 또는 `verified` |
| `evidence_refs` | TEXT | NOT NULL, JSON array | 연결된 evidence ID 목록 |
| `is_gap` | INTEGER | NOT NULL, boolean | 명시적인 기록 공백 여부 |
| `sort_order` | INTEGER | NOT NULL | timeline 표시 순서 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `updated_at` | INTEGER | NOT NULL | 수정 시각 |

키와 인덱스:

- PK: `(museum_id, id)`
- INDEX: `(museum_id, object_id, sort_order)`

### 3.5 `submissions`

기존 UI/API 호환 컬럼을 유지하면서 contributor와 evidence 연결 정보를 확장한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK | submission ID |
| `museum_id` | TEXT | NOT NULL | tenant scope |
| `object_id` | TEXT | NOT NULL | 대상 소장품 |
| `kind` | TEXT | NOT NULL | Evidence 또는 Context claim 등 |
| `title` | TEXT | NOT NULL | 제출 제목 |
| `description` | TEXT | NOT NULL | 제출 내용 |
| `source` | TEXT | NOT NULL | 기존 API 호환 출처 필드 |
| `consent` | TEXT | NOT NULL | 공개·연구 사용 동의 |
| `requested_outcome` | TEXT | NOT NULL | 요청 결과이며 실행 권한은 아님 |
| `contributor_name` | TEXT | NULL | 제출자 이름 |
| `contributor_role` | TEXT | NULL | 제출자 역할 |
| `evidence_refs` | TEXT | NOT NULL, JSON array | 연결된 evidence ID 목록 |
| `status` | TEXT | NOT NULL, default `received` | 제출 처리 상태 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `updated_at` | INTEGER | NOT NULL | 수정 시각 |

키와 인덱스:

- PK: `id`
- INDEX: `(museum_id, status)`

### 3.6 `label_publications`

공식 라벨은 기존 행을 수정하지 않고 새 revision을 추가한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | composite PK | publication ID |
| `museum_id` | TEXT | composite PK, NOT NULL | tenant scope |
| `object_id` | TEXT | NOT NULL | 대상 소장품 |
| `title` | TEXT | NOT NULL | 라벨 제목 |
| `body` | TEXT | NOT NULL | 공개 라벨 본문 |
| `assertions` | TEXT | NOT NULL, JSON array | assertion mode와 evidence refs |
| `evidence_refs` | TEXT | NOT NULL, JSON array | 전체 evidence 참조 |
| `revision_number` | INTEGER | NOT NULL | 소장품별 revision 번호 |
| `approved_by` | TEXT | NOT NULL | 승인한 인간 큐레이터 |
| `published_at` | INTEGER | NOT NULL | 게시 시각 |
| `superseded_at` | INTEGER | NULL | 후속 revision으로 대체된 시각 |

키와 인덱스:

- PK: `(museum_id, id)`
- UNIQUE: `(museum_id, object_id, revision_number)`
- INDEX: `(museum_id, object_id, revision_number)`

### 3.7 `approvals`

HIGH 위험 작업은 즉시 실행하지 않고 불변 snapshot을 저장한 뒤 인간 승인을 기다린다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK | approval ID |
| `museum_id` | TEXT | NOT NULL | tenant scope |
| `object_id` | TEXT | NOT NULL | 대상 소장품 |
| `risk` | TEXT | NOT NULL | 일반적으로 `HIGH` |
| `snapshot` | TEXT | NOT NULL | 기존 UI 호환 draft body |
| `tool` | TEXT | NOT NULL | 요청을 만든 도구 |
| `args_snapshot` | TEXT | NOT NULL, JSON object | canonical args, assertions, evidence refs, object version |
| `snapshot_hash` | TEXT | NOT NULL | `args_snapshot`의 SHA-256 |
| `object_version` | INTEGER | NOT NULL | 요청 당시 object version |
| `justification` | TEXT | NOT NULL | 변경 근거 |
| `refs_authority` | TEXT | NOT NULL, JSON array | 참조 evidence authority snapshot |
| `refs_consent` | TEXT | NOT NULL, JSON array | 참조 evidence consent snapshot |
| `status` | TEXT | NOT NULL, default `pending` | `pending`, `approved`, `approved_with_edit`, `rejected`, `expired` |
| `resolution` | TEXT | NULL | 최종 처리 결과 |
| `verdict` | TEXT | NULL | 인간의 결정 |
| `edited_body` | TEXT | NULL | approve-with-edit 본문 |
| `edit_reason` | TEXT | NULL | 인간 편집 이유 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `expires_at` | INTEGER | NOT NULL | 승인 만료 시각 |
| `resolved_at` | INTEGER | NULL | 처리 시각 |

키와 인덱스:

- PK: `id`
- INDEX: `(museum_id, status)`
- 기본 TTL: 생성 후 24시간

### 3.8 `escalations`

정책 게이트웨이가 공식 행동을 거부하더라도 작업을 dead end로 만들지 않고 큐레이터 검토로 넘긴다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK | escalation ID |
| `museum_id` | TEXT | NOT NULL | tenant scope |
| `object_id` | TEXT | NULL | 대상 소장품 |
| `tool` | TEXT | NOT NULL | 거부된 도구 |
| `args` | TEXT | NOT NULL, JSON object | 거부된 요청 인자 |
| `policy` | TEXT | NOT NULL | 거부 정책 코드 |
| `source_refs` | TEXT | NOT NULL, JSON array | 관련 evidence 또는 record refs |
| `status` | TEXT | NOT NULL, default `open` | escalation 처리 상태 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `resolved_at` | INTEGER | NULL | 처리 시각 |

키와 인덱스:

- PK: `id`
- INDEX: `(museum_id, status, created_at)`

### 3.9 `activity`

기존 사용자용 피드 필드와 구조화된 감사 필드를 함께 저장한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK | activity ID |
| `museum_id` | TEXT | NOT NULL | tenant scope |
| `actor` | TEXT | NOT NULL | 화면에 표시할 참여자 이름 |
| `action` | TEXT | NOT NULL | 화면에 표시할 행동 |
| `detail` | TEXT | NOT NULL | 화면에 표시할 상세 내용 |
| `created_at` | INTEGER | NOT NULL | 생성 시각 |
| `actor_role` | TEXT | NOT NULL | `community`, `curator`, `curator_ui`, `system` |
| `actor_type` | TEXT | NOT NULL | `agent`, `human`, `system` |
| `tool` | TEXT | NOT NULL | 실행된 도구 또는 시스템 작업 |
| `target` | TEXT | NOT NULL | object, submission, approval 등의 대상 ID |
| `risk` | TEXT | NOT NULL | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `policy_decision` | TEXT | NOT NULL | `applied`, `pending_approval`, `denied`, `invalid` |
| `result` | TEXT | NOT NULL | 생성된 ID 또는 정책 결과 코드 |

키와 인덱스:

- PK: `id`
- INDEX: `(museum_id, created_at)`

## 4. JSON 저장 필드

D1에서는 배열과 구조화 snapshot을 JSON 문자열로 저장한다.

| 필드 | JSON 형태 |
|---|---|
| `objects.questions` | `string[]` |
| `submissions.evidence_refs` | `string[]` |
| `provenance_events.evidence_refs` | `string[]` |
| `label_publications.assertions` | `{ text, mode, refs[] }[]` |
| `label_publications.evidence_refs` | `string[]` |
| `approvals.args_snapshot` | canonical approval snapshot object |
| `approvals.refs_authority` | `("submitted" | "verified")[]` |
| `approvals.refs_consent` | consent value array |
| `escalations.args` | rejected request object |
| `escalations.source_refs` | `string[]` |

## 5. 핵심 불변식

1. 모든 tenant 소유 쿼리는 session의 `museum_id`로 scope한다.
2. community actor는 evidence authority를 `verified`로 만들 수 없다.
3. authority는 `submitted`와 `verified` 두 단계만 사용한다.
4. 공개 assertion은 evidence ref를 최소 하나 가진다.
5. `verified_fact`는 verified evidence를 최소 하나 참조한다.
6. consent가 허용하지 않는 evidence body는 공개 API에 포함하지 않는다.
7. `sealed` evidence는 agent output에서 존재 자체를 노출하지 않는다.
8. 공식 라벨은 기존 publication을 수정하지 않고 새 revision을 생성한다.
9. approval은 `args_snapshot`, evidence 상태, object version을 저장하고 실행 직전에 다시 검증한다.
10. 만료되거나 이미 처리된 approval은 재사용하지 않는다.
11. evidence 삭제와 실제 소장품 반환은 agent tool로 제공하지 않는다.
12. 실제 반환 상태는 object에 저장하지 않고 인간 review 절차로만 다룬다.
13. 자산은 `restricted` · `private` 로 생성되며, 큐레이터가 열기 전에는 어떤 경로로도 공개되지 않는다.
14. `visibility` 가 `public` 이어도 **consent 가 공개를 허용하지 않으면** 자산은 공개 표시되지 않는다. 두 게이트는 독립이다.
14a. consent 판정은 **허가의 존재**로 한다 — `public_anonymous` · `public_attributed` 두 값을 지목하며, `!== 'private'` 로 쓰지 않는다. 정의되지 않은 값은 공개를 허용하지 않는 값으로 읽는다 (MCP-E2).
14b. 기여 생성 경로는 정의되지 않은 consent 값을 **저장하지도, 조용히 다른 값으로 바꾸지도 않는다.** 값이 없으면 `private`, 정의되지 않은 값이면 `invalid` 로 거부한다 (MCP-E1).
15. `sealed` 자산은 존재 자체를 숨긴다. 공개 경로는 403이 아니라 404로 답한다.
16. 공개 유물 페이지는 `consent IN ('public_attributed','public_anonymous')` 인 기여만 조회한다. 렌더링이 아니라 SQL 에서 거른다.
17. `public_anonymous` 기여는 본문은 공개하되 기여자 이름을 표기하지 않는다.
18. 새 유물은 `objects` 와 revision 1 `label_publications` 를 한 트랜잭션으로 만든다. 라벨 없는 유물은 존재하지 않는다.
19. `objects.id` 와 `accession_number` 는 워크스페이스 안에서 유일하다. 충돌하면 등록을 거부한다.
20. 큐레이터의 질문은 `submissions.clarifications` 에 목록으로 남는다. 활동 로그가 아니라 여기가 기여자에게 보이는 원본이다.
21. 모든 유물은 verified evidence 를 최소 1건 보유한다. 게이트웨이가 공식 변경에 verified 인용을 요구하므로, 이것이 없는 유물은 어떤 라벨 개정도 승인 큐에 도달할 수 없다 (MCP-E6).
21. 자산 요청의 `?download=1` 은 `content-disposition` 만 바꾼다. 접근 판정은 동일하다.

### 5.1 `assets` — 기여·기록 자산

바이트는 R2 에 `storage_key` 로 저장하고, 누가 읽을 수 있는지는 오직 이 행이 정한다.
도구는 바이너리를 받지 않는다 (`RETURN_PLAN.md` §15.1). 업로드 전용 라우트가 먼저
`assets` 행을 만들고, 도구는 `asset_ids` 만 수신한다.

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | TEXT | PK(museum_id,id) | `AST-` 접두 |
| `museum_id` | TEXT | NOT NULL | 워크스페이스. `storage_key` 접두사에도 포함된다 |
| `object_id` | TEXT | NULL 허용 | 유물에 직접 붙은 자산 |
| `submission_id` | TEXT | NULL 허용 | 기여에 붙은 자산 |
| `evidence_id` | TEXT | NULL 허용 | evidence 로 승격된 뒤의 연결 |
| `kind` | TEXT | NOT NULL | `image`, `document`, `audio` |
| `content_type` | TEXT | NOT NULL | 허용 목록으로 검증된 media type |
| `storage_key` | TEXT | NOT NULL | R2 객체 키 |
| `file_name` | TEXT | NOT NULL | 원본 파일명 |
| `alt_text` | TEXT | NOT NULL, 기본 `''` | 접근성 대체 텍스트 |
| `caption` | TEXT | NOT NULL, 기본 `''` | 표시용 설명 |
| `visibility` | TEXT | NOT NULL, 기본 `restricted` | `public`, `restricted`, `sealed` |
| `consent` | TEXT | NOT NULL, 기본 `private` | `private`, `public_anonymous`, `public_attributed` |
| `byte_size` | INTEGER | NOT NULL | 상한 8 MB |
| `width` / `height` | INTEGER | NULL 허용 | 알려진 경우의 원본 해상도 |
| `sort_order` | INTEGER | NOT NULL, 기본 0 | 캐러셀 순서 |
| `uploaded_by` | TEXT | NOT NULL | 업로드 주체 |

허용 media type 은 `image/jpeg`, `image/png`, `image/webp`, `image/gif`,
`application/pdf`, `audio/mpeg`, `audio/wav`, `audio/mp4` 뿐이다.
`image/svg+xml` 은 의도적으로 제외한다 — 스크립트를 담는 마크업이고 자산은
애플리케이션 origin 에서 제공되기 때문이다.

## 6. 마이그레이션 순서

| 파일 | 내용 |
|---|---|
| `0000_return_foundation.sql` | `museums`, `submissions`, `approvals`, `activity` 기초 생성 |
| `0001_domain_records.sql` | `objects`, `evidence`, `provenance_events`, `label_publications` 생성 |
| `0002_governance_audit.sql` | `escalations` 생성, submissions/approvals/activity 확장 및 기존 행 backfill |
| `0003_consent_three_levels.sql` | `research_only` 를 `private` 으로 이관 (FR-X1) |
| `0004_assets.sql` | `assets` 생성 — 기여·기록 자산 (FR-D1·FR-D2) |
| `0005_contribution_detail.sql` | `submissions.details` · `submissions.asset_ids` 추가 — 종류별 입력과 첨부 (FR-C1·C3·C4) |
| `0006_clarifications.sql` | `submissions.clarifications` 추가 — 큐레이터 질문 이력 (FR2-K1) |

Cloudflare D1에 수동 적용할 경우 반드시 번호 순서대로 한 번씩만 실행한다. 코드의 `ensureDatabase()`는 기존 개발·배포 DB에서 누락된 테이블과 컬럼을 보정하는 호환 경로이며, SQL 마이그레이션이 배포 스키마의 기준이다.

## 7. 이번 MVP에서 만들지 않는 테이블

다음 개념은 전체 제품 계획에 등장하지만 최신 데모 분담 범위에서는 별도 테이블로 만들지 않는다.

| 개념 | 현재 처리 |
|---|---|
| `Claim` | `submissions.kind = 'Context claim'`으로 표현 |
| `LabelDraft` | 승인 전 draft와 snapshot 흐름으로 임시 처리 |
| `ReviewCase` | submission ID를 case ID로 사용 |

별도 생명주기, 검색, 권한 또는 장기 보존 요구가 생길 때 후속 마이그레이션으로 분리한다.

## 8. 팀 공통 스키마 파일

스키마 변경을 메인 브랜치에 공유할 때 다음 파일을 하나의 단위로 취급한다.

```text
return/db/schema.ts
return/db/setup.ts
return/db/seed-data.ts
return/lib/domain/types.ts
return/drizzle/0001_domain_records.sql
return/drizzle/0002_governance_audit.sql
SCHEMA.md
```
