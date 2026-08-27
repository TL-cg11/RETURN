'use client';

import { useEffect } from 'react';

/** Give first-time visitors a signed default session before they switch roles or write. */
export function SessionBootstrap() {
  useEffect(() => {
    void fetch('/api/session', { cache: 'no-store' });
  }, []);
  return null;
}
