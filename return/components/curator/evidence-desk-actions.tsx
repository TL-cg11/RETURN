'use client';
export function EvidenceDeskActions(){return <div className="case-actions"><button>Request clarification</button><button className="primary" onClick={()=>window.dispatchEvent(new Event('open-approval'))}>Review proposed update <span>→</span></button></div>}
