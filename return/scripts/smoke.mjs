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

const COMMUNITY_TOOLS = ['search_collection', 'get_object_detail', 'get_provenance_timeline', 'submit_evidence', 'submit_context_claim', 'check_submission'];
const CURATOR_TOOLS = ['get_collection_summary', 'list_objects', 'list_submissions', 'get_review_case', 'build_provenance_timeline', 'compare_evidence', 'draft_label', 'request_clarification', 'propose_label_update', 'open_return_review', 'check_approval', 'list_pending_approvals'];

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

  const landing = await get('/');
  check('landing lists all 8 objects', OBJECT_IDS.every((id) => landing.text.includes(`/objects/${id}`)));
  check('landing has no dead "#" object links', !/href="#"[^>]*class="object-row"/.test(landing.text));

  /* ---------- 2. role boundary ---------- */
  section('role boundary');
  check('session switches to community', await setRole('community'));
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

  const claim = await tool('submit_context_claim', { object_id: 'riverstone-vessel', claim: 'Smoke test claim', source: 'Verification run', consent: 'research_only' });
  check('submit_context_claim persists', claim.status === 200 && !!claim.json.submission_id);

  const checked = await tool('check_submission', { submission_id: submissionId });
  check('check_submission reads it back', checked.status === 200 && checked.json.id === submissionId);
  const missing = await tool('check_submission', { submission_id: 'SUB-000' });
  check('check_submission rejects an unknown id', missing.status === 400);

  /* ---------- 4. the record loop ---------- */
  section('community to curator loop');
  check('session switches to curator', await setRole('curator'));
  const inbox = await tool('list_submissions', {});
  check('curator inbox contains the new contribution', inbox.status === 200 && inbox.json.submissions.some((s) => s.id === submissionId));
  check('list_submissions is flagged as external content', inbox.json?.untrusted_content === true);
  const restricted = inbox.json?.submissions?.find((s) => s.consent === 'research_only');
  check('research_only bodies are withheld from tool output', !!restricted && restricted.description === null && restricted.quotable === false);

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
  const compare = await tool('compare_evidence', { evidence_ids: [submissionId] });
  check('compare_evidence separates conflicts and questions', compare.status === 200 && Array.isArray(compare.json.conflicts) && Array.isArray(compare.json.open_questions));
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

  /* ---------- 8. approvals ---------- */
  section('approvals');
  const pending = await tool('list_pending_approvals', {});
  check('list_pending_approvals includes the new request', pending.json?.approvals?.some((a) => a.id === approvalId));
  check('approval polling is non-blocking', pending.json?.note?.includes('does not block'));
  const beforeResolve = await tool('check_approval', { approval_id: approvalId });
  check('check_approval reports pending', beforeResolve.json?.status === 'pending');
  // Relative to the version this run started from: the suite may run twice
  // against the same workspace, and each approval advances the record.
  const baseVersion = (await tool('get_object_detail', { object_id: 'moonbird-mask' })).json?.object?.version;

  const edited = 'The museum acquired this mask through Lorne Gallery in 1968. Community material places it in Aru village in 1959. The intervening custody is under joint research.';
  const resolveResponse = await post(`/api/curator/approvals/${approvalId}/resolve`, { action: 'approve_with_edit', draft: edited, editReason: 'Preserve the verified acquisition while attributing the community material.' });
  check('approve-with-edit is recorded as such', resolveResponse.status === 200 && resolveResponse.json.resolution === 'approved_with_edit', JSON.stringify(resolveResponse.json));
  check('approval publishes a new label revision', resolveResponse.json?.published === true && resolveResponse.json?.revision === baseVersion + 1, JSON.stringify(resolveResponse.json));
  const publishedDetail = await tool('get_object_detail', { object_id: 'moonbird-mask' });
  check('approved text becomes the public label', publishedDetail.json?.object?.label === edited, JSON.stringify(publishedDetail.json?.object?.label));
  check('publication advances the object version', publishedDetail.json?.object?.version === baseVersion + 1, `version ${publishedDetail.json?.object?.version} from ${baseVersion}`);
  check('the public revision number tracks the publication', publishedDetail.json?.object?.label_revision === publishedDetail.json?.object?.version, `revision ${publishedDetail.json?.object?.label_revision}`);
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

  /* ---------- 10. unknown tool + reset ---------- */
  section('surface edges');
  const unknownTool = await tool('delete_evidence', {});
  check('an unlisted tool is not routable', unknownTool.status === 404, `status ${unknownTool.status}`);
  check(`${COMMUNITY_TOOLS.length} community + ${CURATOR_TOOLS.length} curator tools were exercised`, true);

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
