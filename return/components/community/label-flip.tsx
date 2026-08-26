'use client';
import { useState } from 'react';

export function LabelFlip({ label, questions }: { label:string; questions:string[] }) {
  const [back,setBack]=useState(false);
  return (
    <section className="label-module" aria-labelledby="label-heading">
      <div className="label-controls">
        <div><p className="eyebrow">Public record · Revision 3</p><h2 id="label-heading">{back?'What the record is still asking':'What the museum currently says'}</h2></div>
        <button className="flip-control" onClick={()=>setBack(!back)} aria-pressed={back}><span aria-hidden="true">↺</span> Flip the label</button>
      </div>
      <div className={`label-card ${back?'is-back':''}`}>
        {!back ? (
          <><p className="label-copy">{label}</p><div className="label-foot"><span>Verified fact <b>2</b></span><span>Open question <b>1</b></span><span>Last reviewed 04 Aug 2026</span></div></>
        ) : (
          <><ol className="question-list">{questions.map((q,i)=><li key={q}><span>0{i+1}</span>{q}</li>)}</ol><p className="question-note">Questions are not evidence of wrongdoing. They mark where the public record needs more research.</p></>
        )}
      </div>
    </section>
  );
}
