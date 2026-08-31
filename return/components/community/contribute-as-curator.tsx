'use client';

import { useState } from 'react';
import { NavLink as Link } from '@/components/shared/nav-link';

/**
 * What a curator session sees instead of the contribution form (V7-12).
 *
 * A curator may not file a community contribution, and that is the authority model
 * rather than a permission detail: a contribution is evidence the museum *received*,
 * and a record the museum *asserts* is a different thing with a different weight. If a
 * curator could file one, `submitted` and `verified` would stop meaning anything and
 * the public page could no longer say where a claim came from.
 *
 * The rule was already enforced — by the route, by the tool surface, and by a unit
 * test. What was missing is that it was enforced *last*: the form rendered in full and
 * refused on the final click, after four steps of typing. Every other rule in this
 * system is checked at the door, and this one is now too.
 *
 * The server refusal stays exactly as it was. `RETURN_PLAN.md` §4.2 asks for both a
 * registration step and a server check, for the same reason a locked door and a guard
 * are not redundant.
 */
export function ContributeAsCurator({ objectId, objectTitle }: { objectId: string; objectTitle: string }) {
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);

  async function viewAsCommunity() {
    setSwitching(true);
    setFailed(false);
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'community' }),
    }).catch(() => null);
    const session = response?.ok ? await response.json().catch(() => null) as { role?: string } | null : null;
    // Only reload once the server confirms the role it signed. Navigating on an
    // unconfirmed switch is what sent a reader to a bare 404 in F6-8.
    if (session?.role !== 'community') { setSwitching(false); setFailed(true); return; }
    location.reload();
  }

  return (
    <section className="curator-detour" aria-labelledby="curator-detour-title">
      <p className="eyebrow">Curatorial session</p>
      <h1 id="curator-detour-title">This form files community evidence.</h1>
      <p className="curator-detour-lede">
        You are signed in as a curator, and a contribution is material the museum has
        <em> received</em> rather than material it asserts. Keeping those apart is what lets
        the public record say where a claim came from, so the museum does not file
        contributions to itself.
      </p>

      <div className="curator-detour-paths">
        <div>
          <h2>To add to this record as the museum</h2>
          <p>
            Register a record or propose a label revision from the console. Both enter human
            approval, and both are recorded as the museum&rsquo;s own account.
          </p>
          <Link className="primary-action" href="/curator/objects">
            Open the curator console <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div>
          <h2>To file this as a contribution</h2>
          <p>
            Switch to the community view. You will come back to this form for
            {' '}<strong>{objectTitle}</strong>, and what you file will be recorded as submitted
            evidence awaiting review.
          </p>
          <button type="button" className="text-action" disabled={switching} onClick={viewAsCommunity}>
            {switching ? 'Switching…' : 'View as community'}
          </button>
          {failed && <p role="status" className="form-help">Could not switch views. Try again.</p>}
        </div>
      </div>

      <p className="form-help">
        <Link href={`/objects/${objectId}`}>← Back to {objectTitle}</Link>
      </p>
    </section>
  );
}
