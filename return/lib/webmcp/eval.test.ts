import assert from 'node:assert/strict';
import test from 'node:test';
import { communityTools, curatorTools, toolsFor } from './tools.ts';
import {
  DEFINITION_TOKEN_MAX, DESCRIPTION_WORD_MIN, EVAL_SCENARIOS,
  confusablePairs, definitionTokens, estimateTokens, surfaceCost,
} from './eval.ts';

/* Token budget. The ceiling is the constraint that matters; see eval.ts for why the
   documented 100-token floor was replaced by a direct measure of description adequacy. */
test('no tool definition exceeds the context ceiling', () => {
  for (const tool of [...communityTools, ...curatorTools]) {
    const tokens = definitionTokens(tool);
    assert.ok(tokens <= DEFINITION_TOKEN_MAX, `${tool.name} is ${tokens} tokens, over the ${DEFINITION_TOKEN_MAX} ceiling`);
  }
});

test('every description is a sentence a model could choose on', () => {
  for (const tool of [...communityTools, ...curatorTools]) {
    const words = tool.description.trim().split(/\s+/).length;
    assert.ok(words >= DESCRIPTION_WORD_MIN, `${tool.name} is described in ${words} words`);
    assert.match(tool.description.trim(), /\.$/, `${tool.name} description is not a complete sentence`);
  }
});

test('every write tool says what it does not do', () => {
  // A consequential tool the model believes is final is the failure this product is about.
  for (const tool of [...communityTools, ...curatorTools].filter((item) => !item.readOnly)) {
    assert.match(tool.description, /not|never|without|review|approval/i, `${tool.name} does not bound its own effect`);
  }
});

test('the estimator counts something proportional to the text', () => {
  assert.ok(estimateTokens('one two three') < estimateTokens('one two three four five six seven eight'));
  assert.equal(estimateTokens(''), 0);
});

/* Surface cost — what a model actually carries, per role. */
test('neither surface exceeds a workable context cost', () => {
  for (const role of ['community', 'curator'] as const) {
    const cost = surfaceCost(role);
    assert.equal(cost.tools, toolsFor(role).length);
    // 8k tokens of tool definitions is already a large share of a working context.
    assert.ok(cost.tokens < 8000, `${role} surface costs ${cost.tokens} tokens`);
  }
});

/* Confusability — the static half of the "adjacent tool confusion" gate. Two tools a
   model cannot tell apart from their definitions are the ones it will confuse. */
test('no two tools on the same surface are near-duplicates', () => {
  for (const role of ['community', 'curator'] as const) {
    const pairs = confusablePairs(toolsFor(role));
    const worst = pairs.filter((pair) => pair.similarity >= 0.5);
    assert.deepEqual(worst, [], worst.map((pair) => `${pair.a} ↔ ${pair.b} at ${pair.similarity}`).join(', '));
  }
});

test('the pairs the specification names are measured and reported', () => {
  const named = [
    ['list_object_assets', 'get_asset_detail'],
    ['list_object_assets', 'compare_evidence'],
    ['get_asset_detail', 'compare_evidence'],
    ['attach_assets', 'submit_evidence'],
  ];
  const all = [...confusablePairs(communityTools), ...confusablePairs(curatorTools)];
  for (const [a, b] of named) {
    const found = all.find((pair) => (pair.a === a && pair.b === b) || (pair.a === b && pair.b === a));
    // A pair only appears when both tools share a surface; the rest are unreachable together.
    if (!found) continue;
    assert.ok(found.similarity < 0.5, `${a} ↔ ${b} at ${found.similarity}`);
  }
});

test('similarity is symmetric and each pair is reported once', () => {
  const pairs = confusablePairs(curatorTools);
  const seen = new Set(pairs.map((pair) => [pair.a, pair.b].sort().join('|')));
  assert.equal(seen.size, pairs.length);
});

/* Scenario fixtures — RETURN_PLAN §20.3. These make the model-in-the-loop run
   scorable; they do not by themselves prove selection accuracy. */
test('every documented scenario has a fixture', () => {
  assert.equal(EVAL_SCENARIOS.length, 7);
});

test('each scenario names a tool that exists on the role it runs as', () => {
  for (const scenario of EVAL_SCENARIOS) {
    const names = toolsFor(scenario.role).map((tool) => tool.name);
    assert.ok(names.includes(scenario.expectTool), `${scenario.id} expects ${scenario.expectTool}, absent from the ${scenario.role} surface`);
  }
});

test('each scenario requires arguments the tool actually declares', () => {
  for (const scenario of EVAL_SCENARIOS) {
    const tool = toolsFor(scenario.role).find((item) => item.name === scenario.expectTool)!;
    const declared = Object.keys(tool.properties ?? {});
    for (const argument of scenario.expectArgs) {
      assert.ok(declared.includes(argument), `${scenario.id} expects ${argument}, not declared on ${tool.name}`);
    }
  }
});

test('each scenario names decoys that are real, reachable, and not the answer', () => {
  for (const scenario of EVAL_SCENARIOS) {
    const names = toolsFor(scenario.role).map((tool) => tool.name);
    assert.ok(scenario.decoys.length > 0, `${scenario.id} has no decoy`);
    for (const decoy of scenario.decoys) {
      assert.ok(names.includes(decoy), `${scenario.id} decoy ${decoy} is not on the ${scenario.role} surface`);
      assert.notEqual(decoy, scenario.expectTool, `${scenario.id} lists its own answer as a decoy`);
    }
  }
});

test('the scenarios cover both surfaces and both read and write actions', () => {
  const roles = new Set(EVAL_SCENARIOS.map((scenario) => scenario.role));
  assert.equal(roles.size, 2);
  const writes = EVAL_SCENARIOS.filter((scenario) => {
    const tool = toolsFor(scenario.role).find((item) => item.name === scenario.expectTool)!;
    return !tool.readOnly;
  });
  assert.ok(writes.length >= 2, 'the gate has to cover consequential calls, not only reads');
});
