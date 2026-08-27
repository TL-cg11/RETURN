'use client';
import { useState } from 'react';
import type { LabelAssertion } from '@/lib/domain/types';

export function LabelFlip({ label, questions, revision, assertions, lastReviewed }: {
  label:string; questions:string[]; revision:number; assertions:LabelAssertion[]; lastReviewed:string|null;
}) {
  const [back,setBack]=useState(false);
  const verifiedFacts=assertions.filter((a)=>a.mode==='verified_fact').length;
  return (
    <section className="label-module" aria-labelledby="label-heading">
      <div className="label-controls">
        <div><p className="eyebrow">Public record · Revision {revision}</p><h2 id="label-heading">{back?'What the record is still asking':'What the museum currently says'}</h2></div>
        <button className="flip-control" onClick={()=>setBack(!back)} aria-pressed={back}><span aria-hidden="true">↺</span> Flip the label</button>
      </div>
      <div className={`label-card ${back?'is-back':''}`}>
        {!back ? (
          <><p className="label-copy">{label}</p><div className="label-foot"><span>Verified fact <b>{verifiedFacts}</b></span><span>Open question <b>{questions.length}</b></span>{lastReviewed && <span>Last reviewed {lastReviewed}</span>}</div></>
        ) : (
          <><ol className="question-list">{questions.map((q,i)=><li key={q}><span>0{i+1}</span>{q}</li>)}</ol><p className="question-note">Questions are not evidence of wrongdoing. They mark where the public record needs more research.</p></>
        )}
      </div>
    </section>
  );
}
