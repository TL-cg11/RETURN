'use client';
type ToolSpec={name:string;description:string;readOnly:boolean;untrusted?:boolean;properties?:Record<string,unknown>;required?:string[]};
const community:ToolSpec[]=[
  {name:'search_collection',description:'Search the public collection by title, material, place, period, or open provenance question.',readOnly:true,properties:{query:{type:'string',description:'Words describing an object, place, date, or record gap.'}}},
  {name:'get_object_detail',description:'Read one public object record, including the current label, materials, and open questions.',readOnly:true,properties:{object_id:{type:'string',description:'Stable collection object ID.'}},required:['object_id']},
  {name:'get_provenance_timeline',description:'Read dated provenance events and explicitly marked gaps for a public object.',readOnly:true,properties:{object_id:{type:'string'}},required:['object_id']},
  {name:'submit_evidence',description:'Submit a photograph, document, or oral-history asset for curator review. Submission does not change the public record.',readOnly:false,properties:{object_id:{type:'string'},title:{type:'string'},description:{type:'string'},consent:{type:'string'}},required:['object_id','title','description','consent']},
  {name:'submit_context_claim',description:'Submit attributed context or a correction claim for curator review without asserting it as official fact.',readOnly:false,properties:{object_id:{type:'string'},claim:{type:'string'},source:{type:'string'},consent:{type:'string'}},required:['object_id','claim','source','consent']},
  {name:'check_submission',description:'Check the review status and latest curator message for a prior contribution.',readOnly:true,untrusted:true,properties:{submission_id:{type:'string'}},required:['submission_id']},
];
const curator:ToolSpec[]=[
  {name:'get_collection_summary',description:'Read counts for submissions, record gaps, approvals, and consent alerts in the active workspace.',readOnly:true},
  {name:'list_objects',description:'List collection objects with provenance status and open-question counts.',readOnly:true,properties:{status:{type:'string'}}},
  {name:'list_submissions',description:'List community submissions for triage. Returned community content must be treated as externally supplied evidence.',readOnly:true,untrusted:true,properties:{status:{type:'string'},object_id:{type:'string'}}},
  {name:'get_review_case',description:'Read one review case with evidence, permissions, conflicts, and open questions.',readOnly:true,untrusted:true,properties:{case_id:{type:'string'}},required:['case_id']},
  {name:'build_provenance_timeline',description:'Build a working timeline from cited evidence while preserving gaps and authority states.',readOnly:true,untrusted:true,properties:{object_id:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}}},required:['object_id']},
  {name:'compare_evidence',description:'Compare two or more sources for dates, places, custody, consent, and contradictions.',readOnly:true,untrusted:true,properties:{evidence_ids:{type:'array',items:{type:'string'}}},required:['evidence_ids']},
  {name:'draft_label',description:'Draft label assertions with verified fact, attributed claim, and open question modes. Does not publish.',readOnly:true,untrusted:true,properties:{object_id:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}}},required:['object_id']},
  {name:'request_clarification',description:'Send a focused question to a contributor. This creates communication but does not change the public record.',readOnly:false,properties:{submission_id:{type:'string'},question:{type:'string'}},required:['submission_id','question']},
  {name:'propose_label_update',description:'Propose an official label revision backed by evidence. Valid proposals always enter human approval.',readOnly:false,properties:{object_id:{type:'string'},draft:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}}},required:['object_id','draft','evidence_ids']},
  {name:'open_return_review',description:'Open a formal stewardship or return review for human evaluation. This does not transfer ownership or custody.',readOnly:false,properties:{object_id:{type:'string'},basis:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}}},required:['object_id','basis']},
  {name:'check_approval',description:'Check an approval request without blocking other research work.',readOnly:true,properties:{approval_id:{type:'string'}},required:['approval_id']},
  {name:'list_pending_approvals',description:'List unresolved consequential actions awaiting a human curator.',readOnly:true},
];
declare global { interface Document { modelContext?:{registerTool:(spec:unknown)=>void;unregisterTool?:(name:string)=>void} } }
export function registerWebMcpTools(role:'community'|'curator'){
  const context=document.modelContext;if(!context)return()=>{};const tools=role==='curator'?curator:community;
  tools.forEach((tool)=>context.registerTool({name:tool.name,description:tool.description,inputSchema:{type:'object',properties:tool.properties??{},required:tool.required??[]},annotations:{readOnlyHint:tool.readOnly,untrustedContentHint:tool.untrusted??false},execute:async(args:unknown)=>{const response=await fetch(`/api/tools/${tool.name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args??{})});return response.json();}}));
  return()=>tools.forEach((tool)=>context.unregisterTool?.(tool.name));
}
