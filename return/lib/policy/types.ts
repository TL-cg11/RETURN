import type { AssertionMode, Authority, Consent, Visibility } from '../domain/types';
export type Risk='LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
export type Actor='community'|'curator'|'curator_ui';
export type ActorType='human'|'agent';
export type Action='read'|'submit_evidence'|'request_clarification'|'draft_label'|'publish_label'|'open_return_review'|'delete_evidence'|'physical_return';
export type PolicyRef={ authority:Authority; consent:Consent; visibility:Visibility; /** An explicit gap record, which alone can carry an `open_question`. */ gapRecord?:boolean };
export type PolicyInput={ actor:Actor; action:Action; museumMatch:boolean; refs?:PolicyRef[]; assertions?:{mode:AssertionMode;refIndexes:number[]}[]; publicOutput?:boolean };
/** Stable machine-readable denial codes. `escalations.policy` stores these verbatim. */
export type PolicyCode='workspace_mismatch'|'role_not_permitted'|'outside_agent_surface'|'visibility_restricted'|'consent_not_public'|'submitted_sole_authority'|'assertion_unsupported'|'assertion_not_verified'|'open_question_unbounded';
export type PolicyResult={
  outcome:'applied'|'pending_approval'|'denied'|'invalid';
  risk:Risk;
  reason:string;
  recovery?:string;
  /** Present on every non-success verdict, so callers can branch on a code rather than prose. */
  policy?:PolicyCode;
  /** True when a human curator should see this refusal. A denial is not a dead end. */
  escalate?:boolean;
};
