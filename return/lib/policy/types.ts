import type { AssertionMode, Authority, Consent, Visibility } from '../demo-data';
export type Risk='LOW'|'MEDIUM'|'HIGH'|'CRITICAL';
export type Actor='community'|'curator'|'curator_ui';
export type Action='read'|'submit_evidence'|'request_clarification'|'draft_label'|'publish_label'|'open_return_review'|'delete_evidence'|'physical_return';
export type PolicyInput={ actor:Actor; action:Action; museumMatch:boolean; refs?:{authority:Authority;consent:Consent;visibility:Visibility}[]; assertions?:{mode:AssertionMode;refIndexes:number[]}[]; publicOutput?:boolean };
export type PolicyResult={ outcome:'applied'|'pending_approval'|'denied'|'invalid'; risk:Risk; reason:string; recovery?:string };
