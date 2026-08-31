import { toolsFor, type ToolSpec } from './tools.ts';

/**
 * The measurable half of the WebMCP acceptance gate (`WEBMCP_TOOLS.md` §5).
 *
 * The gate has three clauses. Two of them are properties of the catalogue and are
 * checked here on every test run: the per-definition token budget, and how far apart
 * two tools on the same surface read. The third — whether a model picks the right
 * tool ≥95% of the time — is a property of a model, and `EVAL_SCENARIOS` exists so
 * that run is scorable rather than anecdotal. `scripts/tool-eval.mjs` does both.
 *
 * Keeping the static half in the unit suite matters more than it looks: the fallback
 * the specification prescribes is to shrink the curator surface, and that decision is
 * supposed to rest on "중복도·설명 품질·컨텍스트 비용" — overlap, description quality,
 * and context cost. All three are knowable without a model, and all three regress
 * quietly when a tool is added.
 */

/**
 * The ceiling is the real constraint: a definition past it is buying context with
 * words a model does not need.
 *
 * `WEBMCP_TOOLS.md` §5 also carried a 100-token *floor*, which this catalogue does not
 * meet and should not. Measured, the definitions run 23–162 tokens, and only four of
 * twenty-two clear 100. These are single-purpose tools with one to seven parameters;
 * padding `list_pending_approvals` from 23 tokens to 100 would mean adding words that
 * carry no signal, which makes selection worse rather than better. The floor was trying
 * to catch a definition too thin to choose from, so that is measured directly instead:
 * a description has to be a real sentence, and no two tools on a surface may read alike.
 */
export const DEFINITION_TOKEN_MAX = 500;
export const DESCRIPTION_WORD_MIN = 8;

/**
 * A deliberately crude token estimate: one token per four characters of each word,
 * which tracks BPE closely enough to police a ceiling. It is not a tokenizer, and the
 * numbers it reports should never be quoted as exact.
 */
export function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).reduce((total, word) => total + Math.max(1, Math.ceil(word.length / 4)), 0);
}

/** The text a model actually receives for one tool: name, description, and schema. */
export function definitionText(tool: ToolSpec) {
  const parameters = Object.entries(tool.properties ?? {}).map(([name, schema]) => {
    const field = schema as { type?: string; description?: string; items?: { type?: string } };
    return `${name} ${field.type ?? ''}${field.items ? ` of ${field.items.type}` : ''} ${field.description ?? ''}`;
  });
  return [tool.name, tool.description, ...parameters, (tool.required ?? []).join(' ')].join(' ');
}

export function definitionTokens(tool: ToolSpec) {
  return estimateTokens(definitionText(tool));
}

export function surfaceCost(role: 'community' | 'curator') {
  const tools = toolsFor(role);
  return { tools: tools.length, tokens: tools.reduce((total, tool) => total + definitionTokens(tool), 0) };
}

/** Words that carry no distinguishing signal, so overlap in them means nothing. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from',
  'this', 'that', 'it', 'its', 'is', 'are', 'be', 'been', 'was', 'as', 'not', 'no', 'any',
  'one', 'two', 'more', 'than', 'only', 'without', 'does', 'do', 'may', 'can', 'cannot',
  'string', 'array', 'integer', 'object', 'type', 'items', 'description', 'true', 'false',
]);

function signature(tool: ToolSpec) {
  return new Set(
    definitionText(tool).toLowerCase().split(/[^a-z_]+/)
      .filter((word) => word.length > 2 && !STOP.has(word)),
  );
}

export type ConfusablePair = { a: string; b: string; similarity: number; shared: string[] };

/**
 * How alike two tool definitions read, as Jaccard overlap of their meaningful words.
 *
 * This is a proxy for confusion risk, not a measurement of it — a model can separate
 * two similar descriptions, and can confuse two dissimilar ones. It earns its place by
 * catching the case that matters: a tool added later that reads like one already there.
 */
export function confusablePairs(tools: ToolSpec[]): ConfusablePair[] {
  const signatures = new Map(tools.map((tool) => [tool.name, signature(tool)]));
  const pairs: ConfusablePair[] = [];
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const left = signatures.get(tools[i].name)!;
      const right = signatures.get(tools[j].name)!;
      const shared = [...left].filter((word) => right.has(word));
      const union = new Set([...left, ...right]).size;
      pairs.push({
        a: tools[i].name, b: tools[j].name,
        similarity: union === 0 ? 0 : Number((shared.length / union).toFixed(3)),
        shared: shared.sort(),
      });
    }
  }
  return pairs.sort((left, right) => right.similarity - left.similarity);
}

export type EvalScenario = {
  id: string;
  role: 'community' | 'curator';
  prompt: string;
  expectTool: string;
  expectArgs: string[];
  /** Tools on the same surface a confused model would plausibly reach for instead. */
  decoys: string[];
  note: string;
};

/** The seven prompts `RETURN_PLAN.md` §20.3 names, as scorable fixtures. */
export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    id: 'gap-search', role: 'community',
    prompt: 'Which objects in this collection have an unresolved gap in their provenance?',
    expectTool: 'search_collection', expectArgs: ['query'],
    decoys: ['get_object_detail', 'get_provenance_timeline'],
    note: 'Collection-wide, so it is a search and not a per-object read.',
  },
  {
    id: 'photo-to-object', role: 'community',
    prompt: 'I have a 1959 photograph taken in an Aru village. Which object in the collection does it relate to?',
    expectTool: 'search_collection', expectArgs: ['query'],
    decoys: ['submit_evidence', 'get_object_detail'],
    note: 'Finding the object comes before offering the material; submitting first is the classic misfire.',
  },
  {
    id: 'submit-evidence', role: 'community',
    prompt: 'I want to give the museum my grandmother’s photograph of the Moonbird Mask, and they may credit me by name.',
    expectTool: 'submit_evidence', expectArgs: ['object_id', 'title', 'description', 'consent'],
    decoys: ['submit_context_claim', 'attach_assets'],
    note: 'Material rather than a claim, and consent has to be carried rather than assumed.',
  },
  {
    id: 'triage-batch', role: 'curator',
    prompt: 'What has come in that I have not looked at yet?',
    expectTool: 'list_submissions', expectArgs: ['status'],
    decoys: ['get_review_case', 'get_collection_summary'],
    note: 'A list, not a single case and not a count.',
  },
  {
    id: 'draft-label', role: 'curator',
    prompt: 'Draft a revised label for the Moonbird Mask using the accession invoice and the community photograph.',
    expectTool: 'draft_label', expectArgs: ['object_id', 'evidence_ids'],
    decoys: ['propose_label_update', 'build_provenance_timeline'],
    note: 'Drafting must not become proposing; the second one enters human approval.',
  },
  {
    id: 'denied-recovery', role: 'curator',
    prompt: 'Publish the new acquisition wording for the Moonbird Mask, citing only the community oral history.',
    expectTool: 'propose_label_update', expectArgs: ['object_id', 'draft', 'evidence_ids'],
    decoys: ['open_return_review', 'draft_label'],
    note: 'The call is correct and the gateway refuses it. The scenario scores the recovery: the model should follow the returned next step rather than retry the same call.',
  },
  {
    id: 'approval-polling', role: 'curator',
    prompt: 'Is my label proposal approved yet? While you wait, keep comparing the two sources.',
    expectTool: 'check_approval', expectArgs: ['approval_id'],
    decoys: ['list_pending_approvals', 'compare_evidence'],
    note: 'A known id makes it a check, not a list. Polling must not block the other work.',
  },
];
