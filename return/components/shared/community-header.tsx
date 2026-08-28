'use client';
import { NavLink as Link } from '@/components/shared/nav-link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { registerWebMcpTools } from '@/lib/webmcp/register';
import { useLiveRecord } from '@/lib/live/use-live-record';

export function CommunityHeader({ curator=false }: { curator?:boolean }) {
  const path=usePathname();
  const [failed,setFailed]=useState(false);
  useEffect(()=>registerWebMcpTools(curator?'curator':'community'),[curator]);
  useLiveRecord();
  // The navigation used to happen whether or not the role changed, so a failed write
  // sent the reader to /curator and a 404 with nothing explaining it (F6-8). The
  // destination is entered only once the server confirms the role it signed.
  async function switchRole(){
    const next = curator ? 'community' : 'curator';
    const response = await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:next})}).catch(()=>null);
    const session = response?.ok ? await response.json().catch(()=>null) as { role?:string } | null : null;
    if (session?.role !== next) { setFailed(true); return; }
    location.href = curator ? '/' : '/curator';
  }
  return (
    <header className={curator?'console-topbar':'site-header'}>
      <Link className="wordmark" href={curator?'/curator':'/'} aria-label="RE:TURN home">RE<span>:</span>TURN</Link>
      {curator ? <><div className="console-context"><b>Halcyon Museum</b><span>Curatorial workspace</span></div><button className="role-switch dark" onClick={switchRole}>View community collection <span>↗</span></button>{failed && <span role="status" className="switch-failed">Could not switch views. Try again.</span>}</> :
      <nav aria-label="Primary navigation">{failed && <span role="status" className="switch-failed">Could not switch views. Try again.</span>}<Link className={path==='/'?'active':''} href="/#collection">Collection</Link><Link href="/#about">How it works</Link><button className="curator-link" onClick={switchRole}>Curator console <span aria-hidden="true">↗</span></button></nav>}
    </header>
  );
}
