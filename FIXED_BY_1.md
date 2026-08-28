# RE:TURN — 커뮤니티(user) 화면 6건 수정 요청

## 컨텍스트
- 저장소: `C:\Users\jsmd0\Documents\WebMCP`, 앱 루트: `return/` (Next.js App Router on vinext + Cloudflare D1/R2, 기본 서버 컴포넌트)
- 현재 브랜치: `feat/test-track2-policy-realtime`
- 실행: `cd return && npm run dev` (localhost:3000). 검증: `npm run verify` (lint/typecheck/unit/build), `npm run test:smoke -- http://localhost:3000`
- 아래 "원인 후보"는 내가 코드를 읽고 추정한 힌트다. **그대로 믿지 말고 반드시 직접 재현한 뒤 근본 원인을 고쳐라.** 증상만 가리는 임시방편(무조건 reload, setInterval 강제 새로고침 등) 금지.
- 절대 지켜야 할 제약:
  - 정책 게이트웨이(`lib/policy/`), consent/visibility 규칙(`lib/assets/access.ts`), 큐레이터 승인 경로를 우회하거나 약화시키지 말 것. 공개 페이지는 항상 community 세션 기준으로 판단되어야 한다.
  - 커뮤니티 기여물은 기관 공식 기록(공식 라벨/프로버넌스 타임라인) **안으로 병합하지 말 것**. 항상 "submitted, not verified"로 구분되어 옆에 표시된다는 기존 원칙 유지.
  - `components/shared/nav-link.tsx`의 주석대로 vinext의 `next/link`가 깨져 있어 모든 링크가 순수 `<a>`(전체 페이지 로드)다. 이 사실을 전제로 설계할 것.
  - 기존 테스트/공개 시그니처 유지. 요청되지 않은 리팩터링·문서 추가 금지.

---

## 1. 큐레이터가 승인해도 커뮤니티(user) 페이지에 반영되지 않음
**증상**: 큐레이터 콘솔에서 라벨 승인(approve / approve_with_edit)을 해도 `/objects/[id]` 공개 페이지에 새 라벨/리비전이 나타나지 않는다.

**원인 후보 (검증 필요)**
- 서버 쓰기 자체는 되는 것으로 보임: `app/api/curator/approvals/[id]/resolve/route.ts`가 `label_publications` 삽입 + `objects.current_label_id/version` 갱신을 배치로 수행.
- 실시간 반영은 `components/shared/community-header.tsx` → `lib/live/use-live-record.ts`가 revision 토큰 변화 시 `router.refresh()`를 호출하는 구조인데, vinext에서 `next/link`가 깨진 것과 같은 계열로 **`router.refresh()`가 서버 컴포넌트를 다시 렌더하지 않을 가능성**이 크다.
- 또 하나 확인할 것: 승인 시 이미지/에셋 공개(`app/api/curator/assets/[id]/publish/route.ts` → `setAssetVisibility`) 결과가 공개 갤러리에 반영되는지.

**요구**
- 승인 직후(스트림 `/api/events` 또는 폴백 `/api/events/poll`의 revision 변화 시점) 공개 페이지가 **수동 새로고침 없이** 갱신될 것.
- `router.refresh()`가 이 런타임에서 동작하지 않는다면, revision 토큰이 실제로 바뀐 경우에만 1회 재로드하는 방식 등으로 대체하되 **무한 새로고침 루프가 절대 생기지 않게** 할 것(첫 sync에서는 새로고침하지 않는 기존 `apply()` 규칙 유지).
- 사용자가 입력 중이거나 스크롤 중일 때 갑작스럽게 화면이 튀지 않도록(3번·6번 항목과 충돌하지 않게) 처리.

**완료 조건**: 브라우저 두 개(커뮤니티 `/objects/moonbird-mask`, 큐레이터 콘솔)를 띄우고 승인하면 커뮤니티 쪽 라벨 본문·리비전 번호·`Last reviewed` 날짜가 몇 초 내 자동 갱신된다. 승인 없이 대기 중일 때는 페이지가 재로드되지 않는다.

---

## 2. 메인 페이지 collection 페이지네이션의 스크롤 튐
**증상**: `/` 하단 collection 섹션에서 페이지 번호(`←/1/2/Next`)를 누르면 화면이 최상단으로 갔다가 다시 아래로 점프한다.

**원인**: `app/page.tsx`의 pager가 `/?page=N#collection` 링크 + `NavLink`(순수 `<a>`) → 전체 페이지 로드 후 앵커 점프. 서버 페이지네이션 자체는 `app/page.tsx:11` `PER_PAGE = 6` 기준.

**요구**
- 페이지를 바꿔도 **스크롤 위치가 그대로 유지된 채 목록 내용만 교체**될 것. 상단으로 갔다 내려오는 깜빡임 없음.
- URL의 `?page=` 상태는 계속 유지(뒤로가기/새로고침/공유 시 같은 페이지가 보여야 함). 클라이언트 처리로 바꾼다면 `history.pushState`/`replaceState`로 동기화.
- 접근성 유지: `aria-current="page"`, disabled 처리, `Showing X–Y of N objects` 카운트 문구, 키보드 포커스가 목록으로 자연스럽게 이어질 것.
- 자바스크립트가 꺼진 환경에서도 링크가 동작하는 형태(progressive enhancement)를 우선 고려.

**완료 조건**: 페이지 하단까지 스크롤한 상태에서 2페이지를 눌러도 뷰포트가 움직이지 않고 목록만 바뀐다.

---

## 3. 사진과 글이 따로 놀고, 추가된 정보가 기존 정보와 구분되지 않음
**증상**: `/objects/[id]`에서 사진은 상단 갤러리(`ObjectGallery`), 기여 텍스트는 한참 아래 `Community contributions` 섹션에 분리되어 있다. 기여로 정보가 추가되어도 사용자는 **무엇이 원래 기록이고 무엇이 나중에 추가된 것인지** 구분할 수 없다.

**요구**
- **어떤 정보가 contribute로 추가되었는지 명시하는 섹션**을 추가/개편할 것.
  - 기여로 들어온 사진과 그 사진에 딸린 텍스트(제목/설명/kind별 detail/제공자 표기)를 **같은 카드 안에서 함께** 보여줄 것. 지금처럼 사진 따로, 글 따로 두지 말 것.
  - 갤러리 이미지 각각에도 출처 배지 표시: 기관 원본인지 / 커뮤니티 기여물인지, 그리고 언제 추가되었는지.
  - 공식 기록(라벨·프로버넌스 타임라인) 영역과 시각적으로 확실히 분리하고, 기여물은 `Submitted content · not verified` 성격을 유지.
- 라벨이 개정된 경우 **무엇이 바뀌었는지** 사용자가 볼 수 있게 할 것. `lib/label-diff.ts`의 `diffLabelText`가 이미 있으니 이전 리비전 대비 추가/삭제 구간을 표시하는 데 사용.
  - 이를 위해 `db/queries.ts`에 객체별 `label_publications` 이력 조회 함수(예: `listLabelPublications(museumId, objectId)`)를 추가해야 할 수 있음. 스키마는 `SCHEMA.md` 참고.
- consent 규칙 유지: `public_attributed`만 제공자 이름 표기, `public_anonymous`는 익명, `private`는 노출 금지. 이미지 노출은 반드시 `assetAccess` 통과분만.
- 기존 목록 상한(`MAX_SHOWN_CONTRIBUTIONS = 8`)과 "N개 중 최근 M개" 안내 문구 규칙 유지.

**완료 조건**: 기여를 제출하고 큐레이터가 반영한 뒤 공개 페이지를 보면, (a) 어떤 항목이 커뮤니티 기여로 추가되었는지, (b) 그 기여에 딸린 사진과 글이 무엇인지, (c) 공식 라벨의 어떤 문장이 이번 개정으로 바뀌었는지가 한 화면 흐름에서 읽힌다.

---

## 4. contribute가 반영되어도 사용자가 알 수 있는 게 없음
**증상**: 기여가 라벨에 반영되어도 기여자 입장에서 아무 피드백이 없다.

**확인된 근본 원인 (실제 코드 확인함)**
- `db/queries.ts:59` `SUBMISSION_STATUSES`에 `'reflected in label'`이 정의되어 있고, `app/submissions/[id]/page.tsx:21,67`이 그 값을 기다리고 있는데 — **코드 어디에서도 submission 상태를 `'reflected in label'`로 설정하지 않는다.** 즉 진행 단계 4단계가 절대 마지막 단계에 도달하지 못한다.

**요구**
- 라벨 승인/게시가 성공했을 때, 그 승인의 근거 evidence에 연결된 submission(들)의 상태를 `'reflected in label'`로 갱신할 것. 승인 트랜잭션의 성공 여부와 일관되게(부분 성공으로 상태만 바뀌는 일 없게) 처리.
- 기여자 상태 페이지 `/submissions/[id]`에서 반영 결과를 명확히 보여줄 것: 어떤 객체의 몇 번 리비전에 반영되었는지, 바뀐 라벨 문구(3번의 diff 재사용), 해당 객체 페이지로 가는 링크.
- 이 페이지도 실시간 갱신 대상에 포함(1번 수정과 동일 메커니즘). 기여자가 상태 페이지를 열어둔 채 큐레이터가 승인하면 자동으로 단계가 진행되어야 한다.
- 거절(rejected)이나 `needs information` 경우에도 사용자가 결과를 알 수 있게 문구가 명확할 것(없는 결과를 지어내지 말고 실제 상태만 표시).

**완료 조건**: 기여 제출 → 큐레이터 승인 → 기여자의 `/submissions/[id]`가 자동으로 "Outcome shared with you" 단계까지 진행되고 반영된 리비전과 변경 내용이 보인다.

---

## 5. 이미지 해상도/비율 대응 (사진 섹션)
**증상**: 작은 사진이나 아주 큰 사진을 올리면 사진 섹션에서 보기가 나쁘다.

**현재 상태**
- `app/globals.css:361-363`: `.gallery-frame`이 고정 `aspect-ratio:4/5`, `img`는 `object-fit:contain`.
- `assets` 테이블에 `width`/`height` 컬럼이 있으나 `app/api/assets/route.ts:56`에서 **항상 `null`로 저장**되고 있어 서버가 원본 비율을 모른다.

**요구**
- **비율은 항상 유지**(왜곡 금지, crop 금지 — 기존 "contain, never cover" 원칙 유지).
- 원본 비율이 프레임 비율과 다르면 **상하 또는 좌우에 레터박스**를 두되, 사진이 프레임 안에서 **가능한 한 크게** 표시되도록 할 것.
- 작은 원본을 과도하게 확대해 흐릿해지지 않도록 처리(원본 픽셀 크기 이상으로 늘리지 않거나, 프레임 높이를 원본 비율에 맞춰 조정하는 방식 등 — 판단해서 구현하고 이유를 주석에 남길 것).
- 원본 크기를 알기 위해 업로드 시 이미지의 width/height를 실제로 저장하거나, 클라이언트에서 `naturalWidth/naturalHeight`로 판단할 것. 저장 경로를 바꾸면 기존 데이터(널값)에서도 깨지지 않게 폴백 유지.
- 세로로 긴 사진, 가로로 긴 파노라마, 200px급 작은 사진 세 가지 케이스에서 모두 레이아웃이 무너지지 않을 것. 좁은 화면(`globals.css` 기존 브레이크포인트)도 확인.

---

## 6. 돋보기가 사진 밖으로 나가면 가운데로 튐
**증상**: 돋보기(Magnify)를 켠 상태에서 마우스가 사진 영역 밖으로 나가면 렌즈가 사진 정중앙으로 이동한다.

**원인 (확인됨)**: `components/community/object-gallery.tsx`의 프레임 요소에 `onMouseLeave={() => zooming && setLens({ x: 0.5, y: 0.5 })}` — 이탈 시 강제로 중앙 복귀.

**요구**
- 포인터가 프레임을 벗어나면 렌즈가 **중앙으로 점프하지 말 것**. 마지막 위치를 유지하거나 렌즈를 자연스럽게 감추는 방식 중 더 나은 쪽으로 구현(선택 이유를 주석으로).
- 포인터가 다시 들어오면 그 지점에서 즉시 이어질 것.
- 기존 키보드 접근성 유지: 토글 시 중앙에서 시작, 화살표 키 이동(`LENS_STEP`), `Escape`로 닫기, `aria-pressed`/`aria-label` 유지. 사진을 넘기면(`step`, dots) 렌즈 상태 초기화되는 기존 동작 유지.

---

## 마무리 요구사항
1. 각 항목을 **실제로 브라우저에서 재현 → 수정 → 재확인**할 것. 확인하지 못한 항목은 추측으로 "고쳤다"고 보고하지 말고 무엇이 확인되지 않았는지 명시.
2. `cd return && npm run verify` 통과, 그리고 dev 서버를 띄운 상태에서 `npm run test:smoke -- http://localhost:3000` 통과. 실패하면 실패 내용을 그대로 보고.
3. 커밋은 항목 단위로 나누고, 각 커밋 메시지에 어떤 증상을 어떤 원인으로 고쳤는지 한 줄로 남길 것.
4. 최종 보고에는 항목별로 (원인 / 수정한 파일 / 검증 방법)을 적을 것.
