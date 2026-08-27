'use client';

import { NavLink as Link } from '@/components/shared/nav-link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { registerWebMcpTools } from '@/lib/webmcp/register';
import { curatorTools } from '@/lib/webmcp/tools';

export type PendingApproval = {
  id: string; objectId: string; objectTitle: string; currentLabel: string;
  snapshot: string; objectVersion: number;
};

const NAV = [
  { href: '/curator', label: 'Overview', icon: '⌂' },
  { href: '/curator/submissions', label: 'Submissions', icon: '↓' },
  { href: '/curator/objects', label: 'Objects', icon: '◇' },
  { href: '/curator/activity', label: 'Activity', icon: '≋' },
] as const;

const RISK_LADDER = [
  ['LOW', 'Read, compare, draft', 'Runs immediately'],
  ['MEDIUM', 'Submit evidence, ask a contributor', 'Runs and is logged'],
  ['HIGH', 'Publish a label, open a stewardship review', 'Waits for a human curator'],
  ['CRITICAL', 'Delete evidence, transfer custody', 'Never available to an agent'],
] as const;

export function CuratorShell({
  children, approval, pendingCount, submissionCount,
}: {
  children: ReactNode; approval: PendingApproval | null; pendingCount: number; submissionCount: number;
}) {
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState<'tools' | 'policy' | null>(null);
  const [mcpAvailable, setMcpAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState(approval?.snapshot ?? '');
  const [resolved, setResolved] = useState('');
  const [error, setError] = useState('');
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => registerWebMcpTools('curator'), []);

  // Reset the editable draft when a different approval arrives, during render
  // rather than in an effect, so no cascading render is queued.
  const [shownApproval, setShownApproval] = useState(approval?.id ?? '');
  if ((approval?.id ?? '') !== shownApproval) {
    setShownApproval(approval?.id ?? '');
    setDraft(approval?.snapshot ?? '');
    setResolved('');
  }

  useEffect(() => {
    const open = () => setDrawer(true);
    window.addEventListener('open-approval', open);
    return () => window.removeEventListener('open-approval', open);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const panelElement = drawerRef.current;
    const focusable = panelElement?.querySelectorAll<HTMLElement>('button, textarea, [href]');
    focusable?.[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(false);
      if (event.key === 'Tab' && focusable?.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [drawer]);

  async function switchToCommunity() {
    await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'community' }) });
    location.href = '/';
  }

  async function resetWorkspace() {
    await fetch('/api/reset', { method: 'POST' });
    location.href = '/curator';
  }

  async function resolve(action: 'approved' | 'rejected') {
    if (!approval) return;
    setError('');
    const response = await fetch(`/api/curator/approvals/${approval.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, draft }),
    });
    if (!response.ok) { setError('Could not save this decision.'); return; }
    const data = await response.json() as { resolution?: string };
    setResolved(data.resolution ?? action);
    setTimeout(() => { setDrawer(false); router.refresh(); }, 900);
  }

  return (
    <div className="console-shell">
      <header className="console-topbar">
        <Link className="wordmark inverse" href="/curator">RE<span>:</span>TURN</Link>
        <div className="console-context"><b>Halcyon Museum</b><span>Curatorial workspace</span></div>
        <div className="console-actions">
          <button type="button" className="approval-trigger" onClick={() => setDrawer(true)} disabled={!approval}>
            <i>{pendingCount}</i> {approval ? 'Pending approval' : 'No pending approval'}
          </button>
          <button type="button" className="role-switch dark" onClick={switchToCommunity}>Community view ↗</button>
          <span className="avatar">MK</span>
        </div>
      </header>

      <aside className="console-nav">
        <div>
          <small>Workspace</small>
          {NAV.map((item) => (
            <Link className={path === item.href ? 'active' : ''} href={item.href} key={item.href}>
              <span>{item.icon}</span>{item.label}
              {item.label === 'Submissions' && submissionCount > 0 && <b>{submissionCount}</b>}
            </Link>
          ))}
        </div>
        <div>
          <small>System</small>
          <button type="button" onClick={() => setPanel(panel === 'policy' ? null : 'policy')}><span>◉</span>Policy gateway</button>
          <button
            type="button"
            onClick={() => {
              // Read the browser surface as the panel opens, so the status
              // reflects this session rather than a stale render.
              setMcpAvailable(typeof document !== 'undefined' && !!document.modelContext);
              setPanel(panel === 'tools' ? null : 'tools');
            }}
          >
            <span>⌘</span>WebMCP tools <b className="tool-count">{curatorTools.length}</b>
          </button>
          <button type="button" onClick={resetWorkspace}><span>↺</span>Fresh workspace</button>
        </div>
        <p>Demo workspace<br /><strong>Fictional collection</strong></p>
      </aside>

      <div className="console-content">{children}</div>

      {panel && (
        <>
          <button className="drawer-scrim" aria-label="Close panel" onClick={() => setPanel(null)} />
          <aside className="approval-drawer system-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
            <header>
              <div>
                <p className="risk-label">{panel === 'tools' ? 'Agent surface' : 'Server-side enforcement'}</p>
                <h2 id="panel-title">{panel === 'tools' ? 'WebMCP tools in this session' : 'Policy gateway'}</h2>
                <span>{panel === 'tools' ? `${curatorTools.length} curator tools registered` : 'Every consequential call passes through it'}</span>
              </div>
              <button type="button" onClick={() => setPanel(null)} aria-label="Close">×</button>
            </header>

            {panel === 'tools' ? (
              <section>
                <p className="mcp-status">
                  <i className={mcpAvailable ? 'verified-dot' : 'question-dot'} />
                  {mcpAvailable
                    ? 'document.modelContext is available — these tools are live in this browser.'
                    : 'document.modelContext is not exposed by this browser, so nothing is registered here. The same tools stay reachable over /api/tools/.'}
                </p>
                <p>These tools are registered on the curator surface only. Community pages register a different set of six. The server re-checks the role on every call.</p>
                <ul className="tool-list">
                  {curatorTools.map((tool) => (
                    <li key={tool.name}>
                      <code>{tool.name}</code>
                      <span className={tool.readOnly ? 'verified-badge' : 'submitted-badge'}>{tool.readOnly ? 'read only' : 'write'}</span>
                      {tool.untrusted && <span className="submitted-badge">external content</span>}
                      <p>{tool.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section>
                <p>Risk is judged by how far a result reaches, not by how large the request looks. The gateway reads the actor, the workspace, evidence authority, consent, and visibility—never the wording of a submitted document.</p>
                <ul className="tool-list">
                  {RISK_LADDER.map(([grade, examples, handling]) => (
                    <li key={grade}>
                      <code>{grade}</code>
                      <p><strong>{handling}.</strong> {examples}.</p>
                    </li>
                  ))}
                </ul>
                <p className="image-disclaimer">Submitted evidence may inform the record. It may not authorize a change to the record by itself.</p>
              </section>
            )}
          </aside>
        </>
      )}

      {drawer && approval && (
        <>
          <button className="drawer-scrim" aria-label="Close approval drawer" onClick={() => setDrawer(false)} />
          <aside ref={drawerRef} className="approval-drawer" role="dialog" aria-modal="true" aria-labelledby="approval-title">
            <header>
              <div>
                <p className="risk-label">High risk · Official record</p>
                <h2 id="approval-title">Review label revision</h2>
                <span>{approval.id} · {approval.objectTitle}</span>
              </div>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close">×</button>
            </header>

            {resolved ? (
              <div className="resolved-state">
                <span>✓</span>
                <h3>{resolved === 'rejected' ? 'Proposal rejected' : resolved === 'approved_with_edit' ? 'Approved with your edit' : 'Revision approved'}</h3>
                <p>{resolved === 'rejected'
                  ? 'No change was made to the public record.'
                  : `Revision ${approval.objectVersion + 1} is now the public record.`}</p>
              </div>
            ) : (
              <>
                <section className="policy-decision">
                  <span>Policy Gateway</span>
                  <strong>Human approval required</strong>
                  <p>Official publication changes what the public sees. Evidence authority and consent checks passed.</p>
                </section>
                <section>
                  <h3>Current label</h3>
                  <p className="before-copy">{approval.currentLabel}</p>
                  <h3>Curator-edited version</h3>
                  <textarea aria-label="Curator-edited label" rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} />
                  {draft !== approval.snapshot && <p className="image-disclaimer">Edited. This will be recorded as approve-with-edit.</p>}
                </section>
                {error && <p className="clarify-result" role="alert">{error}</p>}
                <footer>
                  <button type="button" className="reject-action" onClick={() => resolve('rejected')}>Reject</button>
                  <button type="button" className="approve-action" onClick={() => resolve('approved')}>
                    {draft === approval.snapshot ? 'Approve' : 'Approve with edit'} <span aria-hidden="true">→</span>
                  </button>
                </footer>
              </>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
