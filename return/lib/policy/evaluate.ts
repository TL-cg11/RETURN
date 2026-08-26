import type { PolicyInput, PolicyResult, Risk } from './types';
const riskByAction:Record<PolicyInput['action'],Risk>={read:'LOW',draft_label:'LOW',submit_evidence:'MEDIUM',request_clarification:'MEDIUM',publish_label:'HIGH',open_return_review:'HIGH',delete_evidence:'CRITICAL',physical_return:'CRITICAL'};
export function evaluatePolicy(input:PolicyInput):PolicyResult {
  const risk=riskByAction[input.action];
  if(!input.museumMatch)return{outcome:'denied',risk,reason:'The requested record belongs to another workspace.',recovery:'Open the record from the active museum workspace.'};
  if(input.actor==='community'&&['publish_label','open_return_review','delete_evidence','physical_return'].includes(input.action))return{outcome:'denied',risk,reason:'Community sessions cannot perform curator actions.',recovery:'Submit evidence or a context claim for curator review.'};
  if(risk==='CRITICAL')return{outcome:'denied',risk,reason:'This action is outside the agent tool surface.',recovery:'Document the request for an authorised human process.'};
  const refs=input.refs??[];
  if(input.publicOutput&&refs.some((ref)=>ref.visibility!=='public'))return{outcome:'denied',risk,reason:'Restricted or sealed material cannot appear in public output.',recovery:'Remove the restricted reference or request an access review.'};
  if(input.publicOutput&&refs.some((ref)=>ref.consent==='private'||ref.consent==='research_only'))return{outcome:'denied',risk,reason:'The evidence consent does not permit public quotation.',recovery:'Use it for research only or request updated consent.'};
  if(input.action==='publish_label'&&!refs.some((ref)=>ref.authority==='verified'))return{outcome:'denied',risk,reason:'Submitted evidence cannot be the sole authority for an official change.',recovery:'Compare a verified source or escalate the gap to curator review.'};
  if(input.assertions?.some((a)=>a.mode==='verified_fact'&&a.refIndexes.every((i)=>refs[i]?.authority!=='verified')))return{outcome:'invalid',risk,reason:'A verified fact must reference verified evidence.',recovery:'Change the assertion mode or attach a verified reference.'};
  if(risk==='HIGH')return{outcome:'pending_approval',risk,reason:'A human curator must review consequential changes before publication.'};
  return{outcome:'applied',risk,reason:'The action is within the actor’s authority and evidence permissions.'};
}
