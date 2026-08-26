import { collection, moonbird, officialEvidence, seedSubmissions } from '@/lib/demo-data'; import { evaluatePolicy } from '@/lib/policy/evaluate';
const curatorOnly=new Set(['get_collection_summary','list_objects','list_submissions','get_review_case','build_provenance_timeline','compare_evidence','draft_label','request_clarification','propose_label_update','open_return_review','check_approval','list_pending_approvals']);
export async function POST(request:Request,{params}:{params:Promise<{name:string}>}){const{name}=await params;const role=(request.headers.get('cookie')??'').includes('role=curator')?'curator':'community';if(curatorOnly.has(name)&&role!=='curator')return Response.json({outcome:'denied',risk:'LOW',reason:'Curator role required.',recovery:'Switch to the curator workspace.'},{status:403});const args=await request.json() as Record<string,unknown>;
  if(name==='search_collection')return Response.json({objects:collection.slice(0,5).map(({id,title,date,gap,status})=>({id,title,date,gap,status}))});
  if(name==='get_object_detail')return Response.json({object:moonbird});
  if(name==='get_provenance_timeline'||name==='build_provenance_timeline')return Response.json({object_id:'moonbird-mask',events:moonbird.timeline});
  if(name==='list_objects')return Response.json({objects:collection});
  if(name==='list_submissions')return Response.json({submissions:seedSubmissions,untrusted_content:true});
  if(name==='get_collection_summary')return Response.json({objects:8,open_gaps:3,new_submissions:3,pending_approvals:1,consent_alerts:1});
  if(name==='get_review_case'||name==='compare_evidence')return Response.json({case_id:'RC-014',evidence:officialEvidence,conflicts:['The 1968 invoice lists no prior owner.'],open_questions:moonbird.questions,untrusted_content:true});
  if(name==='draft_label')return Response.json({draft:'The mask appears in a 1959 community photograph. Its movement before the museum’s 1968 acquisition remains under joint research.',assertions:[{mode:'attributed_claim',refs:['EV-059']},{mode:'open_question',refs:['EV-059','EV-068']}]});
  if(name==='propose_label_update'){const refs=(args.evidence_ids as string[]??[]).map((id)=>({authority:id==='EV-068'?'verified' as const:'submitted' as const,consent:'public_attributed' as const,visibility:'public' as const}));return Response.json(evaluatePolicy({actor:'curator',action:'publish_label',museumMatch:true,refs,publicOutput:true}));}
  if(name==='open_return_review')return Response.json(evaluatePolicy({actor:'curator',action:'open_return_review',museumMatch:true,refs:[]}));
  if(name==='request_clarification')return Response.json(evaluatePolicy({actor:'curator',action:'request_clarification',museumMatch:true}));
  if(name==='check_approval'||name==='list_pending_approvals')return Response.json({approvals:[{id:'APR-004',risk:'HIGH',status:'pending',object_id:'moonbird-mask'}]});
  if(name==='check_submission')return Response.json({id:args.submission_id??'SUB-1042',status:'received',message:'Source and consent review is next.'});
  if(name==='submit_evidence'||name==='submit_context_claim')return Response.json({...evaluatePolicy({actor:'community',action:'submit_evidence',museumMatch:true}),submission_id:`SUB-${Date.now().toString().slice(-4)}`});
  return Response.json({error:'Unknown tool'},{status:404});
}
