/**
 * WebMCP acceptance gate (`WEBMCP_TOOLS.md` §5).
 *
 * Two of the gate's three clauses are properties of the catalogue and are reported
 * unconditionally: context cost per definition and per surface, and how far apart two
 * tools on the same surface read. The third — tool-selection accuracy — is a property
 * of a model, and this script will not invent it.
 *
 *   node scripts/tool-eval.mjs                      # static gate only
 *   node scripts/tool-eval.mjs --prompts            # the seven scenario prompts, to run
 *   node scripts/tool-eval.mjs --score answers.json # score a model's tool calls
 *
 * `answers.json` is whatever the model actually called, keyed by scenario id:
 *
 *   { "gap-search": { "tool": "search_collection", "args": { "query": "provenance gap" } },
 *     "draft-label": [ { "tool": "draft_label", "args": { ... } } ] }
 *
 * An array records a sequence; the first call is the one scored for selection, and the
 * rest are read for the recovery scenarios, where what matters is what the model did
 * after the gateway refused it.
 */

import { readFileSync } from 'node:fs';

const { EVAL_SCENARIOS, confusablePairs, definitionTokens, surfaceCost } = await import('../lib/webmcp/eval.ts');
const { toolsFor } = await import('../lib/webmcp/tools.ts');

const CONFUSABLE_LIMIT = 0.5;
const SELECTION_TARGET = 0.95;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

function heading(text) {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

/* ---------- 1. context cost ---------- */
function reportCost() {
  heading('Definition cost');
  const seen = new Map();
  for (const role of ['community', 'curator']) {
    for (const tool of toolsFor(role)) seen.set(tool.name, tool);
  }
  const rows = [...seen.values()].map((tool) => ({ name: tool.name, tokens: definitionTokens(tool) }))
    .sort((left, right) => right.tokens - left.tokens);
  console.log(`  ${rows.length} distinct tools · ${rows[rows.length - 1].tokens}–${rows[0].tokens} tokens each (estimated)`);
  for (const role of ['community', 'curator']) {
    const cost = surfaceCost(role);
    console.log(`  ${role.padEnd(9)} ${String(cost.tools).padStart(2)} tools · ~${cost.tokens} tokens registered at once`);
  }
  const over = rows.filter((row) => row.tokens > 500);
  console.log(over.length === 0 ? '  ok   no definition exceeds the 500-token ceiling' : `  FAIL ${over.map((row) => row.name).join(', ')}`);
  return over.length === 0;
}

/* ---------- 2. confusability ---------- */
function reportConfusability() {
  heading('Adjacent-tool confusability (static proxy)');
  let clean = true;
  for (const role of ['community', 'curator']) {
    const pairs = confusablePairs(toolsFor(role));
    const worst = pairs.slice(0, 3);
    console.log(`  ${role}:`);
    for (const pair of worst) {
      const mark = pair.similarity >= CONFUSABLE_LIMIT ? 'FAIL' : 'ok  ';
      console.log(`    ${mark} ${pair.similarity.toFixed(3)}  ${pair.a} ↔ ${pair.b}`);
      if (pair.similarity >= CONFUSABLE_LIMIT) clean = false;
    }
  }
  console.log(`  threshold ${CONFUSABLE_LIMIT} · word overlap of the full definition, stop words removed`);
  console.log('  note: a proxy for confusion risk, not a measurement of it. The ≤2% confusion');
  console.log('        rate in the gate needs the model run below.');
  return clean;
}

/* ---------- 3. selection accuracy ---------- */
function reportPrompts() {
  heading('Scenario prompts (RETURN_PLAN §20.3)');
  for (const scenario of EVAL_SCENARIOS) {
    console.log(`\n  [${scenario.id}] as ${scenario.role}`);
    console.log(`    ${scenario.prompt}`);
    console.log(`    expect: ${scenario.expectTool}(${scenario.expectArgs.join(', ')})`);
    console.log(`    decoys: ${scenario.decoys.join(', ')}`);
    console.log(`    why:    ${scenario.note}`);
  }
  console.log('\n  Run these against a model with the surface registered, record what it called,');
  console.log('  and score with --score answers.json.');
}

function score(path) {
  heading('Selection accuracy');
  let answers;
  try {
    answers = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.log(`  could not read ${path}: ${error.message}`);
    return false;
  }

  let correct = 0;
  let confused = 0;
  let missing = 0;
  for (const scenario of EVAL_SCENARIOS) {
    const raw = answers[scenario.id];
    if (!raw) { missing++; console.log(`  --   ${scenario.id}: no answer recorded`); continue; }
    const calls = Array.isArray(raw) ? raw : [raw];
    const first = calls[0] ?? {};
    const toolOk = first.tool === scenario.expectTool;
    const args = Object.keys(first.args ?? {});
    const argsOk = scenario.expectArgs.every((name) => args.includes(name));
    const decoyed = scenario.decoys.includes(first.tool);
    if (toolOk && argsOk) correct++;
    if (decoyed) confused++;
    const missed = scenario.expectArgs.filter((name) => !args.includes(name));
    console.log(`  ${toolOk && argsOk ? 'ok  ' : 'FAIL'} ${scenario.id}: called ${first.tool ?? '(nothing)'}`
      + (missed.length ? ` · missing ${missed.join(', ')}` : '')
      + (decoyed ? ' · picked a decoy' : ''));
  }

  const answered = EVAL_SCENARIOS.length - missing;
  const accuracy = answered === 0 ? 0 : correct / answered;
  const confusion = answered === 0 ? 0 : confused / answered;
  console.log(`\n  selection + required args: ${(accuracy * 100).toFixed(1)}%  (target ≥ ${SELECTION_TARGET * 100}%)`);
  console.log(`  picked an adjacent decoy:  ${(confusion * 100).toFixed(1)}%  (target ≤ 2%)`);
  if (missing > 0) console.log(`  ${missing} scenario(s) unanswered and excluded from both figures`);
  return accuracy >= SELECTION_TARGET && confusion <= 0.02;
}

/* ---------- report ---------- */
console.log('\nRE:TURN — WebMCP acceptance gate');
const costOk = reportCost();
const confusabilityOk = reportConfusability();
if (flag('--prompts')) reportPrompts();

const answersPath = value('--score');
const scored = answersPath ? score(answersPath) : null;

heading('Verdict');
console.log(`  context cost      ${costOk ? 'pass' : 'FAIL'}`);
console.log(`  confusability     ${confusabilityOk ? 'pass' : 'FAIL'}`);
console.log(`  selection accuracy ${scored === null ? 'not measured — needs a model run (--prompts, then --score)' : scored ? 'pass' : 'FAIL'}`);
if (scored === null) {
  console.log('\n  The static half of the gate passes. The surface is not cleared to stay as it is');
  console.log('  until the model run is done; if it misses, WEBMCP_TOOLS §5 says to shrink the');
  console.log('  curator surface to 7–9 tools with the rest registered lazily.');
}
console.log('');
process.exit(costOk && confusabilityOk && scored !== false ? 0 : 1);
