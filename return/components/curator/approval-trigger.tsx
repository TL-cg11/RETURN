'use client';

import type { ReactNode } from 'react';

/** Opens the global approval drawer owned by CuratorShell. */
export function ApprovalTrigger({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('open-approval'))}>
      {children}
    </button>
  );
}
