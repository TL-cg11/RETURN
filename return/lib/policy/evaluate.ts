import type { Actor, ActorType, PolicyInput, PolicyResult, Risk } from './types';
const riskByAction:Record<PolicyInput['action'],Risk>={read:'LOW',draft_label:'LOW',submit_evidence:'MEDIUM',request_clarification:'MEDIUM',publish_label:'HIGH',open_return_review:'HIGH',delete_evidence:'CRITICAL',physical_return:'CRITICAL'};
/** `curator_ui` is a human acting in the console; every other actor reaches the gateway through an agent tool. */
export const actorTypeOf=(actor:Actor):ActorType=>actor==='curator_ui'?'human':'agent';
/**
 * The judgement order is fixed (TECH_SPEC §D3). Steps 1, 4, 9, and 10 are the caller's:
 * the route validates the schema and resolves the target record before calling, and the
 * approval and activity layers run after a verdict. This function owns steps 2, 3, and 5-8.
 *
 *   2 role → 3 tenancy → 5 risk → 6 consent/visibility
 *   → 8 justification provenance binding → 7 assertion mode × authority
 *
 * Steps 7 and 8 run in the reverse of the order §D3 lists, deliberately. An agent that
 * cites only submitted material has no authority for the action at all, so that answer
 * (`denied`) is more useful than a complaint about one assertion's mode (`invalid`).
 * §D3 and WEBMCP_TOOLS §3.10 disagree on the outcome type here; revisit once they settle.
 *
 * It reads only the resolved metadata it is handed. It never inspects evidence text,
 * so wording inside a submitted document cannot change any outcome below.
 */
export function evaluatePolicy(input:PolicyInput):PolicyResult {
  const risk=riskByAction[input.action];
  if(input.actor==='community'&&['publish_label','open_return_review','delete_evidence','physical_return'].includes(input.action))return{outcome:'denied',risk,reason:'Community sessions cannot perform curator actions.',recovery:'Submit evidence or a context claim for curator review.'};
  if(!input.museumMatch)return{outcome:'denied',risk,reason:'The requested record belongs to another workspace.',recovery:'Open the record from the active museum workspace.'};
  if(risk==='CRITICAL')return{outcome:'denied',risk,reason:'This action is outside the agent tool surface.',recovery:'Document the request for an authorised human process.'};
  const refs=input.refs??[];
  if(input.publicOutput&&refs.some((ref)=>ref.visibility!=='public'))return{outcome:'denied',risk,reason:'Restricted or sealed material cannot appear in public output.',recovery:'Remove the restricted reference or request an access review.'};
  if(input.publicOutput&&refs.some((ref)=>ref.consent==='private'||ref.consent==='research_only'))return{outcome:'denied',risk,reason:'The evidence consent does not permit public quotation.',recovery:'Use it for research only or request updated consent.'};
  if(risk==='HIGH'&&actorTypeOf(input.actor)==='agent'&&!refs.some((ref)=>ref.authority==='verified'))return{outcome:'denied',risk,reason:'Submitted evidence cannot be the sole authority for an official change.',recovery:'Compare a verified source or escalate the gap to curator review.'};
  if(input.assertions?.some((a)=>a.refIndexes.length===0))return{outcome:'invalid',risk,reason:'Every public assertion must cite at least one evidence record.',recovery:'Add evidence refs or remove the unsupported assertion.'};
  if(input.assertions?.some((a)=>a.mode==='verified_fact'&&a.refIndexes.every((i)=>refs[i]?.authority!=='verified')))return{outcome:'invalid',risk,reason:'A verified fact must reference verified evidence.',recovery:'Change the assertion mode or attach a verified reference.'};
  if(input.assertions?.some((a)=>a.mode==='open_question'&&a.refIndexes.length<2&&!a.refIndexes.some((i)=>refs[i]?.gapRecord)))return{outcome:'invalid',risk,reason:'An open question must span two boundary sources or cite an explicit gap record.',recovery:'Cite the records on both sides of the gap, or reference the gap record itself.'};
  if(risk==='HIGH')return{outcome:'pending_approval',risk,reason:'A human curator must review consequential changes before publication.'};
  return{outcome:'applied',risk,reason:'The action is within the actor’s authority and evidence permissions.'};
}
