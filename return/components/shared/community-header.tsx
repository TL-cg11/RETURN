'use client';
import { NavLink as Link } from '@/components/shared/nav-link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { registerWebMcpTools } from '@/lib/webmcp/register';
import { useLiveRecord } from '@/lib/live/use-live-record';

export function CommunityHeader({ curator=false }: { curator?:boolean }) {
  const path=usePathname();
  useEffect(()=>registerWebMcpTools(curator?'curator':'community'),[curator]);
  useLiveRecord();
  async function switchRole(){ await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:curator?'community':'curator'})}); location.href=curator?'/':'/curator'; }
  return (
    <header className={curator?'console-topbar':'site-header'}>
      <Link className="wordmark" href={curator?'/curator':'/'} aria-label="RE:TURN home">RE<span>:</span>TURN</Link>
      {curator ? <><div className="console-context"><b>Halcyon Museum</b><span>Curatorial workspace</span></div><button className="role-switch dark" onClick={switchRole}>View community collection <span>↗</span></button></> :
      <nav aria-label="Primary navigation"><Link className={path==='/'?'active':''} href="/#collection">Collection</Link><Link href="/#about">How it works</Link><button className="curator-link" onClick={switchRole}>Curator console <span aria-hidden="true">↗</span></button></nav>}
    </header>
  );
}
