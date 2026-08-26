import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CommunityHeader } from '@/components/shared/community-header';
import { LabelFlip } from '@/components/community/label-flip';
import { collection, moonbird } from '@/lib/demo-data';

export function generateStaticParams(){ return collection.map((item)=>({id:item.id})); }
export async function generateMetadata({params}:{params:Promise<{id:string}>}){ const {id}=await params; const item=collection.find((x)=>x.id===id); return item?{title:`${item.title} — RE:TURN`,description:`The living museum record for ${item.title}.`,openGraph:{title:`${item.title} — RE:TURN`,description:`Provenance, questions and community context for ${item.title}.`,images:[]},twitter:{card:'summary',title:`${item.title} — RE:TURN`,description:`Provenance, questions and community context for ${item.title}.`,images:[]}}:{}; }
export default async function ObjectPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params; if(id!=='moonbird-mask')notFound();
  return <main><CommunityHeader/><div className="object-breadcrumb"><Link href="/">Collection</Link><span>/</span><span>{moonbird.accession}</span></div>
    <section className="object-hero">
      <div className="object-art-panel"><div className="object-art-meta"><span>{moonbird.accession}</span><span>View 01 / 03</span></div><div className="artifact-stage detail"><div className="mask-silhouette"><span className="mask-eye left"/><span className="mask-eye right"/><span className="mask-mouth"/></div></div><p className="image-disclaimer">Fictional collection image · created for this demonstration</p></div>
      <div className="object-intro"><p className="eyebrow">{moonbird.status} · {moonbird.date}</p><h1>{moonbird.title}</h1><dl><div><dt>Material</dt><dd>{moonbird.material}</dd></div><div><dt>Place</dt><dd>{moonbird.region}</dd></div><div><dt>Accession</dt><dd>{moonbird.accession}</dd></div></dl><div className="gap-callout"><span>Open provenance gap</span><strong>{moonbird.gap}</strong><p>Movement and custody are not documented in the current official record.</p></div><Link className="primary-action" href="/contribute?object=moonbird-mask">Contribute to this record <span>→</span></Link></div>
    </section>
    <LabelFlip label={moonbird.label} questions={moonbird.questions}/>
    <section className="timeline-section"><div className="section-heading compact"><div><p className="eyebrow">Provenance timeline</p><h2>A record with a visible gap.</h2></div><div className="legend"><span><i className="dot verified"/>Verified source</span><span><i className="dot submitted"/>Submitted source</span><span><i className="gap-symbol"/>Open gap</span></div></div><div className="timeline">{moonbird.timeline.map((event)=><article className={event.gap?'timeline-event gap':''} key={event.year}><time>{event.year}</time><span className={`timeline-node ${event.authority}`}/><div><p className="authority-tag">{event.authority}</p><h3>{event.title}</h3><p>{event.detail}</p></div></article>)}</div></section>
    <section className="contribution-cta"><div><p className="eyebrow">Recognise this object?</p><h2>Your knowledge can change what the record asks next.</h2></div><div><p>Share a photograph, document, or memory. You choose how it can be used and whether your name appears.</p><Link className="primary-action light" href="/contribute?object=moonbird-mask">Add to the record <span>→</span></Link></div></section>
  </main>;
}
