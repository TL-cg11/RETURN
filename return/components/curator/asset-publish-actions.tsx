'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Asset = { id: string; file_name: string; kind: string; visibility: string; consent: string; alt_text: string };

/**
 * The act that makes a contributed file public.
 *
 * Uploads arrive `restricted` on purpose, so without this control nothing could
 * ever be displayed. The server judges consent; this only offers the choice, and
 * hides it entirely for material whose consent forbids public display, so a curator
 * is not invited to attempt something the gateway will refuse.
 */
export function AssetPublishActions({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [pending, setPending] = useState('');
  const [result, setResult] = useState('');

  async function toggle(asset: Asset) {
    const publish = asset.visibility !== 'public';
    setPending(asset.id);
    setResult('');
    const response = await fetch(`/api/curator/assets/${asset.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publish }),
    });
    const data = await response.json() as { reason?: string; recovery?: string };
    setPending('');
    if (!response.ok) {
      setResult(`${data.reason ?? 'The change was refused.'} ${data.recovery ?? ''}`.trim());
      return;
    }
    setResult(publish ? 'Now visible on the public record.' : 'Withdrawn from public display.');
    router.refresh();
  }

  return (
    <div className="asset-publish">
      <ul>
        {assets.map((asset) => {
          const publishable = asset.consent !== 'private';
          const isPublic = asset.visibility === 'public';
          return (
            <li key={asset.id}>
              <span className="asset-publish-name">{asset.file_name}</span>
              <span className={`asset-state ${isPublic ? 'is-public' : ''}`}>{isPublic ? 'On the public record' : 'Curatorial review only'}</span>
              {publishable ? (
                <button type="button" disabled={pending === asset.id} onClick={() => toggle(asset)}>
                  {pending === asset.id ? '…' : isPublic ? 'Withdraw' : 'Publish'}
                </button>
              ) : (
                <span className="asset-state">Consent forbids display</span>
              )}
            </li>
          );
        })}
      </ul>
      {result && <p className="clarify-result" role="status">{result}</p>}
    </div>
  );
}
