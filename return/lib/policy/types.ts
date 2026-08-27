import type { AssertionMode, Authority, Consent, Visibility } from '../demo-data';
export type Risk='LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
export type Actor='community'|'curator'|'curator_ui';
export type ActorType='human'|'agent';
export type Action='read'|'submit_evidence'|'request_clarification'|'draft_label'|'publish_label'|'open_return_review'|'delete_evidence'|'physical_return';
export type PolicyRef={ authority:Authority; consent:Consent; visibility:Visibility; /** An explicit gap record, which alone can carry an `open_question`. */ gapRecord?:boolean };
export type PolicyInput={ actor:Actor; action:Action; museumMatch:boolean; refs?:PolicyRef[]; assertions?:{mode:AssertionMode;refIndexes:number[]}[]; publicOutput?:boolean };
export type PolicyResult={ outcome:'applied'|'pending_approval'|'denied'|'invalid'; risk:Risk; reason:string; recovery?:string };
