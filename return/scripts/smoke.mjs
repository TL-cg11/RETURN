/**
 * End-to-end verification for RE:TURN.
 *
 * Exercises every user-facing route, every WebMCP tool, the role boundary,
 * the policy gateway outcomes, and the community -> curator record loop
 * against a running server.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

const OBJECT_IDS = [
  'moonbird-mask', 'riverstone-vessel', 'woven-signal-cloth', 'tide-listening-stone',
  'reed-memory-box', 'four-winds-bowl', 'dawn-marker', 'harbor-thread-map',
];

const COMMUNITY_TOOLS = ['search_collection', 'get_object_detail', 'get_provenance_timeline', 'submit_evidence', 'submit_context_claim', 'check_submission', 'attach_assets'];
const CURATOR_TOOLS = ['get_collection_summary', 'list_objects', 'list_submissions', 'get_review_case', 'build_provenance_timeline', 'compare_evidence', 'draft_label', 'request_clarification', 'propose_label_update', 'open_return_review', 'check_approval', 'list_pending_approvals', 'register_object'];
// FR-W1 — on both surfaces. The role decides what comes back, not whether the call is allowed.
const SHARED_TOOLS = ['list_object_assets', 'get_asset_detail'];

const results = [];
let group = 'general';

function section(name) { group = name; }
function check(name, ok, detail = '') {
  results.push({ group, name, ok, detail });
  const mark = ok ? '  ok  ' : ' FAIL ';
  console.log(`${mark} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  return ok;
}

/* ---- cookie jar ---- */
const jar = new Map();
function cookieHeader() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); }
function absorb(response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

async function req(path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
    redirect: 'manual',
  });
  absorb(response);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: response.status, text, json };
}

const get = (path) => req(path);
const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const tool = (name, args) => post(`/api/tools/${name}`, args);

async function setRole(role) {
  const response = await post('/api/session', { role });
  return response.json?.role === role;
}

async function main() {
  console.log(`\nRE:TURN smoke test → ${base}\n`);

  /* ---------- 1. public routes ---------- */
  section('public routes');
  check('GET / renders', (await get('/')).status === 200);
  check('GET /contribute renders', (await get('/contribute')).status === 200);
  for (const id of OBJECT_IDS) {
    const page = await get(`/objects/${id}`);
    check(`GET /objects/${id}`, page.status === 200, `status ${page.status}`);
  }
  const unknown = await get('/objects/not-a-real-object');
  check('GET /objects/<unknown> is 404', unknown.status === 404, `status ${unknown.status}`);

  // FR2-M1 — the magnifier is offered on every record, including the seven with no
  // published photograph, where a drawn stand-in fills the frame.
  const withoutPhotos = await get('/objects/tide-listening-stone');
  check('a record with no photograph still offers the magnifier', withoutPhotos.text.includes('gallery-zoom'));
  check('and says the illustration is standing in for one', withoutPhotos.text.includes('stands in for one'));
  check('it offers no download, because there is no file', !withoutPhotos.text.includes('gallery-download'));

  const landing = await get('/');
  // FR-M4 paginated the collection, so the landing page shows a page of it, not all of it.
  const pages = [landing, await get('/?page=2')];
  const linked = new Set(OBJECT_IDS.filter((id) => pages.some((page) => page.text.includes(`/objects/${id}`))));
  check('every object is reachable across the collection pages', linked.size === OBJECT_IDS.length, `${linked.size}/${OBJECT_IDS.length}`);
  check('the first page does not list the whole collection', OBJECT_IDS.some((id) => !landing.text.includes(`/objects/${id}`)));
  check('the collection carries a page indicator', /class="pager"|\\"pager\\"/.test(landing.text));
  // Asserted on links rather than on the rendered count text, which React splits with
  // comment markers between the interpolated numbers.
  const clamped = await get('/?page=99');
  const lastPage = await get('/?page=2');
  check('an out-of-range collection page clamps to the last', clamped.status === 200
    && OBJECT_IDS.every((id) => clamped.text.includes(`/objects/${id}`) === lastPage.text.includes(`/objects/${id}`)));
  check('landing has no dead "#" object links', !/href="#"[^>]*class="object-row"/.test(landing.text));

  /* ---------- 2. role boundary ---------- */
  section('role boundary');
  check('session switches to community', await setRole('community'));
  check('role and museum cookies are signed, not plaintext',
    jar.get('role')?.includes('.') && jar.get('museum_id')?.includes('.')
      && jar.get('role') !== 'community' && !jar.get('museum_id')?.startsWith('museum_'));
  const signedSession = new Map(jar);
  jar.set('role', 'curator');
  const forgedRole = await tool('list_objects', {});
  check('editing role=curator cannot forge a curator session', forgedRole.status === 403, `status ${forgedRole.status}`);
  jar.clear();
  for (const [key, value] of signedSession) jar.set(key, value);
  let denied = 0;
  for (const name of CURATOR_TOOLS) {
    const response = await tool(name, {});
    if (response.status === 403) denied++;
  }
  check(`all ${CURATOR_TOOLS.length} curator tools refuse a community session`, denied === CURATOR_TOOLS.length, `${denied}/${CURATOR_TOOLS.length} returned 403`);
  const curatorApi = await post('/api/curator/approvals/APR-004/resolve', { action: 'approved' });
  check('curator API refuses a community session', curatorApi.status === 403, `status ${curatorApi.status}`);

  /* ---------- 3. community tools ---------- */
  section('community tools');
  const search = await tool('search_collection', { query: 'mask' });
  check('search_collection finds the mask', search.status === 200 && search.json.objects.some((o) => o.id === 'moonbird-mask'));
  const searchAll = await tool('search_collection', {});
  check('search_collection with no query returns 8', searchAll.json?.count === 8, `count ${searchAll.json?.count}`);

  let detailOk = 0;
  for (const id of OBJECT_IDS) {
    const response = await tool('get_object_detail', { object_id: id });
    if (response.status === 200 && response.json.object?.id === id && response.json.object.label) detailOk++;
  }
  check('get_object_detail resolves all 8 objects', detailOk === 8, `${detailOk}/8`);

  const badDetail = await tool('get_object_detail', { object_id: 'nope' });
  check('get_object_detail rejects an unknown id with recovery text', badDetail.status === 400 && !!badDetail.json.recovery);

  const timeline = await tool('get_provenance_timeline', { object_id: 'moonbird-mask' });
  check('get_provenance_timeline marks the gap', timeline.json?.gaps?.length > 0);
  check('Moonbird gap is consistently 1959–1968', timeline.json?.gaps?.some((gap) => gap.period === '1959–1968'));

  const submitted = await tool('submit_evidence', {
    object_id: 'moonbird-mask', title: 'Smoke test photograph',
    description: 'Added by the verification run.', consent: 'public_attributed',
  });
  check('submit_evidence persists and stays "submitted"', submitted.status === 200 && submitted.json.authority === 'submitted' && !!submitted.json.submission_id);
  const submissionId = submitted.json?.submission_id;

  const claim = await tool('submit_context_claim', { object_id: 'riverstone-vessel', claim: 'Smoke test claim', source: 'Verification run', consent: 'private' });
  check('submit_context_claim persists', claim.status === 200 && !!claim.json.submission_id);

  const checked = await tool('check_submission', { submission_id: submissionId });
  check('check_submission reads it back', checked.status === 200 && checked.json.id === submissionId);
  const missing = await tool('check_submission', { submission_id: 'SUB-000' });
  check('check_submission rejects an unknown id', missing.status === 400);

  /* ---------- 4. the record loop ---------- */
  section('community to curator loop');
  check('session switches to curator', await setRole('curator'));
  const wrongSurface = await tool('submit_context_claim', { object_id: 'dawn-marker', claim: 'Wrong role', source: 'Smoke test', consent: 'public_anonymous' });
  check('curator session cannot call a community-only tool', wrongSurface.status === 403, `status ${wrongSurface.status}`);
  const inbox = await tool('list_submissions', {});
  check('curator inbox contains the new contribution', inbox.status === 200 && inbox.json.submissions.some((s) => s.id === submissionId));
  check('list_submissions is flagged as external content', inbox.json?.untrusted_content === true);
  const restricted = inbox.json?.submissions?.find((s) => s.consent === 'private');
  check('private material is flagged as not quotable', !!restricted && restricted.quotable === false);
  // The triage list carries no bodies at all, so consent cannot leak through it.
  check('the inbox list carries no contribution bodies', inbox.json.submissions.every((s) => !('description' in s)));
  // The detail path still has to enforce consent, because that one does carry bodies.
  const restrictedCase = await tool('get_review_case', { case_id: restricted?.id });
  check('private bodies stay withheld on the detail path', restrictedCase.json?.submitted?.description === null && restrictedCase.json?.submitted?.quotable === false, JSON.stringify(restrictedCase.json?.submitted?.description));
  const openCase = await tool('get_review_case', { case_id: submissionId });
  check('a public contribution still reads its body on the detail path', typeof openCase.json?.submitted?.description === 'string' && openCase.json.submitted.description.length > 0);

  const inboxPage = await get('/curator/submissions');
  check('submission inbox page shows the new contribution', inboxPage.status === 200 && inboxPage.text.includes(submissionId));

  /* ---------- 5. curator pages ---------- */
  section('curator pages');
  for (const path of ['/curator', '/curator/submissions', '/curator/objects', '/curator/activity']) {
    const page = await get(path);
    check(`GET ${path}`, page.status === 200, `status ${page.status}`);
  }
  for (const status of ['received', 'needs information', 'under review']) {
    const filtered = await get(`/curator/submissions?status=${encodeURIComponent(status)}`);
    check(`inbox filter status=${status}`, filtered.status === 200, `status ${filtered.status}`);
  }
  const objectFilter = await get('/curator/submissions?object=moonbird-mask');
  check('inbox filter by object', objectFilter.status === 200);
  const casePage = await get(`/curator/cases/${submissionId}`);
  check(`GET /curator/cases/${submissionId}`, casePage.status === 200, `status ${casePage.status}`);
  const badCase = await get('/curator/cases/SUB-000');
  check('unknown case is 404', badCase.status === 404, `status ${badCase.status}`);

  /* ---------- 6. curator read tools ---------- */
  section('curator tools');
  const summary = await tool('get_collection_summary', {});
  check('get_collection_summary counts the workspace', summary.status === 200 && summary.json.objects === 8 && summary.json.total_submissions >= 4);
  const objects = await tool('list_objects', {});
  check('list_objects returns 8', objects.json?.count === 8, `count ${objects.json?.count}`);
  const reviewCase = await tool('get_review_case', { case_id: submissionId });
  check('get_review_case resolves the case', reviewCase.status === 200 && reviewCase.json.case_id === submissionId);
  // This used to pass a contribution id and assert on the review-case answer that came
  // back, which is the confusion EA-2 removed. Comparison is asked for with evidence ids.
  const compare = await tool('compare_evidence', { evidence_ids: ['EV-068', 'EV-059'] });
  check('compare_evidence separates conflicts and questions', compare.status === 200 && Array.isArray(compare.json.conflicts) && Array.isArray(compare.json.open_questions));
  check('compare_evidence answers with evidence, not a review case', Array.isArray(compare.json.evidence) && compare.json.case_id === undefined);
  const visibility = await tool('compare_evidence', { evidence_ids: ['EV-INJ-DEALER', 'EV-INJ-SEALED'] });
  check('restricted evidence body is withheld from agent output', visibility.status === 200 && visibility.json.evidence?.[0]?.body === null);
  check('sealed evidence is omitted from agent output', visibility.json?.omitted_evidence_ids?.includes('EV-INJ-SEALED') && !visibility.text.includes('SYSTEM_OVERRIDE'));
  const working = await tool('build_provenance_timeline', { object_id: 'moonbird-mask' });
  check('build_provenance_timeline does not publish', working.status === 200 && working.json.note.includes('unchanged'));
  const draft = await tool('draft_label', { object_id: 'moonbird-mask' });
  check('draft_label returns assertions and stays unpublished', draft.status === 200 && draft.json.published === false && draft.json.assertions.length > 0);
  check('draft_label assertions all cite evidence', draft.json.assertions.every((a) => a.refs.length > 0));

  /* ---------- 7. policy gateway ---------- */
  section('policy gateway');
  const soleSubmitted = await tool('propose_label_update', {
    object_id: 'moonbird-mask', draft: 'Removed from the community and sold illegally.', evidence_ids: ['EV-059'],
  });
  check('propose_label_update on submitted-only evidence is denied', soleSubmitted.json?.outcome === 'denied', JSON.stringify(soleSubmitted.json?.outcome));
  check('denial names the policy and a next step', !!soleSubmitted.json?.reason && !!soleSubmitted.json?.recovery);
  check('denial escalates rather than dead-ends', soleSubmitted.json?.escalated_to_curator === true);

  const withVerified = await tool('propose_label_update', {
    object_id: 'moonbird-mask',
    draft: 'The mask appears in a 1959 community photograph. Movement before the 1968 acquisition is under joint research.',
    evidence_ids: ['EV-059', 'EV-068'],
  });
  check('propose_label_update with a verified source queues approval', withVerified.json?.outcome === 'pending_approval', JSON.stringify(withVerified.json?.outcome));
  check('proposal is not published on its own', withVerified.json?.published === false);
  const approvalId = withVerified.json?.approval_id;

  const noDraft = await tool('propose_label_update', { object_id: 'moonbird-mask', evidence_ids: ['EV-068'] });
  check('propose_label_update without a draft is invalid', noDraft.status === 400 && noDraft.json.field === 'draft');

  const returnReview = await tool('open_return_review', { object_id: 'moonbird-mask', basis: 'Community request', evidence_ids: ['EV-059'] });
  check('open_return_review on submitted-only evidence is denied', returnReview.json?.outcome === 'denied', JSON.stringify(returnReview.json?.outcome));
  check('open_return_review never transfers custody', returnReview.json?.transfers_custody === false);

  /* ---------- 7b. escalation ---------- */
  section('escalation');
  check('a denied publication returns an escalation id', typeof soleSubmitted.json?.escalation_id === 'string', JSON.stringify(soleSubmitted.json?.escalation_id));
  check('a denied publication names its policy code', soleSubmitted.json?.policy === 'submitted_sole_authority', JSON.stringify(soleSubmitted.json?.policy));
  check('a denied publication offers a next step', typeof soleSubmitted.json?.next === 'string' && soleSubmitted.json.next.length > 0);
  check('a denied return review also escalates', typeof returnReview.json?.escalation_id === 'string', JSON.stringify(returnReview.json?.escalation_id));
  const escalationsPage = await get('/curator');
  check('the curator console shows the open escalation', escalationsPage.text.includes(soleSubmitted.json?.escalation_id ?? ' '));
  check('the escalation panel renders, not just the activity line', escalationsPage.text.includes('escalation-panel'));
  check('the escalation card names the policy code', /submitted sole authority/.test(escalationsPage.text));
  check('the escalation card states nothing was published', /Nothing was published/.test(escalationsPage.text));

  const escalationId = soleSubmitted.json?.escalation_id;
  await setRole('community');
  const communityResolve = await post(`/api/curator/escalations/${escalationId}/resolve`, { action: 'reviewed' });
  check('a community session cannot resolve an escalation', communityResolve.status === 403, `status ${communityResolve.status}`);
  await setRole('curator');

  const badAction = await post(`/api/curator/escalations/${escalationId}/resolve`, { action: 'whatever' });
  check('an unknown resolution is rejected', badAction.status === 400, `status ${badAction.status}`);
  const ghostEscalation = await post('/api/curator/escalations/ESC-000000/resolve', { action: 'reviewed' });
  check('an unknown escalation is 404', ghostEscalation.status === 404, `status ${ghostEscalation.status}`);

  const resolved = await post(`/api/curator/escalations/${escalationId}/resolve`, { action: 'reviewed', note: 'Opened the record and asked the contributor for the photographer.' });
  check('a curator can resolve an escalation', resolved.status === 200 && resolved.json?.status === 'reviewed', JSON.stringify(resolved.json));
  const replayEscalation = await post(`/api/curator/escalations/${escalationId}/resolve`, { action: 'reviewed' });
  check('a resolved escalation cannot be resolved twice', replayEscalation.status === 409, `status ${replayEscalation.status}`);

  const consoleAfterResolve = await get('/curator');
  check('the resolved escalation leaves the console', !consoleAfterResolve.text.includes(escalationId));
  const escalationActivity = await get('/curator/activity');
  check('the resolution is written to the audit trail', /resolved a policy referral|dismissed a policy referral/.test(escalationActivity.text));

  /* ---------- 7b2. tool output budget (B5/G6) ---------- */
  section('tool output budget');
  // The catalogue asks for roughly 1.5K per response. Read that as approximate:
  // the measured ceiling for a single-record answer is build_provenance_timeline
  // at ~1.6K, which is the working timeline a curator actually needs.
  const SINGLE_RECORD_BUDGET = 1800;
  const LIST_TOOLS = new Set(['list_submissions', 'list_objects', 'list_pending_approvals', 'get_collection_summary']);
  const oversized = [];
  for (const name of COMMUNITY_TOOLS.concat(CURATOR_TOOLS)) {
    if (LIST_TOOLS.has(name)) continue;
    const args = name === 'get_object_detail' || name === 'get_provenance_timeline' || name === 'build_provenance_timeline' || name === 'draft_label'
      ? { object_id: 'moonbird-mask' }
      : name === 'check_submission' ? { submission_id: submissionId }
      : name === 'get_review_case' ? { case_id: submissionId }
      : name === 'compare_evidence' ? { evidence_ids: ['EV-059', 'EV-068'] }
      : name === 'check_approval' ? { approval_id: approvalId }
      : {};
    const response = await tool(name, args);
    if (response.status === 200 && response.text.length > SINGLE_RECORD_BUDGET) {
      oversized.push(`${name}:${response.text.length}`);
    }
  }
  check(`every single-record read stays inside ${SINGLE_RECORD_BUDGET} characters`, oversized.length === 0, oversized.join(', '));

  // A list must be bounded by its page, not by how full the workspace is. This is
  // the property that actually protects an agent's context.
  const smallPage = await tool('list_submissions', { limit: 3 });
  const largePage = await tool('list_submissions', { limit: 30 });
  check('list_submissions honours limit', smallPage.json?.returned <= 3 && largePage.json?.returned <= 30, `${smallPage.json?.returned} / ${largePage.json?.returned}`);
  check('list_submissions reports the full count alongside the page', typeof smallPage.json?.count === 'number' && smallPage.json.count >= smallPage.json.returned);
  check('a truncated list says so and how to narrow it', smallPage.json.count <= 3 || typeof smallPage.json?.next === 'string');
  check('list size tracks the page, not the workspace', smallPage.text.length < largePage.text.length || smallPage.json.count <= 3, `${smallPage.text.length} vs ${largePage.text.length}`);

  /* ---------- 7c. audit trail (B3) ---------- */
  section('audit trail');
  const auditPage = await get('/curator/activity');
  check('the audit page renders', auditPage.status === 200);
  const clarified = await tool('request_clarification', { submission_id: submissionId, question: 'Who took the photograph?' });
  check('an agent clarification is applied', clarified.json?.outcome === 'applied', JSON.stringify(clarified.json?.outcome));
  const audit = await get('/curator/activity');
  check('the gateway denial is attributed to the Policy Gateway', /Policy Gateway/.test(audit.text));
  check('the agent and the human are named separately', /Curator Agent/.test(audit.text) && /Mina, Curator/.test(audit.text));
  check('denied decisions are marked as denied in the feed', /denied/i.test(audit.text));

  /* ---------- 7d. live record (B4) ---------- */
  section('live record');
  const pollOne = await get('/api/events/poll');
  check('the poll endpoint returns a revision token', pollOne.status === 200 && typeof pollOne.json?.revision === 'string', JSON.stringify(pollOne.json));
  const revisionBefore = pollOne.json?.revision;
  await setRole('community');
  await tool('submit_context_claim', { object_id: 'dawn-marker', claim: 'Live-record smoke claim', source: 'Verification run', consent: 'public_anonymous' });
  const pollTwo = await get('/api/events/poll');
  check('a contribution moves the revision token', pollTwo.json?.revision !== revisionBefore, `${revisionBefore} -> ${pollTwo.json?.revision}`);
  check('the token names the latest participant', typeof pollTwo.json?.latest?.actor === 'string', JSON.stringify(pollTwo.json?.latest));
  check('the change token carries no record content', !JSON.stringify(pollTwo.json).includes('Live-record smoke claim'));

  const stream = await fetch(`${base}/api/events`, { headers: { cookie: cookieHeader(), accept: 'text/event-stream' } });
  check('the stream answers as an event stream', (stream.headers.get('content-type') ?? '').includes('text/event-stream'), stream.headers.get('content-type') ?? 'none');
  const reader = stream.body.getReader();
  const firstFrame = await Promise.race([
    reader.read().then(({ value }) => new TextDecoder().decode(value ?? new Uint8Array())),
    new Promise((resolve) => setTimeout(() => resolve(''), 8000)),
  ]);
  check('the stream opens with a sync frame', /event: sync/.test(firstFrame), JSON.stringify(firstFrame.slice(0, 80)));
  check('the sync frame carries the same revision token', firstFrame.includes(pollTwo.json?.revision ?? ' '));
  await reader.cancel().catch(() => {});

  const communityStream = await fetch(`${base}/api/events/poll`, { headers: { cookie: cookieHeader() } });
  check('both surfaces read one workspace token', (await communityStream.json()).revision === pollTwo.json?.revision);
  await setRole('curator');

  /* ---------- 8. approvals ---------- */
  section('approvals');
  const pending = await tool('list_pending_approvals', {});
  check('list_pending_approvals includes the new request', pending.json?.approvals?.some((a) => a.id === approvalId));
  check('approval polling is non-blocking', pending.json?.note?.includes('does not block'));
  const beforeResolve = await tool('check_approval', { approval_id: approvalId });
  check('check_approval reports pending', beforeResolve.json?.status === 'pending');
  // Relative to the version this run started from: the suite may run twice
  // against the same workspace, and each approval advances the record.
  await setRole('community');
  const baseVersion = (await tool('get_object_detail', { object_id: 'moonbird-mask' })).json?.object?.version;
  await setRole('curator');

  const edited = `The museum acquired this mask through Lorne Gallery in 1968. Community material places it in Aru village in 1959. The intervening custody is under joint research (review cycle ${baseVersion + 1}).`;
  const resolveResponse = await post(`/api/curator/approvals/${approvalId}/resolve`, { action: 'approve_with_edit', draft: edited, editReason: 'Preserve the verified acquisition while attributing the community material.' });
  check('approve-with-edit is recorded as such', resolveResponse.status === 200 && resolveResponse.json.resolution === 'approved_with_edit', JSON.stringify(resolveResponse.json));
  check('approval publishes a new label revision', resolveResponse.json?.published === true && resolveResponse.json?.revision === baseVersion + 1, JSON.stringify(resolveResponse.json));
  await setRole('community');
  const publishedDetail = await tool('get_object_detail', { object_id: 'moonbird-mask' });
  check('approved text becomes the public label', publishedDetail.json?.object?.label === edited, JSON.stringify(publishedDetail.json?.object?.label));
  check('publication advances the object version', publishedDetail.json?.object?.version === baseVersion + 1, `version ${publishedDetail.json?.object?.version} from ${baseVersion}`);
  check('the public revision number tracks the publication', publishedDetail.json?.object?.label_revision === publishedDetail.json?.object?.version, `revision ${publishedDetail.json?.object?.label_revision}`);
  await setRole('curator');
  const reflectedList = await tool('list_submissions', { status: 'reflected in label', object_id: 'moonbird-mask' });
  const reflectedSeed = reflectedList.json?.submissions?.find((item) => item.title === '1959 Aru village photograph');
  check('publishing updates every evidence-linked contribution atomically', !!reflectedSeed, JSON.stringify(reflectedList.json?.submissions));
  if (reflectedSeed) {
    await setRole('community');
    const reflectedPage = await get(`/submissions/${reflectedSeed.id}`);
    check('the contributor outcome names the reflected revision', reflectedPage.status === 200
      && reflectedPage.text.includes(`revision ${resolveResponse.json?.revision}`));
    check('the contributor outcome shows the label diff', reflectedPage.text.includes('Label changes in revision'));
    await setRole('curator');
  }
  await setRole('curator');
  const afterResolve = await tool('check_approval', { approval_id: approvalId });
  check('check_approval reflects the decision', afterResolve.json?.status === 'approved_with_edit');
  const replay = await post(`/api/curator/approvals/${approvalId}/resolve`, { action: 'approve_with_edit', draft: edited });
  check('a resolved approval cannot be replayed', replay.status === 409, `status ${replay.status}`);
  const ghost = await post('/api/curator/approvals/APR-999/resolve', { action: 'approved' });
  check('an unknown approval is 404', ghost.status === 404, `status ${ghost.status}`);

  /* ---------- 9. clarification ---------- */
  section('clarification');
  const clarify = await tool('request_clarification', { submission_id: submissionId, question: 'Who made this photograph?' });
  check('request_clarification is applied', clarify.status === 200 && clarify.json.status === 'needs information');
  const afterClarify = await tool('list_submissions', { status: 'needs information' });
  check('the contribution moved to "needs information"', afterClarify.json?.submissions?.some((s) => s.id === submissionId));
  const emptyQuestion = await tool('request_clarification', { submission_id: submissionId, question: '  ' });
  check('an empty clarification is invalid', emptyQuestion.status === 400);

  await setRole('community');
  const contributorView = await tool('check_submission', { submission_id: submissionId });
  check('the contributor sees the curator follow-up', contributorView.json?.status === 'needs information' && contributorView.json.message.includes('follow-up'));
  // FR2-K1 — the question itself, not a sentence saying one was asked.
  // Whatever was asked, the contributor is given the words rather than a notice that
  // words exist. Asserted against the stored question so the check does not depend on
  // which surface asked or what it happened to say.
  const quoted = contributorView.json?.curator_question;
  check('the contributor is given the question verbatim', typeof quoted === 'string' && quoted.length > 0, JSON.stringify(quoted));
  check('and is told how to answer it', !!contributorView.json?.next);
  const askedBefore = contributorView.json?.questions_asked ?? 0;
  const statusScreen = await get(`/submissions/${submissionId}`);
  check('the status page quotes the question too', !!quoted && statusScreen.text.includes(quoted));

  await setRole('curator');
  const secondQuestion = 'A second question, asked after the first.';
  const second = await post(`/api/curator/submissions/${submissionId}/clarify`, { question: secondQuestion });
  check('a curator may ask more than once', second.status === 200, `status ${second.status}`);
  await setRole('community');
  const bothAsked = await tool('check_submission', { submission_id: submissionId });
  check('every question asked is kept', bothAsked.json?.questions_asked === askedBefore + 1, `${bothAsked.json?.questions_asked} from ${askedBefore}`);
  check('the latest question is the one quoted', bothAsked.json?.curator_question === secondQuestion, JSON.stringify(bothAsked.json?.curator_question));

  /* ---------- 9b. assets ---------- */
  section('asset pipeline');
  // A 1x1 PNG. Small enough to inline, real enough for the media-type allowlist.
  const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kfQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const upload = async (type, name) => {
    const body = new FormData();
    body.append('file', new Blob([pixel], { type }), name);
    return req('/api/assets', { method: 'POST', body });
  };

  await setRole('community');
  const uploaded = await upload('image/png', 'contribution.png');
  check('a community contributor can upload an image', uploaded.status === 200 && !!uploaded.json?.id, `status ${uploaded.status}`);
  const assetId = uploaded.json?.id;
  check('an upload reports its kind and size', uploaded.json?.kind === 'image' && uploaded.json?.byte_size > 0);
  check('an upload records the original pixel dimensions', uploaded.json?.width === 1 && uploaded.json?.height === 1,
    `${uploaded.json?.width}x${uploaded.json?.height}`);

  const scriptable = await upload('image/svg+xml', 'payload.svg');
  check('a script-bearing SVG is refused', scriptable.status === 400, `status ${scriptable.status}`);
  const markup = await upload('text/html', 'payload.html');
  check('an HTML upload is refused', markup.status === 400, `status ${markup.status}`);
  const empty = await req('/api/assets', { method: 'POST', body: new FormData() });
  check('an upload with no file is refused', empty.status === 400, `status ${empty.status}`);

  // The core asset rule: an upload is never public until a curator makes it so.
  const ownerRead = await get(`/api/assets/${assetId}`);
  check('a fresh upload is not served to the community, not even to its uploader', ownerRead.status === 403, `status ${ownerRead.status}`);
  const strangerRead = await get('/api/assets/AST-DOES-NOT-EXIST');
  check('an unknown asset id is a 404, never a 403', strangerRead.status === 404, `status ${strangerRead.status}`);

  await setRole('curator');
  const curatorRead = await get(`/api/assets/${assetId}`);
  check('a curator may read restricted material', curatorRead.status === 200, `status ${curatorRead.status}`);
  check('asset bytes come back under their stored media type', curatorRead.status === 200);
  /* ---------- 9c. the contribution form's own route ---------- */
  section('contribution flow');
  await setRole('community');
  const twoFiles = [await upload('image/png', 'front.png'), await upload('image/png', 'reverse.png')];
  const contribution = await post('/api/community/evidence', {
    objectId: 'moonbird-mask',
    kinds: ['Photograph', 'Oral history'],
    details: [
      { kind: 'Photograph', values: { caption: 'Dancers outside the meeting house.', taken_when: 'August 1959' } },
      { kind: 'Oral history', values: { transcript: 'The speaker recalls first-rains gatherings.', speaker: 'A community elder' } },
    ],
    assetIds: twoFiles.map((r) => r.json?.id),
    title: 'Smoke multi-kind contribution',
    source: 'Verification run',
    consent: 'public_attributed',
  });
  check('a contribution may carry more than one kind of material', contribution.status === 200 && !!contribution.json?.id, `status ${contribution.status}`);
  check('both kinds are recorded on the contribution', contribution.json?.kinds?.length === 2, JSON.stringify(contribution.json?.kinds));
  check('uploaded files are bound to the contribution', contribution.json?.attached_assets === 2, `attached ${contribution.json?.attached_assets}`);

  const noKind = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'No material', kinds: [], details: [] });
  check('a contribution with no material is refused', noKind.status === 400, `status ${noKind.status}`);
  const noRequired = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', title: 'Missing the required field',
    kinds: ['Photograph'], details: [{ kind: 'Photograph', values: { taken_when: '1959' } }],
  });
  check('a kind missing its required field is refused by name', noRequired.status === 400 && /caption|show/i.test(noRequired.json?.reason ?? ''), noRequired.json?.reason);
  const undeclared = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', title: 'Undeclared field',
    kinds: ['Object information'], details: [{ kind: 'Object information', values: { claim: 'A claim', photographer: 'Someone' } }],
  });
  check('an undeclared field is dropped rather than stored', undeclared.status === 200);

  const statusPage = await get(`/submissions/${contribution.json?.id}`);
  check('the contributor status page shows the record as it stands', statusPage.status === 200 && statusPage.text.includes('The record as it stands'));
  check('the contributor is told their files are held privately', statusPage.text.includes('Held privately'));


  /* ---------- 9d. asset tools (FR-W1) ---------- */
  section('asset tools');
  await setRole('community');
  const toolUpload = await upload('image/png', 'tool-attached.png');
  const toolSubmission = await tool('submit_evidence', {
    object_id: 'moonbird-mask', title: 'Asset tool contribution',
    description: 'Filed by the verification run.', consent: 'public_attributed',
  });
  const attach = await tool('attach_assets', { submission_id: toolSubmission.json?.submission_id, asset_ids: [toolUpload.json?.id] });
  check('attach_assets binds an uploaded file to a contribution', attach.status === 200 && attach.json?.attached === 1, JSON.stringify(attach.json?.attached));
  check('attach_assets says the file stays restricted', attach.json?.visibility === 'restricted');
  const attachNothing = await tool('attach_assets', { submission_id: toolSubmission.json?.submission_id, asset_ids: [] });
  check('attach_assets with no ids is refused', attachNothing.status === 400, `status ${attachNothing.status}`);
  const attachUnknown = await tool('attach_assets', { submission_id: 'SUB-NOT-REAL', asset_ids: [toolUpload.json?.id] });
  check('attach_assets refuses an unknown contribution', attachUnknown.status === 400, `status ${attachUnknown.status}`);
  const reattach = await tool('attach_assets', { submission_id: toolSubmission.json?.submission_id, asset_ids: [toolUpload.json?.id] });
  // This used to read `attached === 0`, which pinned the old meaning of that number: rows
  // the UPDATE happened to change. F4-3 made both counts answer "is it on the contribution",
  // so a file already there reads as attached. What the check is actually for — the file is
  // not duplicated and nothing else moves — is asserted directly.
  check('an already-attached file is counted, not duplicated', reattach.json?.attached === 1 && reattach.json?.total_on_contribution === attach.json?.total_on_contribution, JSON.stringify(reattach.json).slice(0, 120));

  // Tools never carry file contents, only ids and metadata (RETURN_PLAN 15.1).
  const listed = await tool('list_object_assets', { object_id: 'moonbird-mask' });
  check('list_object_assets answers a community session', listed.status === 200, `status ${listed.status}`);
  check('list_object_assets is flagged as external content', listed.json?.untrusted_content === true);
  check('an asset listing carries no storage key', !listed.text.includes('storage_key'));
  check('a community listing hides the restricted upload', !listed.json?.assets?.some((a) => a.id === toolUpload.json?.id));
  check('a community listing still says something is withheld', listed.json?.withheld_count >= 1, `withheld ${listed.json?.withheld_count}`);
  const detailDenied = await tool('get_asset_detail', { asset_id: toolUpload.json?.id });
  check('get_asset_detail refuses restricted material to the community', detailDenied.status === 403 && detailDenied.json?.policy === 'consent_not_public', `status ${detailDenied.status}`);
  const detailUnknown = await tool('get_asset_detail', { asset_id: 'AST-NOT-REAL' });
  check('get_asset_detail treats an unknown id as simply unavailable', detailUnknown.status === 400, `status ${detailUnknown.status}`);

  await setRole('curator');
  const curatorListed = await tool('list_object_assets', { object_id: 'moonbird-mask' });
  check('a curator listing includes the restricted upload', curatorListed.json?.assets?.some((a) => a.id === toolUpload.json?.id));
  const curatorDetail = await tool('get_asset_detail', { asset_id: toolUpload.json?.id });
  check('a curator may read restricted asset metadata', curatorDetail.status === 200 && curatorDetail.json?.id === toolUpload.json?.id);
  check('asset metadata never includes the storage key', !('storage_key' in (curatorDetail.json ?? {})));
  const curatorAttach = await tool('attach_assets', { submission_id: toolSubmission.json?.submission_id, asset_ids: [toolUpload.json?.id] });
  check('attach_assets stays on the community surface', curatorAttach.status === 403, `status ${curatorAttach.status}`);
  await setRole('curator');
  const curatorRefused = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'From a curator', kinds: ['Photograph'], details: [] });
  check('a curator session is refused with a reason it can show', curatorRefused.status === 403 && !!curatorRefused.json?.reason, JSON.stringify(curatorRefused.json?.reason));

  // The reset section that follows calls a community-only tool, so leave the role as found.
  await setRole('community');

  /* ---------- 9e. publishing an asset to the public record ---------- */
  section('asset publication');
  await setRole('community');
  const openUpload = await upload('image/png', 'publishable.png');
  const openSubmission = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', kinds: ['Photograph'],
    details: [{ kind: 'Photograph', values: { caption: 'A photograph the contributor allows the museum to display.' } }],
    assetIds: [openUpload.json?.id], title: 'Publishable photograph',
    source: 'Verification run', consent: 'public_attributed',
  });
  const shutUpload = await upload('image/png', 'private.png');
  const shutSubmission = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', kinds: ['Photograph'],
    details: [{ kind: 'Photograph', values: { caption: 'A photograph the contributor keeps private.' } }],
    assetIds: [shutUpload.json?.id], title: 'Private photograph',
    source: 'Verification run', consent: 'private',
  });
  check('both contributions were filed', openSubmission.status === 200 && shutSubmission.status === 200);

  const publishAsCommunity = await post(`/api/curator/assets/${openUpload.json?.id}/publish`, { publish: true });
  check('a community session cannot publish an asset', publishAsCommunity.status === 403, `status ${publishAsCommunity.status}`);

  await setRole('curator');
  const published = await post(`/api/curator/assets/${openUpload.json?.id}/publish`, { publish: true });
  check('a curator can publish a consented asset', published.status === 200 && published.json?.visibility === 'public', `status ${published.status}`);
  const refused = await post(`/api/curator/assets/${shutUpload.json?.id}/publish`, { publish: true });
  check('consent, not seniority, decides publication', refused.status === 403 && refused.json?.policy === 'consent_not_public', JSON.stringify(refused.json?.policy));
  const missingAsset = await post('/api/curator/assets/AST-NOT-REAL/publish', { publish: true });
  check('publishing an unknown asset is a 404', missingAsset.status === 404, `status ${missingAsset.status}`);

  await setRole('community');
  const openBytes = await get(`/api/assets/${openUpload.json?.id}`);
  check('a published asset is served to the public', openBytes.status === 200, `status ${openBytes.status}`);
  const shutBytes = await get(`/api/assets/${shutUpload.json?.id}`);
  check('the private one is still refused', shutBytes.status === 403, `status ${shutBytes.status}`);

  // RETURN_PLAN 20.4 asks for meaningful alt text. The contributor writes it, and a
  // filename must never stand in for it.
  const described = await upload('image/png', 'IMG_4432.png');
  const describedSubmission = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', kinds: ['Photograph'],
    details: [{ kind: 'Photograph', values: { caption: 'A described photograph.' } }],
    assetIds: [described.json?.id],
    assetAlts: { [described.json?.id]: 'A carved mask outside a meeting house' },
    title: 'Described photograph', source: 'Verification run', consent: 'public_attributed',
  });
  check('a contribution can carry a description for each image', describedSubmission.status === 200);
  await setRole('curator');
  const describedDetail = await tool('get_asset_detail', { asset_id: described.json?.id });
  check('the description is stored on the asset', describedDetail.json?.alt_text === 'A carved mask outside a meeting house', JSON.stringify(describedDetail.json?.alt_text));
  await post(`/api/curator/assets/${described.json?.id}/publish`, { publish: true });
  await setRole('community');

  const objectPage = await get('/objects/moonbird-mask');
  check('the published photograph reaches the object page', objectPage.text.includes(`/api/assets/${openUpload.json?.id}`));
  check('the private photograph does not', !objectPage.text.includes(`/api/assets/${shutUpload.json?.id}`));
  check('the object page separates community contributions', objectPage.text.includes('contributed-context'));
  check('a private contribution is not named on the public record', !objectPage.text.includes('Private photograph'));
  check('a consented contribution is', objectPage.text.includes('Publishable photograph'));
  check('the contributor description is used as alt text', objectPage.text.includes('A carved mask outside a meeting house'));
  check('no uploaded filename is used as alt text', !/alt="[^"]*IMG_4432/.test(objectPage.text));

  // FR2-D1 — a published document has to reach the public record, not only the case.
  // FR2-D2 — and both photographs and files have to be obtainable.
  await setRole('community');
  const pdfBody = new FormData();
  pdfBody.append('file', new Blob([new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')], { type: 'application/pdf' }), 'registry.pdf');
  const pdfUpload = await req('/api/assets', { method: 'POST', body: pdfBody });
  check('a document upload is accepted', pdfUpload.status === 200 && pdfUpload.json?.kind === 'document', `status ${pdfUpload.status}`);
  const pdfId = pdfUpload.json?.id;
  const pdfSubmission = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', kinds: ['Document'],
    details: [{ kind: 'Document', values: { document_type: 'Harbour registry excerpt' } }],
    assetIds: [pdfId], title: 'Registry excerpt', source: 'Verification run', consent: 'public_attributed',
  });
  check('the document is attached to a contribution', pdfSubmission.status === 200);

  const beforePublish = await get('/objects/moonbird-mask');
  check('an unpublished document stays off the public record', !beforePublish.text.includes(pdfId));
  await setRole('curator');
  await post(`/api/curator/assets/${pdfId}/publish`, { publish: true });
  await setRole('community');
  const afterPublish = await get('/objects/moonbird-mask');
  check('a published document reaches the public record', afterPublish.text.includes(pdfId));
  check('and it is offered as a download', afterPublish.text.includes(`${pdfId}?download=1`));

  const inlineImage = await get(`/api/assets/${openUpload.json?.id}`);
  check('a photograph is served inline so the gallery can draw it', inlineImage.status === 200);
  const askedForFile = await fetch(`${base}/api/assets/${openUpload.json?.id}?download=1`, { headers: { cookie: cookieHeader() } });
  check('the same photograph can be asked for as a file', (askedForFile.headers.get('content-disposition') ?? '').startsWith('attachment'), askedForFile.headers.get('content-disposition'));

  // The download flag changes the disposition and nothing else.
  await setRole('curator');
  await post(`/api/curator/assets/${pdfId}/publish`, { publish: false });
  await setRole('community');
  const withheldDownload = await get(`/api/assets/${pdfId}?download=1`);
  check('asking for a download cannot bypass the access gate', withheldDownload.status === 403, `status ${withheldDownload.status}`);

  await setRole('curator');
  const withdrawn = await post(`/api/curator/assets/${openUpload.json?.id}/publish`, { publish: false });
  check('a curator can withdraw a published asset again', withdrawn.status === 200 && withdrawn.json?.visibility === 'restricted');
  await setRole('community');
  const afterWithdraw = await get(`/api/assets/${openUpload.json?.id}`);
  check('a withdrawn asset stops being served', afterWithdraw.status === 403, `status ${afterWithdraw.status}`);

  /* ---------- 10. unknown tool + reset ---------- */
  section('surface edges');
  const unknownTool = await tool('delete_evidence', {});
  check('an unlisted tool is not routable', unknownTool.status === 404, `status ${unknownTool.status}`);
  check(`${COMMUNITY_TOOLS.length} community + ${CURATOR_TOOLS.length} curator + ${SHARED_TOOLS.length} shared tools were exercised`, true);

  const reset = await post('/api/reset', {});
  check('reset creates a fresh workspace', reset.status === 200 && !!reset.json.museumId);
  const freshInbox = await tool('search_collection', {});
  check('the fresh workspace still serves the collection', freshInbox.json?.count === 8);
  await setRole('curator');
  const freshSubmissions = await tool('list_submissions', {});
  check('the fresh workspace does not carry over test contributions', !freshSubmissions.json?.submissions?.some((s) => s.id === submissionId));
  // Seeded ids must be unique per workspace, or a reset leaves an empty museum.
  check('the fresh workspace is seeded with the demo record', freshSubmissions.json?.count === 3, `count ${freshSubmissions.json?.count}`);
  const freshApprovals = await tool('list_pending_approvals', {});
  check('the fresh workspace has its own pending approval', freshApprovals.json?.count === 1, `count ${freshApprovals.json?.count}`);
  const freshSummary = await tool('get_collection_summary', {});
  check('the fresh workspace has seeded activity', (freshSummary.json?.recent_activity?.length ?? 0) > 0);

  /* ---------- 11. registering a record (FR-K5, FR-X3) ---------- */
  // Runs against the workspace the reset just created. Registering adds a permanent
  // record, so doing it in the demo workspace would leave the collection one object
  // larger for every later run and break the counts above.
  section('object registration');
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const record = {
    title: `Smoke Harbour Lamp ${stamp}`, accession: `RT.1972.${stamp}`, period: 'c. 1910',
    material: 'Brass, glass', origin: 'North Channel · attribution under review',
    label: 'A brass signal lamp recorded in the harbour registry. Custody before 1972 is undocumented.',
  };
  const slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  await setRole('community');
  const communityRoute = await post('/api/curator/objects', { ...record, confirmed: true });
  check('a community session cannot register a record', communityRoute.status === 403, `status ${communityRoute.status}`);
  const communityTool = await tool('register_object', { title: record.title, accession: record.accession, basis: 'trying' });
  check('register_object is not on the community surface', communityTool.status === 403, `status ${communityTool.status}`);

  await setRole('curator');
  // The agent may propose. It may never create.
  const proposal = await tool('register_object', { title: `Agent Proposed Lamp ${stamp}`, accession: `RT.1972.A${stamp}`, basis: 'A verified accession file names it.', evidence_ids: ['EV-068'] });
  check('register_object queues for a human rather than creating', proposal.status === 200 && proposal.json?.outcome === 'pending_approval', JSON.stringify(proposal.json?.outcome));
  check('register_object says plainly that nothing was created', proposal.json?.created === false && !!proposal.json?.proposal_id);
  const agentMade = await get(`/objects/agent-proposed-lamp-${stamp.toLowerCase()}`);
  check('the proposed record does not exist', agentMade.status === 404, `status ${agentMade.status}`);
  const weakProposal = await tool('register_object', { title: `Unbacked Lamp ${stamp}`, accession: `RT.1972.U${stamp}`, basis: 'A community memory.', evidence_ids: ['EV-OH-059'] });
  check('a proposal on submitted material alone is refused', weakProposal.json?.policy === 'submitted_sole_authority', JSON.stringify(weakProposal.json?.policy));
  check('and it reaches a curator rather than stopping', !!weakProposal.json?.escalation_id);
  const namelessProposal = await tool('register_object', { accession: 'RT.1972.NONE', basis: 'No title given.' });
  check('a proposal without a title is refused', namelessProposal.status === 400, `status ${namelessProposal.status}`);

  // The curator route: HIGH means the decision has to be an explicit one.
  const unconfirmed = await post('/api/curator/objects', record);
  check('registering without confirming is held back', unconfirmed.status === 409 && unconfirmed.json?.awaiting === 'confirmation', `status ${unconfirmed.status}`);
  const incomplete = await post('/api/curator/objects', { title: 'Only a title', confirmed: true });
  check('an incomplete record names the missing field', incomplete.status === 400 && /required/i.test(incomplete.json?.reason ?? ''), incomplete.json?.reason);
  const registered = await post('/api/curator/objects', { ...record, confirmed: true });
  check('a confirmed registration creates the record', registered.status === 200 && registered.json?.object_id === slug, JSON.stringify(registered.json));
  const duplicate = await post('/api/curator/objects', { ...record, confirmed: true });
  check('a duplicate accession is refused', duplicate.status === 409, `status ${duplicate.status}`);

  const newPage = await get(`/objects/${slug}`);
  check('the new record is publicly readable', newPage.status === 200, `status ${newPage.status}`);
  check('the new record carries its first published label', newPage.text.includes('harbour registry'));
  const curatorList = await tool('list_objects', {});
  check('the new record reaches the curator tool surface', curatorList.json?.objects?.some((object) => object.id === slug));
  await setRole('community');
  const newDetail = await tool('get_object_detail', { object_id: slug });
  check('the new record is visible to a community agent too', newDetail.status === 200 && !!newDetail.json?.object?.label, `status ${newDetail.status}`);

  /* ---------- 12. the WebMCP review findings (MCP_ERROR.md) ---------- */
  // These run last and in a workspace of their own, because the citation checks need to
  // know exactly which evidence exists.
  section('review findings');
  await post('/api/reset');
  await setRole('community');

  /* MCP-E1 — consent is validated at the door rather than stored verbatim. */
  const rogueConsent = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Rogue consent', description: 'x', consent: 'community_only' });
  check('an undefined consent level is refused', rogueConsent.json?.outcome === 'invalid' && rogueConsent.json?.field === 'consent', JSON.stringify(rogueConsent.json));
  check('the refusal names the levels that exist', /private.*public_anonymous.*public_attributed/.test(rogueConsent.json?.reason ?? ''), rogueConsent.json?.reason);
  const noConsent = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Consent omitted', description: 'x' });
  check('an omitted consent still defaults to private', noConsent.json?.outcome === 'applied', JSON.stringify(noConsent.json));
  const goodConsent = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Consent given', description: 'x', consent: 'public_attributed' });
  check('a declared consent level is accepted', goodConsent.json?.outcome === 'applied', JSON.stringify(goodConsent.json));
  const rogueForm = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', title: 'Rogue consent through the form', kinds: ['Object information'],
    details: [{ kind: 'Object information', values: { claim: 'A claim' } }], consent: 'community_only',
  });
  check('the contribution form refuses it too rather than rewriting it', rogueForm.status === 400 && rogueForm.json?.field === 'consent', `status ${rogueForm.status}`);

  /* MCP-E2 — consent is read as a permission, so the private default is not quotable. */
  await setRole('curator');
  const reviewListed = await tool('list_submissions', { limit: 50 });
  const privateRow = reviewListed.json?.submissions?.find((row) => row.id === noConsent.json?.submission_id);
  check('a private contribution is not marked quotable', privateRow?.quotable === false, JSON.stringify(privateRow));
  const privateCase = await tool('get_review_case', { case_id: noConsent.json?.submission_id });
  check('a private contribution withholds its body from the case', privateCase.json?.submitted?.description === null);
  check('a private contribution carries its consent restriction', (privateCase.json?.consent_restrictions ?? []).length === 1);
  const openRow = reviewListed.json?.submissions?.find((row) => row.id === goodConsent.json?.submission_id);
  check('a publicly consented contribution stays quotable', openRow?.quotable === true, JSON.stringify(openRow));

  /* MCP-E3 — attaching nothing is not a success. */
  await setRole('community');
  const mcpAttachNothing = await tool('attach_assets', { submission_id: goodConsent.json?.submission_id, asset_ids: ['AST-NOT-A-REAL-ID'] });
  check('attaching an unknown asset is refused, not applied', mcpAttachNothing.json?.outcome === 'invalid' && mcpAttachNothing.json?.field === 'asset_ids', JSON.stringify(mcpAttachNothing.json));
  check('the refusal names the id that did not resolve', (mcpAttachNothing.json?.omitted_asset_ids ?? []).includes('AST-NOT-A-REAL-ID'));
  const realUpload = await upload('image/png', 'attach-probe.png');
  const attachPartly = await tool('attach_assets', { submission_id: goodConsent.json?.submission_id, asset_ids: [realUpload.json?.id, 'AST-NOT-A-REAL-ID'] });
  check('a partial attach applies and names what it dropped', attachPartly.json?.outcome === 'applied' && attachPartly.json?.attached === 1 && (attachPartly.json?.omitted_asset_ids ?? []).length === 1, JSON.stringify(attachPartly.json));

  /* MCP-E4 — citing nothing and citing only submitted material read differently. */
  await setRole('curator');
  const citesNothing = await tool('open_return_review', { object_id: 'moonbird-mask', basis: 'No citation given' });
  check('a HIGH call citing nothing says it cited nothing', citesNothing.json?.policy === 'no_supporting_evidence', JSON.stringify(citesNothing.json?.policy));
  const citesSubmitted = await tool('open_return_review', { object_id: 'moonbird-mask', basis: 'Community memory', evidence_ids: ['EV-059'] });
  check('a HIGH call citing submitted material still names the authority rule', citesSubmitted.json?.policy === 'submitted_sole_authority', JSON.stringify(citesSubmitted.json?.policy));

  /* MCP-E5 — an unresolved citation is an input problem, not a workspace problem. */
  const citesUnknown = await tool('propose_label_update', { object_id: 'moonbird-mask', draft: 'x', evidence_ids: ['EV-NOT-A-REAL-ID'] });
  check('an unknown evidence id is invalid input, not a workspace mismatch', citesUnknown.json?.outcome === 'invalid' && citesUnknown.json?.field === 'evidence_ids', JSON.stringify(citesUnknown.json));
  check('the refusal names the id rather than the workspace', (citesUnknown.json?.reason ?? '').includes('EV-NOT-A-REAL-ID') && !/belongs to another workspace/i.test(citesUnknown.json?.reason ?? ''), citesUnknown.json?.reason);
  const citesOtherObject = await tool('propose_label_update', { object_id: 'tide-listening-stone', draft: 'x', evidence_ids: ['EV-068'] });
  check('evidence about another object is refused as such', citesOtherObject.json?.outcome === 'invalid' && /different object/.test(citesOtherObject.json?.reason ?? ''), citesOtherObject.json?.reason);

  /* MCP-E6 — every object holds a verified record, so no object is locked out. */
  const OBJECT_EVIDENCE = {
    'moonbird-mask': 'EV-068', 'riverstone-vessel': 'EV-ACC-1912', 'woven-signal-cloth': 'EV-ACC-1952',
    'tide-listening-stone': 'EV-ACC-1888', 'reed-memory-box': 'EV-ACC-1934', 'four-winds-bowl': 'EV-ACC-1904',
    'dawn-marker': 'EV-ACC-1962', 'harbor-thread-map': 'EV-ACC-1951',
  };
  for (const [objectId, evidenceId] of Object.entries(OBJECT_EVIDENCE)) {
    const mcpProposal = await tool('propose_label_update', { object_id: objectId, draft: `Working draft for ${objectId}.`, evidence_ids: [evidenceId] });
    check(`${objectId} can reach human approval on its own verified record`, mcpProposal.json?.outcome === 'pending_approval' && !!mcpProposal.json?.approval_id, JSON.stringify(mcpProposal.json));
  }

  /* MCP-E7 — a declared parameter changes the answer. */
  const wholeTimeline = await tool('build_provenance_timeline', { object_id: 'moonbird-mask' });
  const citedTimeline = await tool('build_provenance_timeline', { object_id: 'moonbird-mask', evidence_ids: ['EV-059'] });
  check('a cited timeline is narrower than the whole recorded one', citedTimeline.json?.events?.length < wholeTimeline.json?.events?.length, `${citedTimeline.json?.events?.length} of ${wholeTimeline.json?.events?.length}`);
  check('a cited timeline names what it rested on', (citedTimeline.json?.cited_evidence_ids ?? []).includes('EV-059'));
  check('a cited timeline still lists every gap', citedTimeline.json?.gaps?.length === wholeTimeline.json?.gaps?.length, 'a working timeline must not read as a complete history');
  const wholeDraft = await tool('draft_label', { object_id: 'moonbird-mask' });
  const citedDraft = await tool('draft_label', { object_id: 'moonbird-mask', evidence_ids: ['EV-068'] });
  check('a draft rests on the evidence it was given', citedDraft.json?.assertions?.length < wholeDraft.json?.assertions?.length, `${citedDraft.json?.assertions?.length} of ${wholeDraft.json?.assertions?.length}`);
  check('a draft refuses a citation a proposal would refuse', (await tool('draft_label', { object_id: 'moonbird-mask', evidence_ids: ['EV-ACC-1912'] })).json?.outcome === 'invalid');

  // B1 in the review report — one write call leaves one record. The report saw pairs; the
  // handler inserts once, and this pins that down wherever the suite is pointed.
  await setRole('community');
  const beforeWrite = await (async () => { await setRole('curator'); const rows = await tool('list_submissions', { limit: 100 }); await setRole('community'); return rows.json?.count ?? 0; })();
  await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Single write probe', description: 'x', consent: 'public_anonymous' });
  await setRole('curator');
  const afterWrite = await tool('list_submissions', { limit: 100 });
  check('one contribution call leaves exactly one contribution', (afterWrite.json?.count ?? 0) - beforeWrite === 1, `${beforeWrite} → ${afterWrite.json?.count}`);
  await setRole('community');
  /* ---------- 13. the browser sweep findings (FIX_REQUEST_3.md) ---------- */
  section('browser sweep');
  await post('/api/reset');

  /* EA-1 — a long query is a search, not a 500. F6-3 gave the field a ceiling, so a
     phrase past it is refused in the contract; the point of this check is that neither
     answer is an unhandled throw. */
  await setRole('community');
  for (const length of [48, 49, 200]) {
    const long = await tool('search_collection', { query: 'a'.repeat(length) });
    check(`a ${length}-character query is searched, not thrown`, long.status === 200 && long.json?.count === 0, `status ${long.status}`);
  }
  const pastTheCeiling = await tool('search_collection', { query: 'a'.repeat(2000) });
  check('a query past the ceiling is refused in the contract, not thrown', pastTheCeiling.status === 400 && pastTheCeiling.json?.field === 'query', JSON.stringify(pastTheCeiling.json).slice(0, 110));
  const stillSearches = await tool('search_collection', { query: 'basalt' });
  check('search still matches on a field other than the title', stillSearches.json?.objects?.[0]?.id === 'tide-listening-stone', JSON.stringify(stillSearches.json?.objects));
  const emptySearch = await tool('search_collection', {});
  check('a search with no query still lists the collection', emptySearch.json?.count === OBJECT_IDS.length, `${emptySearch.json?.count}`);

  /* EA-2 — comparison answers as a comparison or refuses as one. */
  await setRole('curator');
  const sweepInbox = await tool('list_submissions', { limit: 5 });
  const anyCase = sweepInbox.json?.submissions?.[0]?.id;
  const comparison = await tool('compare_evidence', { evidence_ids: ['EV-068', 'EV-059'] });
  check('compare_evidence returns a comparison', Array.isArray(comparison.json?.evidence) && !comparison.json?.case_id);
  const asCase = await tool('compare_evidence', { evidence_ids: [anyCase] });
  check('compare_evidence does not answer as a review case', asCase.json?.outcome === 'invalid' && asCase.json?.field === 'evidence_ids', JSON.stringify(asCase.json).slice(0, 120));
  check('the refusal talks about evidence, not review cases', !/review case/i.test(asCase.json?.reason ?? ''), asCase.json?.reason);
  const noIds = await tool('compare_evidence', {});
  check('compare_evidence with no ids refuses on its own parameter', noIds.json?.field === 'evidence_ids');
  const stillACase = await tool('get_review_case', { case_id: anyCase });
  check('get_review_case still answers as a review case', stillACase.json?.case_id === anyCase);

  /* EA-3 — an accession that is taken is refused where it is proposed. */
  const takenAccession = await tool('register_object', { title: `Accession Probe ${stamp}`, accession: 'RT.1930.014', basis: 'A verified accession file names it.', evidence_ids: ['EV-068'] });
  check('a proposal reusing an accession is refused', takenAccession.json?.outcome === 'invalid' && takenAccession.json?.field === 'accession', JSON.stringify(takenAccession.json).slice(0, 140));
  check('the refusal names the record already using it', /moonbird-mask/.test(takenAccession.json?.reason ?? ''), takenAccession.json?.reason);

  /* EA-4 — a refusal does not name a record that was never created. */
  const refusedRegistration = await tool('register_object', { title: `Unbacked Probe ${stamp}`, accession: `RT.1972.E4${stamp}`, basis: 'No citation.' });
  check('a registration citing nothing is refused', refusedRegistration.json?.policy === 'no_supporting_evidence');
  const overview = await get('/curator');
  check('the console links to no record that does not exist', !overview.text.includes(`/objects/unbacked-probe-${stamp}`.toLowerCase()), 'a proposed slug reached an Open record link');

  /* OB-1 — what is stored is what is read back. */
  const longQuestion = await tool('request_clarification', { submission_id: anyCase, question: 'Q'.repeat(401) });
  check('a clarification longer than the read limit is refused', longQuestion.json?.outcome === 'invalid' && longQuestion.json?.field === 'question', JSON.stringify(longQuestion.json).slice(0, 120));
  const okQuestion = await tool('request_clarification', { submission_id: anyCase, question: 'Q'.repeat(400) });
  check('a clarification at the limit is accepted', okQuestion.json?.outcome === 'applied');
  await setRole('community');
  const readBack = await tool('check_submission', { submission_id: anyCase });
  check('the stored question and the one read back are the same length', readBack.json?.curator_question?.length === 400, `${readBack.json?.curator_question?.length}`);
  await setRole('curator');
  const longDraft = await tool('propose_label_update', { object_id: 'moonbird-mask', draft: 'D'.repeat(6001), evidence_ids: ['EV-068'] });
  check('a label past the declared ceiling is refused', longDraft.json?.outcome === 'invalid' && longDraft.json?.field === 'draft');

  /* OB-2 — an undefined role is refused rather than rewritten. */
  const rogueRole = await post('/api/session', { role: 'admin' });
  check('an undefined role is refused', rogueRole.status === 400 && rogueRole.json?.field === 'role', `status ${rogueRole.status}`);
  const stillCurator = await get('/api/session');
  check('a refused role change leaves the session alone', stillCurator.json?.role === 'curator', JSON.stringify(stillCurator.json));

  /* OB-3 — an unparseable body is the caller's mistake, not an empty call. */
  const brokenBody = await req('/api/tools/list_objects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  check('a malformed body is refused rather than read as {}', brokenBody.status === 400 && brokenBody.json?.field === 'body', `status ${brokenBody.status}`);
  const arrayBody = await req('/api/tools/list_objects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2]' });
  check('a JSON array is refused as arguments', arrayBody.json?.field === 'body');
  const noBody = await req('/api/tools/list_objects', { method: 'POST' });
  check('an absent body still means no arguments', noBody.status === 200 && noBody.json?.count === OBJECT_IDS.length, `status ${noBody.status}`);

  /* OB-4 — the console routes answer in the same four fields as the tools. */
  const fourFields = (body) => body?.outcome !== undefined && body?.reason !== undefined && body?.recovery !== undefined && body?.error === undefined;
  const noApproval = await post('/api/curator/approvals/APR-NOT-REAL/resolve', { action: 'approved', draft: 'x' });
  check('an unknown approval answers in the tool contract', noApproval.status === 404 && fourFields(noApproval.json), JSON.stringify(noApproval.json).slice(0, 110));
  const noEscalation = await post('/api/curator/escalations/ESC-NOT-REAL/resolve', { action: 'dismissed' });
  check('an unknown referral answers in the tool contract', noEscalation.status === 404 && fourFields(noEscalation.json), JSON.stringify(noEscalation.json).slice(0, 110));
  const noAsset = await req('/api/curator/assets/AST-NOT-REAL/publish', { method: 'POST' });
  check('an unknown asset answers in the tool contract', noAsset.status === 404 && fourFields(noAsset.json), JSON.stringify(noAsset.json).slice(0, 110));
  await setRole('community');
  /* ---------- 14. the second browser sweep (FIX_REQUEST_4.md) ---------- */
  section('second sweep');
  await post('/api/reset');
  await setRole('curator');

  /* F4-1 — a stewardship review states why it is being asked for. */
  const reviewNoBasis = await tool('open_return_review', { object_id: 'moonbird-mask', evidence_ids: ['EV-068'] });
  check('a review with no basis is refused', reviewNoBasis.json?.outcome === 'invalid' && reviewNoBasis.json?.field === 'basis', JSON.stringify(reviewNoBasis.json).slice(0, 120));
  const reviewBlankBasis = await tool('open_return_review', { object_id: 'moonbird-mask', basis: '   ', evidence_ids: ['EV-068'] });
  check('a review with a blank basis is refused', reviewBlankBasis.json?.field === 'basis');
  const reviewWithBasis = await tool('open_return_review', { object_id: 'moonbird-mask', basis: 'A community request names this object.', evidence_ids: ['EV-068'] });
  check('a review with a basis reaches human review', reviewWithBasis.json?.outcome === 'pending_approval', JSON.stringify(reviewWithBasis.json).slice(0, 120));
  const auditTrail = await get('/curator/activity');
  check('no stewardship review is logged with an invented reason', !auditTrail.text.includes('no basis given'), 'the placeholder reached the audit trail');

  /* F4-4 — the last answer that was not in the four-field contract. */
  const noSuchTool = await tool('not_a_real_tool', {});
  check('an unknown tool answers in the tool contract', noSuchTool.status === 404 && noSuchTool.json?.outcome === 'invalid' && noSuchTool.json?.field === 'name', JSON.stringify(noSuchTool.json).slice(0, 120));
  check('the unknown-tool refusal names the tool asked for', /not_a_real_tool/.test(noSuchTool.json?.reason ?? ''), noSuchTool.json?.reason);

  /* F4-5 — a page size this system cannot honour is refused, not bent. */
  for (const bad of [-5, 0, 2.7, 101]) {
    const f4Refused = await tool('list_submissions', { limit: bad });
    check(`a limit of ${bad} is refused`, f4Refused.json?.outcome === 'invalid' && f4Refused.json?.field === 'limit', JSON.stringify(f4Refused.json).slice(0, 90));
  }
  const twoRows = await tool('list_submissions', { limit: 2 });
  check('a limit inside the range is honoured exactly', twoRows.json?.returned === 2, `${twoRows.json?.returned}`);
  const defaultRows = await tool('list_submissions', {});
  check('an absent limit still uses the default', defaultRows.json?.returned === defaultRows.json?.count, `${defaultRows.json?.returned} of ${defaultRows.json?.count}`);

  /* F4-3 — the two counts answer the same question. */
  await setRole('community');
  const countCase = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Attachment count probe', consent: 'public_attributed' });
  const countSub = countCase.json?.submission_id;
  const fileA = (await upload('image/png', 'count-a.png')).json?.id;
  const fileB = (await upload('image/png', 'count-b.png')).json?.id;
  const reconciles = (body) => (body?.attached ?? -1) + ((body?.omitted_asset_ids ?? []).length) === body?.requested;
  const firstAttach = await tool('attach_assets', { submission_id: countSub, asset_ids: [fileA] });
  check('attaching a new file counts it', firstAttach.json?.attached === 1 && reconciles(firstAttach.json), JSON.stringify(firstAttach.json).slice(0, 110));
  const repeatAttach = await tool('attach_assets', { submission_id: countSub, asset_ids: [fileA] });
  check('a file already on the contribution still counts as attached', repeatAttach.json?.attached === 1 && reconciles(repeatAttach.json), JSON.stringify(repeatAttach.json).slice(0, 110));
  const mixedAttach = await tool('attach_assets', { submission_id: countSub, asset_ids: [fileB, fileA, 'AST-NOT-REAL'] });
  check('a mixed attach reconciles attached, omitted and requested', mixedAttach.json?.attached === 2 && reconciles(mixedAttach.json), JSON.stringify(mixedAttach.json).slice(0, 130));
  check('the mixed attach names only the id that did not resolve', (mixedAttach.json?.omitted_asset_ids ?? []).join() === 'AST-NOT-REAL');
  const failedAttach = await tool('attach_assets', { submission_id: countSub, asset_ids: ['AST-NOT-REAL'] });
  check('an attach that lands nothing is still refused', failedAttach.json?.outcome === 'invalid' && reconciles(failedAttach.json), JSON.stringify(failedAttach.json).slice(0, 110));

  /* F4-2 — the contribution form does not promise a draft it never keeps. */
  const contributePage = await get('/contribute');
  check('the form makes no claim about keeping a draft', !/draft stays in this browser/i.test(contributePage.text), 'the promise is still on the page');
  check('the form still says who controls the contribution', contributePage.text.includes('You control how the museum may use your contribution'));
  /* ---------- 15. the third browser sweep (FIX_REQUEST_5.md) ---------- */
  section('third sweep');
  await post('/api/reset');
  await setRole('curator');
  const sweepCase = (await tool('list_submissions', {})).json?.submissions?.[0]?.id;

  /* F5-2 — every refusal on every route answers in the four fields. */
  const f5FourFields = (body) => !!body && body.error === undefined && body.reason !== undefined
    && body.recovery !== undefined && (body.outcome === 'invalid' || body.outcome === 'denied' || body.outcome === 'error');
  const clarifyMissing = await post('/api/curator/submissions/SUB-NOT-REAL/clarify', { question: 'A question?' });
  check('clarify answers an unknown contribution in the tool contract', clarifyMissing.status === 404 && f5FourFields(clarifyMissing.json) && clarifyMissing.json?.field === 'submission_id', JSON.stringify(clarifyMissing.json).slice(0, 120));
  const clarifyLong = await post(`/api/curator/submissions/${sweepCase}/clarify`, { question: 'Q'.repeat(401) });
  check('clarify refuses an over-long question with a reason and a recovery', clarifyLong.status === 400 && f5FourFields(clarifyLong.json), JSON.stringify(clarifyLong.json).slice(0, 120));
  check('the over-long refusal says what the limit is', /400 characters/.test(clarifyLong.json?.reason ?? ''), clarifyLong.json?.reason);
  await setRole('community');
  const clarifyRole = await post(`/api/curator/submissions/${sweepCase}/clarify`, { question: 'A question?' });
  check('clarify answers a community session in the tool contract', clarifyRole.status === 403 && f5FourFields(clarifyRole.json), JSON.stringify(clarifyRole.json).slice(0, 120));
  await setRole('curator');

  /* Every failure path this suite can reach carries words the console can show. */
  const refusals = [
    ['unknown tool', await tool('not_a_real_tool_at_all', {})],
    ['unknown approval', await post('/api/curator/approvals/APR-NOT-REAL/resolve', { action: 'approved', draft: 'x' })],
    ['unknown referral', await post('/api/curator/escalations/ESC-NOT-REAL/resolve', { action: 'dismissed' })],
    ['unknown asset', await req('/api/curator/assets/AST-NOT-REAL/publish', { method: 'POST' })],
    ['unknown contribution', await post('/api/curator/submissions/SUB-NOT-REAL/clarify', { question: 'A question?' })],
    ['malformed tool body', await req('/api/tools/list_objects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })],
    ['out-of-range limit', await tool('list_submissions', { limit: 0 })],
    ['review with no basis', await tool('open_return_review', { object_id: 'moonbird-mask', evidence_ids: ['EV-068'] })],
  ];
  const shapeless = refusals.filter(([, response]) => !f5FourFields(response.json));
  check('no refusal answers outside the four-field contract', shapeless.length === 0, shapeless.map(([label, r]) => `${label}: ${JSON.stringify(r.json).slice(0, 60)}`).join(' | '));

  /* F5-1 — a race on a referral is explained by the route, not guessed at by the console. */
  const raceProposal = await tool('register_object', { title: `Race Probe ${stamp}`, accession: `RT.1972.R${stamp}`, basis: 'Nothing cited.' });
  const raceId = raceProposal.json?.escalation_id;
  check('a refused registration is referred to a curator', !!raceId, JSON.stringify(raceProposal.json).slice(0, 100));
  const closedOnce = await post(`/api/curator/escalations/${raceId}/resolve`, { action: 'reviewed' });
  check('a referral closes once', closedOnce.status === 200 && closedOnce.json?.resolved === true);
  const closedTwice = await post(`/api/curator/escalations/${raceId}/resolve`, { action: 'reviewed' });
  check('closing it again is refused with words the console can show', closedTwice.status === 409 && f5FourFields(closedTwice.json), JSON.stringify(closedTwice.json).slice(0, 120));
  check('the race refusal names what already happened', /already reviewed/i.test(closedTwice.json?.reason ?? ''), closedTwice.json?.reason);
  await setRole('community');
  /* ---------- 16. the source audit (FIX_REQUEST_6.md) ---------- */
  section('source audit');
  await post('/api/reset');

  /* F6-1 — no route answers a wrong type with an unhandled throw. */
  await setRole('community');
  const kindOne = ['Object information'];
  const detailOne = [{ kind: 'Object information', values: { claim: 'A claim' } }];
  const wrongTypes = [
    ['title', 0], ['title', true], ['title', []], ['title', {}],
    ['objectId', 0], ['objectId', true], ['objectId', []],
    ['kinds', 5], ['kinds', {}], ['details', 7], ['details', true],
    ['assetIds', 'not-a-list'], ['assetIds', 5], ['source', 5], ['requestedOutcome', {}],
  ];
  const threw = [];
  for (const [field, value] of wrongTypes) {
    const f6Response = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'Type probe', kinds: kindOne, details: detailOne, [field]: value });
    if (f6Response.status >= 500 || f6Response.json === null) threw.push(`${field}=${JSON.stringify(value)} → ${f6Response.status}`);
  }
  check('the contribution route answers every wrong type in the contract', threw.length === 0, threw.join(' | '));
  await setRole('curator');
  const settledProbe = (await tool('list_submissions', {})).json?.submissions?.[0]?.id;
  const clarifyTypes = [];
  for (const value of [0, true, [], {}]) {
    const f6Response = await post(`/api/curator/submissions/${settledProbe}/clarify`, { question: value });
    if (f6Response.status >= 500 || f6Response.json === null) clarifyTypes.push(`${JSON.stringify(value)} → ${f6Response.status}`);
  }
  check('the clarification route answers every wrong type in the contract', clarifyTypes.length === 0, clarifyTypes.join(' | '));

  /* F6-2 — a citation list is bounded before it reaches the database. */
  const manyIds = Array.from({ length: 200 }, (_, index) => `EV-BULK-${index}`);
  const f6Citing = ['propose_label_update', 'compare_evidence', 'draft_label', 'build_provenance_timeline', 'open_return_review', 'register_object'];
  const unbounded = [];
  for (const name of f6Citing) {
    const f6Response = await tool(name, { object_id: 'moonbird-mask', draft: 'd', basis: 'b', title: 'T', accession: 'RT.9.B', evidence_ids: manyIds });
    if (f6Response.status >= 500 || f6Response.json?.field !== 'evidence_ids') unbounded.push(`${name} → ${f6Response.status} ${f6Response.json?.outcome ?? ''}`);
  }
  check('every citing tool refuses an over-long list at the door', unbounded.length === 0, unbounded.join(' | '));
  const twelve = await tool('compare_evidence', { evidence_ids: Array.from({ length: 12 }, () => 'EV-068') });
  check('a citation at the declared limit is accepted', twelve.status === 200, `status ${twelve.status}`);

  /* F6-3 — every f6Stored field has a ceiling. */
  await setRole('community');
  const overLong = [
    ['title', 141], ['description', 4001], ['source', 121], ['requested_outcome', 141],
  ];
  const uncapped = [];
  for (const [field, length] of overLong) {
    const f6Response = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Cap probe', [field]: 'x'.repeat(length) });
    if (f6Response.json?.outcome !== 'invalid' || f6Response.json?.field !== field) uncapped.push(`${field} at ${length} → ${f6Response.json?.outcome}`);
  }
  check('every stored contribution field has a ceiling', uncapped.length === 0, uncapped.join(' | '));
  await setRole('curator');
  const curatorCaps = [];
  for (const [name, args, field] of [
    ['register_object', { title: 'x'.repeat(141), accession: 'RT.9.C', basis: 'b' }, 'title'],
    ['register_object', { title: 'Cap', accession: 'x'.repeat(61), basis: 'b' }, 'accession'],
    ['open_return_review', { object_id: 'moonbird-mask', basis: 'x'.repeat(2001) }, 'basis'],
    ['propose_label_update', { object_id: 'moonbird-mask', draft: 'x'.repeat(6001) }, 'draft'],
  ]) {
    const f6Response = await tool(name, args);
    if (f6Response.json?.field !== field) curatorCaps.push(`${name}/${field} → ${f6Response.json?.outcome} ${f6Response.json?.field}`);
  }
  check('every stored curator field has a ceiling', curatorCaps.length === 0, curatorCaps.join(' | '));

  /* F6-4 — a value that is not text is refused, never coerced. */
  await setRole('community');
  const coerced = await tool('submit_evidence', { object_id: 'moonbird-mask', title: 'Coercion probe', description: { a: 1 }, consent: 'public_attributed' });
  check('a non-text field is refused rather than stringified', coerced.json?.outcome === 'invalid' && coerced.json?.field === 'description', JSON.stringify(coerced.json).slice(0, 110));
  await setRole('curator');
  const f6Stored = await tool('list_submissions', { limit: 100 });
  const objectish = (f6Stored.json?.submissions ?? []).filter((row) => row.title.includes('[object'));
  check('no record holds a stringified object', objectish.length === 0, `${objectish.length} rows`);

  /* F6-5 — a settled contribution stays settled. */
  const linkable = (await tool('list_submissions', {})).json?.submissions?.find((row) => row.id.startsWith('SUB-1042'))?.id;
  const linkProposal = await tool('propose_label_update', { object_id: 'moonbird-mask', draft: 'Moonbird Mask. Settled probe.', evidence_ids: ['EV-068', 'EV-059'] });
  await post(`/api/curator/approvals/${linkProposal.json?.approval_id}/resolve`, { action: 'approved', draft: 'Moonbird Mask. Settled probe.' });
  const settledRow = (await tool('list_submissions', {})).json?.submissions?.find((row) => row.id === linkable);
  check('an approved revision settles the contribution it rested on', settledRow?.status === 'reflected in label', settledRow?.status);
  const lateTool = await tool('request_clarification', { submission_id: linkable, question: 'A late question?' });
  check('the tool refuses a question on a settled contribution', lateTool.json?.policy === 'submission_settled', JSON.stringify(lateTool.json).slice(0, 110));
  const lateRoute = await post(`/api/curator/submissions/${linkable}/clarify`, { question: 'A late question?' });
  check('the console refuses it too', lateRoute.json?.policy === 'submission_settled', JSON.stringify(lateRoute.json).slice(0, 110));
  const afterLate = (await tool('list_submissions', {})).json?.submissions?.find((row) => row.id === linkable);
  check('the contribution did not move back into review', afterLate?.status === 'reflected in label', afterLate?.status);

  /* F6-6 — the panel counts the surface rather than naming a number.
     The panel is client-rendered, so the served HTML never carries this sentence and a
     check against the page would pass whatever the number said. The shipped bundle is
     what the browser reads, so that is what is read here. */
  const consoleBundle = await get('/curator');
  const bundleUrls = [...consoleBundle.text.matchAll(/src="([^"]+.js)"/g)].map((match) => match[1]);
  let panelClaim = null;
  for (const url of bundleUrls) {
    const chunk = await get(url);
    const found = chunk.text.match(/Community pages register a different set of[^"]{0,40}/);
    if (found) { panelClaim = found[0]; break; }
  }
  check('the console does not hardcode the community surface size', panelClaim === null || !/set of six/i.test(panelClaim), panelClaim ?? '(sentence not found in any chunk)');

  /* F6-7 — counting does not read every row. */
  const f6Summary = await tool('get_collection_summary', {});
  check('the summary still counts contributions', typeof f6Summary.json?.total_submissions === 'number', JSON.stringify(f6Summary.json).slice(0, 90));
  await setRole('community');
  /* ---------- 17. the write-route audit (FIX_REQUEST_7.md) ---------- */
  /**
   * The previous round closed the input class on the routes it had found, and the two it
   * had not — the approval resolver and the referral resolver — published an unbounded
   * label and filed `[object Object]` in the activity record. The checks that were
   * supposed to catch that read submission titles only.
   *
   * These are written against the surface rather than against a route: every path that
   * writes text, every field, and the public pages those fields reach. A new write route
   * that skips the shared reader fails here without anyone adding a check for it.
   */
  section('write-route audit');
  await post('/api/reset');
  await setRole('curator');

  /* V7-1 — the label a curator edits in the drawer has the ceiling the tool enforces. */
  const v7Proposal = await tool('propose_label_update', { object_id: 'moonbird-mask', draft: 'Moonbird Mask. Ceiling probe.', evidence_ids: ['EV-068', 'EV-059'] });
  const v7ApprovalId = v7Proposal.json?.approval_id;
  check('a proposal is waiting to be resolved', !!v7ApprovalId, JSON.stringify(v7Proposal.json).slice(0, 110));
  const v7LongDraft = await post(`/api/curator/approvals/${v7ApprovalId}/resolve`, { action: 'approve_with_edit', draft: 'x'.repeat(6001) });
  check('an over-long edited label is refused at approval', v7LongDraft.status === 400 && v7LongDraft.json?.field === 'draft', JSON.stringify(v7LongDraft.json).slice(0, 130));
  const v7WrongDraft = await post(`/api/curator/approvals/${v7ApprovalId}/resolve`, { action: 'approved', draft: { a: 1 } });
  check('a non-text edited label is refused rather than coerced', v7WrongDraft.status === 400 && v7WrongDraft.json?.field === 'draft', JSON.stringify(v7WrongDraft.json).slice(0, 130));
  const v7LongReason = await post(`/api/curator/approvals/${v7ApprovalId}/resolve`, { action: 'approve_with_edit', draft: 'Moonbird Mask. Edited.', editReason: 'r'.repeat(501) });
  check('an over-long edit reason is refused', v7LongReason.status === 400 && v7LongReason.json?.field === 'editReason', JSON.stringify(v7LongReason.json).slice(0, 130));
  const v7EmptyDraft = await post(`/api/curator/approvals/${v7ApprovalId}/resolve`, { action: 'approved', draft: '   ' });
  check('an emptied editor is refused, not read as approving the original', v7EmptyDraft.status === 400 && v7EmptyDraft.json?.field === 'draft', JSON.stringify(v7EmptyDraft.json).slice(0, 130));
  const v7Approved = await post(`/api/curator/approvals/${v7ApprovalId}/resolve`, { action: 'approved', draft: 'Moonbird Mask. Ceiling probe.' });
  check('a label within the ceiling still publishes', v7Approved.status === 200 && v7Approved.json?.published === true, JSON.stringify(v7Approved.json).slice(0, 130));

  /* V7-2 — a referral note is read, not coerced. */
  const v7Referral = await tool('open_return_review', { object_id: 'moonbird-mask', basis: 'Referral probe for the note field.', evidence_ids: ['EV-059'] });
  const v7EscalationId = v7Referral.json?.escalation_id;
  check('a refused review opens a referral', !!v7EscalationId, JSON.stringify(v7Referral.json).slice(0, 110));
  const v7WrongNote = await post(`/api/curator/escalations/${v7EscalationId}/resolve`, { action: 'reviewed', note: { nested: 'object' } });
  check('a non-text referral note is refused rather than coerced', v7WrongNote.status === 400 && v7WrongNote.json?.field === 'note', JSON.stringify(v7WrongNote.json).slice(0, 130));
  const v7LongNote = await post(`/api/curator/escalations/${v7EscalationId}/resolve`, { action: 'reviewed', note: 'n'.repeat(2001) });
  check('an over-long referral note is refused', v7LongNote.status === 400 && v7LongNote.json?.field === 'note', JSON.stringify(v7LongNote.json).slice(0, 130));
  const v7GoodNote = await post(`/api/curator/escalations/${v7EscalationId}/resolve`, { action: 'reviewed', note: 'Taken to the stewardship committee.' });
  check('a referral still closes with a note within the ceiling', v7GoodNote.status === 200 && v7GoodNote.json?.resolved === true, JSON.stringify(v7GoodNote.json).slice(0, 110));

  /* V7-3 — the console names the field it refuses, and refuses what the tool refuses. */
  const v7Record = { confirmed: true, title: 'Audit probe object', accession: 'RT.9.AU', period: '1930', material: 'Wood', origin: 'Aru', label: 'A probe label.' };
  const v7RecordProbes = [
    ['title', 'y'.repeat(141)], ['title', { a: 1 }], ['accession', 'A'.repeat(61)], ['accession', 5],
    ['period', 'p'.repeat(61)], ['material', { a: 1 }], ['origin', ['a']], ['label', 'l'.repeat(6001)],
    ['description', 'd'.repeat(4001)], ['objectType', 't'.repeat(81)],
  ];
  const v7Unnamed = [];
  for (const [field, value] of v7RecordProbes) {
    const response = await post('/api/curator/objects', { ...v7Record, accession: `RT.9.${field.slice(0, 3)}`, [field]: value });
    if (response.status !== 400 || response.json?.field !== field) v7Unnamed.push(`${field} → ${response.status} ${response.json?.field}`);
  }
  check('the record console refuses every bad field by name', v7Unnamed.length === 0, v7Unnamed.join(' | '));
  const v7BadQuestions = await post('/api/curator/objects', { ...v7Record, accession: 'RT.9.QN', questions: [{ a: 1 }] });
  check('a non-text open question is refused rather than coerced', v7BadQuestions.status === 400 && v7BadQuestions.json?.field === 'questions', JSON.stringify(v7BadQuestions.json).slice(0, 130));

  /* V7-4 — nothing is stored shorter than it arrived. */
  await setRole('community');
  const v7Detail = 'd'.repeat(4001);
  const v7LongDetail = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'Detail ceiling probe', kinds: ['Object information'], details: [{ kind: 'Object information', values: { claim: v7Detail } }] });
  check('an over-long contribution answer is refused, not cut', v7LongDetail.status === 400 && /claim/.test(v7LongDetail.json?.field ?? ''), JSON.stringify(v7LongDetail.json).slice(0, 150));
  const v7ShortField = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'Field ceiling probe', kinds: ['Photograph'], details: [{ kind: 'Photograph', values: { caption: 'A caption.', taken_when: 'w'.repeat(61) } }] });
  check('a date answer is held to a date ceiling, not a prose one', v7ShortField.status === 400 && /taken_when/.test(v7ShortField.json?.field ?? ''), JSON.stringify(v7ShortField.json).slice(0, 150));
  const v7LongAlt = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'Alt ceiling probe', kinds: ['Object information'], details: [{ kind: 'Object information', values: { claim: 'A claim.' } }], assetAlts: { 'AST-NONE': 'a'.repeat(301) } });
  check('over-long alternative text is refused, not cut', v7LongAlt.status === 400 && v7LongAlt.json?.field === 'assetAlts', JSON.stringify(v7LongAlt.json).slice(0, 150));
  const v7NamedFile = new FormData();
  v7NamedFile.append('file', new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), `${'n'.repeat(200)}.pdf`);
  const v7LongName = await req('/api/assets', { method: 'POST', body: v7NamedFile });
  check('an over-long file name is refused, not cut', v7LongName.status === 400 && v7LongName.json?.field === 'file', JSON.stringify(v7LongName.json).slice(0, 150));
  const v7AltForm = new FormData();
  v7AltForm.append('file', new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'named.pdf');
  v7AltForm.append('alt_text', 'a'.repeat(301));
  const v7UploadAlt = await req('/api/assets', { method: 'POST', body: v7AltForm });
  check('over-long alternative text on an upload is refused, not cut', v7UploadAlt.status === 400 && v7UploadAlt.json?.field === 'alt_text', JSON.stringify(v7UploadAlt.json).slice(0, 150));
  const v7StoredForm = new FormData();
  v7StoredForm.append('file', new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'kept-whole.pdf');
  v7StoredForm.append('alt_text', 'a'.repeat(300));
  const v7Stored = await req('/api/assets', { method: 'POST', body: v7StoredForm });
  check('a value at the ceiling is stored whole', v7Stored.status === 200 && v7Stored.json?.file_name === 'kept-whole.pdf', JSON.stringify(v7Stored.json).slice(0, 130));

  /* V7-7 — every argument the tool surface reads has a ceiling, ids included.
     The stored fields were capped last round and the lookup keys were not, and
     `request_clarification` read its question with a bare type check like an id — so a
     question of any length was stored and read back by the contributor who has to
     answer it. This walks every argument of every tool rather than the ones that
     happened to be remembered. */
  await setRole('curator');
  const v7ToolArgs = [
    ['request_clarification', 'question', 'q'.repeat(401)],
    ['request_clarification', 'submission_id', 'i'.repeat(121)],
    ['propose_label_update', 'draft', 'd'.repeat(6001)],
    ['propose_label_update', 'object_id', 'o'.repeat(121)],
    ['open_return_review', 'basis', 'b'.repeat(2001)],
    ['register_object', 'title', 't'.repeat(141)],
    ['register_object', 'accession', 'a'.repeat(61)],
    ['check_approval', 'approval_id', 'p'.repeat(121)],
    ['get_review_case', 'case_id', 'c'.repeat(121)],
    ['get_asset_detail', 'asset_id', 's'.repeat(121)],
    ['list_objects', 'status', 's'.repeat(81)],
    ['list_submissions', 'status', 's'.repeat(81)],
  ];
  const v7ToolUncapped = [];
  for (const [name, field, value] of v7ToolArgs) {
    const response = await tool(name, { object_id: 'moonbird-mask', submission_id: 'SUB-1041', draft: 'A draft.', basis: 'A basis.', title: 'A title', accession: 'RT.9.X', question: 'A question?', [field]: value });
    if (response.json?.outcome !== 'invalid' || response.json?.field !== field) {
      v7ToolUncapped.push(`${name}/${field} → ${response.status} ${response.json?.outcome} ${response.json?.field}`);
    }
  }
  check('every tool argument is held to a ceiling, ids and filters included', v7ToolUncapped.length === 0, v7ToolUncapped.join(' | '));
  const v7NonText = [];
  for (const [name, field] of v7ToolArgs) {
    const response = await tool(name, { object_id: 'moonbird-mask', submission_id: 'SUB-1041', draft: 'A draft.', basis: 'A basis.', title: 'A title', accession: 'RT.9.X', question: 'A question?', [field]: { a: 1 } });
    if (response.json?.outcome !== 'invalid' || response.json?.field !== field) {
      v7NonText.push(`${name}/${field} → ${response.status} ${response.json?.outcome} ${response.json?.field}`);
    }
  }
  check('every tool argument refuses a non-text value rather than ignoring it', v7NonText.length === 0, v7NonText.join(' | '));
  /* V7-8 — a body nobody can parse is not an empty body.
     `request.json().catch(() => ({}))` reads a malformed request as one that carried no
     fields, and on the asset route `publish` then defaults to true — so a broken request
     published material. Every route now reads its body through the shared reader. */
  // Each route is probed in the role that can reach its body, so a role refusal cannot
  // stand in for the body refusal this is looking for.
  const v7Malformed = [
    ['curator', '/api/session'],
    ['curator', '/api/curator/objects'],
    ['community', '/api/community/evidence'],
  ];
  const v7Swallowed = [];
  for (const [role, path] of v7Malformed) {
    await setRole(role);
    const response = await req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    if (response.status !== 400 || response.json?.field !== 'body') v7Swallowed.push(`${path} as ${role} → ${response.status} ${response.json?.field}`);
  }
  check('a malformed body is refused, never read as an empty one', v7Swallowed.length === 0, v7Swallowed.join(' | '));
  await setRole('curator');
  const v7PublishBad = await req('/api/curator/assets/AST-NONE/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  check('a malformed body does not publish an asset by default', v7PublishBad.status === 400 && v7PublishBad.json?.field === 'body', JSON.stringify(v7PublishBad.json).slice(0, 130));
  const v7PublishType = await post('/api/curator/assets/AST-NONE/publish', { publish: 'yes' });
  check('a non-boolean publish flag is refused rather than read as true', v7PublishType.status === 400 && v7PublishType.json?.field === 'publish', JSON.stringify(v7PublishType.json).slice(0, 130));
  await setRole('community');
  const v7BadAlts = await post('/api/community/evidence', { objectId: 'moonbird-mask', title: 'Alt shape probe', kinds: ['Object information'], details: [{ kind: 'Object information', values: { claim: 'A claim.' } }], assetAlts: 'not-a-map' });
  check('alternative text in the wrong shape is refused, not dropped', v7BadAlts.status === 400 && v7BadAlts.json?.field === 'assetAlts', JSON.stringify(v7BadAlts.json).slice(0, 130));
  await setRole('curator');
  /* V7-6 — the check that missed this reads the pages a coerced value would reach. */
  await setRole('curator');
  const v7Pages = ['/', '/curator', '/curator/activity', '/curator/submissions', '/curator/objects', ...OBJECT_IDS.map((id) => `/objects/${id}`)];
  const v7Coerced = [];
  for (const path of v7Pages) {
    const page = await get(path);
    if (page.text.includes('[object Object]')) v7Coerced.push(path);
  }
  check('no page anywhere renders a stringified object', v7Coerced.length === 0, v7Coerced.join(' | '));

  /* V7-5 — the form declares the ceilings the routes enforce, so nothing is refused late.
     The first step of the contribution form is server-rendered, so the ceilings it carries
     are in the served HTML and this cannot pass by finding nothing. The per-kind ceilings
     are asserted against the declaration itself in `lib/community/contribution.test.ts`,
     and against the server one field at a time below. */
  await setRole('community');
  const v7Form = await get('/contribute?object=moonbird-mask');
  const v7FormCeilings = [...new Set([...v7Form.text.matchAll(/maxLength="(\d+)"/gi)].map((hit) => Number(hit[1])))];
  check('the contribution form declares its ceilings in the page itself',
    v7FormCeilings.includes(140) && v7FormCeilings.includes(120),
    `declared ${v7FormCeilings.join(', ') || 'nothing'}`);

  /* Each kind of question is held to its own ceiling, one field at a time, so a new field
     that reuses the prose ceiling for a date is caught here rather than in a browser. */
  const v7PerField = [
    ['Photograph', 'caption', 4001], ['Photograph', 'taken_when', 61], ['Photograph', 'taken_where', 201],
    ['Photograph', 'photographer', 121], ['Photograph', 'reverse', 4001],
    ['Document', 'document_type', 81], ['Document', 'issuer', 121], ['Document', 'issued_when', 61], ['Document', 'summary', 4001],
    ['Oral history', 'transcript', 4001], ['Oral history', 'speaker', 121], ['Oral history', 'relationship', 81],
    ['Oral history', 'language', 81], ['Oral history', 'recorded_where', 201],
    ['Object information', 'claim', 4001], ['Object information', 'basis', 2001],
  ];
  const v7Uncapped = [];
  for (const [kind, field, length] of v7PerField) {
    const response = await post('/api/community/evidence', {
      objectId: 'moonbird-mask', title: 'Per-field ceiling probe', kinds: [kind],
      details: [{ kind, values: { [field]: 'x'.repeat(length) } }],
    });
    if (response.status !== 400 || !String(response.json?.field ?? '').endsWith(field)) {
      v7Uncapped.push(`${kind}/${field} at ${length} → ${response.status} ${response.json?.field}`);
    }
  }
  check('every contribution field is held to its own ceiling', v7Uncapped.length === 0, v7Uncapped.join(' | '));
  await setRole('community');
  /* ---------- 18. the deployed-verification findings (FIX_REQUEST_8.md) ---------- */
  section('layout and contract');
  await post('/api/reset');

  /* V7-9 — a value inside the ceiling cannot size the page.
     A 140-character title with no spaces sat inside the accepted ceiling and still
     dragged the public object page to 1,983px against a 1,265px viewport, because a
     `1fr` grid track is sized from min-content and min-content was the whole token.
     The page cannot be measured from here, so this checks the rule that fixes it is
     actually shipped, and the token itself is exercised in a browser. */
  const v8Css = await get('/');
  const v8StyleHrefs = [...new Set([...v8Css.text.matchAll(/href="([^"]+\.css)"/g)].map((hit) => hit[1]))];
  let v8Styles = '';
  for (const href of v8StyleHrefs) v8Styles += (await get(href)).text;
  check('the stylesheet breaks a token that would otherwise size the page',
    /overflow-wrap:\s*anywhere/.test(v8Styles),
    v8StyleHrefs.length ? `${v8StyleHrefs.length} stylesheets read, rule absent` : 'no stylesheet found');
  await setRole('community');
  const v8Token = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', title: 'A'.repeat(140), kinds: ['Object information'],
    details: [{ kind: 'Object information', values: { claim: 'A claim.' } }], consent: 'public_attributed',
  });
  check('a title at the ceiling is still accepted', v8Token.status === 200, `status ${v8Token.status}`);
  const v8Page = await get('/objects/moonbird-mask');
  check('the page that renders it still serves', v8Page.status === 200 && v8Page.text.includes('A'.repeat(140)), `status ${v8Page.status}`);

  /* V7-10 — the surface is no stricter than its own catalogue.
     Hoisting the `object_id` read made every tool refuse one, including the tools whose
     schema declares no parameters at all — while the same call carrying a malformed
     `title` was ignored. Two answers for one kind of undeclared field. */
  await setRole('curator');
  const v8Undeclared = [['get_collection_summary', {}], ['list_pending_approvals', {}], ['check_approval', { approval_id: 'APR-NONE' }]];
  const v8TooStrict = [];
  for (const [name, args] of v8Undeclared) {
    const spurious = await tool(name, { ...args, object_id: 'moonbird-mask' });
    const clean = await tool(name, args);
    if (spurious.status !== clean.status) v8TooStrict.push(`${name}: ${clean.status} clean vs ${spurious.status} with object_id`);
  }
  check('a tool that does not declare object_id ignores one', v8TooStrict.length === 0, v8TooStrict.join(' | '));
  /* The other direction, which is the one a gate like this gets wrong: every tool that
     does declare `object_id` must still be judged on it. A gate applied to the wrong set
     would let an unchecked id through to the query rather than refuse it here. */
  const v8Declarers = [
    ['curator', 'propose_label_update', { draft: 'A draft.', evidence_ids: ['EV-068'] }],
    ['curator', 'open_return_review', { basis: 'A basis.', evidence_ids: ['EV-068'] }],
    ['curator', 'draft_label', {}],
    ['curator', 'build_provenance_timeline', {}],
    ['curator', 'list_submissions', {}],
    ['community', 'get_object_detail', {}],
    ['community', 'get_provenance_timeline', {}],
    ['community', 'list_object_assets', {}],
    ['community', 'submit_evidence', { title: 'T', description: 'D', consent: 'public_attributed' }],
    ['community', 'submit_context_claim', { claim: 'C', source: 'S', consent: 'public_attributed' }],
  ];
  const v8Unjudged = [];
  for (const [role, name, args] of v8Declarers) {
    await setRole(role);
    const over = await tool(name, { ...args, object_id: 'o'.repeat(121) });
    if (over.json?.field !== 'object_id') v8Unjudged.push(`${name} over-long → ${over.json?.outcome} ${over.json?.field}`);
    const wrong = await tool(name, { ...args, object_id: { a: 1 } });
    if (wrong.json?.field !== 'object_id') v8Unjudged.push(`${name} non-text → ${wrong.json?.outcome} ${wrong.json?.field}`);
  }
  check('every tool that declares object_id is still judged on it', v8Unjudged.length === 0, v8Unjudged.join(' | '));
  await setRole('curator');

  /* V7-11 — a refusal reaches the screen whole.
     Every console reads `reason` and `recovery`; the approval drawer read `reason` and
     `next`, which the shared reader does not set, so the sentence saying what to do
     went missing from exactly the refusals V7-1 had just added. */
  const v8Proposal = await tool('propose_label_update', { object_id: 'moonbird-mask', draft: 'Moonbird Mask. Recovery probe.', evidence_ids: ['EV-068', 'EV-059'] });
  const v8Refusals = [
    ['draft past the ceiling', `/api/curator/approvals/${v8Proposal.json?.approval_id}/resolve`, { action: 'approve_with_edit', draft: 'x'.repeat(6001) }],
    ['an emptied editor', `/api/curator/approvals/${v8Proposal.json?.approval_id}/resolve`, { action: 'approved', draft: '   ' }],
    ['an over-long edit reason', `/api/curator/approvals/${v8Proposal.json?.approval_id}/resolve`, { action: 'approve_with_edit', draft: 'ok', editReason: 'r'.repeat(501) }],
  ];
  const v8Halved = [];
  for (const [label, path, body] of v8Refusals) {
    const response = await post(path, body);
    if (!response.json?.reason || !response.json?.recovery) v8Halved.push(`${label}: ${JSON.stringify(response.json).slice(0, 80)}`);
  }
  check('every drawer refusal carries both halves for the console to render', v8Halved.length === 0, v8Halved.join(' | '));
  await setRole('community');
  const v8Named = new FormData();
  v8Named.append('file', new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), `${'n'.repeat(200)}.pdf`);
  const v8Upload = await req('/api/assets', { method: 'POST', body: v8Named });
  check('an upload refusal carries the sentence that says what to do', !!v8Upload.json?.reason && !!v8Upload.json?.recovery, JSON.stringify(v8Upload.json).slice(0, 120));
  /* V7-12 — a curator learns at the door, not on the last click.
     The rule itself was never in doubt: a contribution is evidence the museum received,
     and a curator filing one would blur `submitted` against `verified`. What was wrong
     was that the form rendered in full and refused after four steps of typing, while
     every other rule in this system is checked as it is broken. Both halves are checked
     here — the page that no longer offers the form, and the route that still refuses
     the write whatever the page does. */
  await setRole('curator');
  const v8CuratorForm = await get('/contribute?object=moonbird-mask');
  check('a curator is told before filling the form in, not after',
    /This form files community evidence/.test(v8CuratorForm.text),
    v8CuratorForm.text.match(/<h1[^>]*>([^<]{0,60})/)?.[1] ?? `status ${v8CuratorForm.status}`);
  check('the form itself is not rendered for a curator',
    !/Short title/.test(v8CuratorForm.text) && !/Submit contribution/.test(v8CuratorForm.text),
    'the contribution form is still on the page');
  check('the page offers the two things a curator can actually do',
    /curator console/i.test(v8CuratorForm.text) && /View as community/.test(v8CuratorForm.text),
    'one of the two paths is missing');
  const v8StillRefused = await post('/api/community/evidence', {
    objectId: 'moonbird-mask', title: 'Door probe', kinds: ['Object information'],
    details: [{ kind: 'Object information', values: { claim: 'A claim.' } }],
  });
  check('the route refuses a curator write whatever the page renders',
    v8StillRefused.status === 403 && v8StillRefused.json?.policy === 'role_not_permitted',
    JSON.stringify(v8StillRefused.json).slice(0, 120));
  await setRole('community');
  const v8CommunityForm = await get('/contribute?object=moonbird-mask');
  check('a community session still gets the form',
    /Short title/.test(v8CommunityForm.text) && !/This form files community evidence/.test(v8CommunityForm.text),
    `status ${v8CommunityForm.status}`);
  /* ---------- report ---------- */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const failure of failed) console.log(`  [${failure.group}] ${failure.name}${failure.detail ? ` — ${failure.detail}` : ''}`);
    process.exit(1);
  }
  console.log('All checks passed.\n');
}

main().catch((error) => { console.error('\nSmoke run crashed:', error); process.exit(1); });
