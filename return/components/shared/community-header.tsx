'use client';
import { NavLink as Link } from '@/components/shared/nav-link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { modelContextStatus, registerWebMcpTools } from '@/lib/webmcp/register';
import { useLiveRecord } from '@/lib/live/use-live-record';
import { AgentResult } from '@/components/shared/agent-result';
import { toolsFor } from '@/lib/webmcp/tools';

/**
 * `curator` is the console chrome; `role` is who the session actually is.
 *
 * They were one flag, and the tool surface was registered from the chrome. A curator
 * reaching a record through the console's "Open record →" link, or anyone who had ever
 * clicked into the console in this browser, then landed on a community page holding a
 * signed `curator` cookie and was handed the nine community tools — every one of which
 * the server answered `403 Community role required`. Registration advertises what this
 * session may call, so it reads the role, and the chrome stays a matter of which page
 * this is.
 */
/** The host API cannot appear or vanish mid-document, so one read stands for the page. */
let cachedStatus: { available: boolean; legacy: boolean } | null = null;
const subscribeToNothing = () => () => {};
const readModelContext = () => (cachedStatus ??= modelContextStatus());
const readNoModelContext = () => null;

export function CommunityHeader({ curator=false, role='community' }: { curator?:boolean; role?:'community'|'curator' }) {
  const path=usePathname();
  const [failed,setFailed]=useState(false);
  /**
   * What this page registered, said out loud (V11-7).
   *
   * The console has carried a tool panel all along and the community pages carried
   * nothing, so a visiting agent had no way to learn the surface existed short of
   * calling `getTools()` unprompted — and one that did not simply drove the form, which
   * is the reading the page invited.
   *
   * Read through `useSyncExternalStore` rather than set from the effect: whether this
   * browser exposes the host API is a value the server cannot know, so the two renders
   * legitimately disagree and this is the hook that says so without a cascading render.
   * The snapshot is cached because the answer cannot change while the document lives,
   * and an object rebuilt on every read would never compare equal.
   */
  const mcp=useSyncExternalStore(subscribeToNothing,readModelContext,readNoModelContext);
  useEffect(()=>registerWebMcpTools(role),[role]);
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
    <>
    {/* Mounted with the header so every community page carries it, the same places the
        tool surface is registered (V11-8). */}
    <AgentResult />
    <header className={curator?'console-topbar':'site-header'}>
      <Link className="wordmark" href={curator?'/curator':'/'} aria-label="RE:TURN home">RE<span>:</span>TURN</Link>
      {curator ? <><div className="console-context"><b>Halcyon Museum</b><span>Curatorial workspace</span></div><button className="role-switch dark" onClick={switchRole}>View community collection <span>↗</span></button>{failed && <span role="status" className="switch-failed">Could not switch views. Try again.</span>}</> :
      <nav aria-label="Primary navigation">{failed && <span role="status" className="switch-failed">Could not switch views. Try again.</span>}<Link className={path==='/'?'active':''} href="/#collection">Collection</Link><Link href="/#about">How it works</Link><button className="curator-link" onClick={switchRole}>Curator console <span aria-hidden="true">↗</span></button>{mcp && <span className={mcp.available?'mcp-badge':'mcp-badge off'} title={mcp.available?`This page registers ${toolsFor(role).length} WebMCP tools. Agents should use them rather than filling the form.`:'This browser exposes no WebMCP host API. The same tools stay reachable over POST /api/tools/.'}><span aria-hidden="true">⌘</span>{mcp.available?`WebMCP · ${toolsFor(role).length} tools`:'WebMCP unavailable'}</span>}</nav>}
    </header>
    </>
  );
}
