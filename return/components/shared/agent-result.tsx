'use client';

import { useEffect, useState } from 'react';
import { TOOL_RESULT_EVENT, type ToolResultDetail } from '@/lib/webmcp/register';

/**
 * What an agent just did on this page, said on the page (V11-8).
 *
 * The contribution form ends on a receipt: a page that says the material arrived and
 * what happens to it next. A contribution filed through the tool surface got no such
 * moment. The server answered the agent, the agent answered its own operator, and the
 * page the person was looking at sat still until the live poll caught up. The two paths
 * did the same thing and only one of them said so.
 *
 * This listens rather than navigates. A tool that moves the browser under its caller has
 * a side effect nobody asked for, and it would take the answer away from the agent as
 * well. So the page hears the result and acknowledges it in place; the contribution list
 * below still fills in on its own a moment later.
 *
 * Reads are ignored. Nothing happened, so there is nothing to acknowledge, and a panel
 * that flashed on every lookup would be noise where this is meant to be a receipt.
 */

type Shown = { tone: 'applied' | 'queued' | 'refused'; heading: string; detail: string; reference?: string };

function describe(detail: ToolResultDetail): Shown | null {
  if (detail.readOnly) return null;
  const result = detail.result;
  if (!result || typeof result !== 'object') return null;

  if (result.outcome === 'applied') {
    if (result.submission_id) {
      return {
        tone: 'applied',
        heading: 'Contribution received',
        detail: 'It is with the curatorial team now. The public label has not changed.',
        reference: result.submission_id,
      };
    }
    if (typeof result.attached === 'number') {
      return {
        tone: 'applied',
        heading: `${result.attached} file${result.attached === 1 ? '' : 's'} attached`,
        detail: 'Attached material stays private until a curator publishes it.',
      };
    }
    return { tone: 'applied', heading: 'Done', detail: result.reason ?? 'The action was within authority.' };
  }

  if (result.outcome === 'pending_approval') {
    return {
      tone: 'queued',
      heading: 'Waiting on a curator',
      detail: 'Nothing was published. A person decides whether this reaches the official record.',
    };
  }

  // `denied` and `invalid` both belong here: one is the gateway refusing, the other is
  // the caller getting it wrong, and a reader watching an agent work wants to see either.
  if (result.outcome === 'denied' || result.outcome === 'invalid') {
    return {
      tone: 'refused',
      heading: result.outcome === 'denied' ? 'Refused by the policy gateway' : 'The call was not accepted',
      detail: result.reason ?? 'The request did not go through.',
      reference: result.policy,
    };
  }

  return null;
}

export function AgentResult() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    function onResult(event: Event) {
      const described = describe((event as CustomEvent<ToolResultDetail>).detail);
      if (described) setShown(described);
    }
    window.addEventListener(TOOL_RESULT_EVENT, onResult);
    return () => window.removeEventListener(TOOL_RESULT_EVENT, onResult);
  }, []);

  if (!shown) return null;

  return (
    // `status` rather than `alert`: this reports what happened rather than interrupting,
    // and a refusal here is still a report — the agent already has the full answer.
    <aside className={`agent-result ${shown.tone}`} role="status" aria-live="polite">
      <div>
        <p className="agent-result-head">
          <span className="agent-result-mark" aria-hidden="true">⌘</span>
          Filed by an agent
        </p>
        <strong>{shown.heading}</strong>
        <p>{shown.detail}</p>
        {shown.reference && <code>{shown.reference}</code>}
      </div>
      <button type="button" onClick={() => setShown(null)} aria-label="Dismiss">×</button>
    </aside>
  );
}
