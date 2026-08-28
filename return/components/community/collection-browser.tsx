'use client';

import { NavLink as Link } from '@/components/shared/nav-link';
import type { CollectionObject } from '@/lib/domain/types';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

type CollectionItem = Pick<CollectionObject, 'id' | 'title' | 'date' | 'gap' | 'status' | 'tone'>;

function pageFromLocation(pageCount: number) {
  const value = Number(new URLSearchParams(location.search).get('page')) || 1;
  return Math.min(Math.max(1, value), pageCount);
}

/**
 * Keeps collection paging in place while retaining real links as the no-JS path.
 * vinext's Link is intentionally not involved: these anchors work on their own and
 * are enhanced only after hydration.
 */
export function CollectionBrowser({
  collection,
  initialPage,
  perPage,
}: {
  collection: CollectionItem[];
  initialPage: number;
  perPage: number;
}) {
  const pageCount = Math.max(1, Math.ceil(collection.length / perPage));
  const [current, setCurrent] = useState(initialPage);
  const [reservedHeight, setReservedHeight] = useState<number>();
  const list = useRef<HTMLDivElement>(null);
  const pendingView = useRef<{ x: number; y: number } | null>(null);
  const start = (current - 1) * perPage;
  const shown = useMemo(() => collection.slice(start, start + perPage), [collection, perPage, start]);

  useEffect(() => {
    const onPopState = () => setCurrent(pageFromLocation(pageCount));
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, [pageCount]);

  useLayoutEffect(() => {
    const measure = () => {
      const row = list.current?.querySelector<HTMLElement>('.object-row');
      if (row) setReservedHeight(row.getBoundingClientRect().height * perPage + 1);
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [perPage]);

  useLayoutEffect(() => {
    const view = pendingView.current;
    if (!view) return;
    pendingView.current = null;
    // Replacing six rows with two can trigger scroll anchoring even without navigation.
    // Restore the exact pre-click viewport before paint so there is no visible jump.
    scrollTo({ left: view.x, top: view.y, behavior: 'instant' });
  }, [current]);

  function choose(event: MouseEvent<HTMLAnchorElement>, page: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (page === current || page < 1 || page > pageCount) return;
    const url = new URL(location.href);
    url.searchParams.set('page', String(page));
    // The fallback href keeps the anchor. The enhanced URL deliberately does not:
    // setting a new hash can trigger an anchor scroll even when pushState is used.
    url.hash = '';
    history.pushState(null, '', url);
    pendingView.current = { x: scrollX, y: scrollY };
    setCurrent(page);
  }

  return (
    <>
      <div className="object-list" ref={list} style={{ minHeight: reservedHeight }} aria-live="polite" aria-label={`Collection page ${current} of ${pageCount}`}>
        {shown.map((object, index) => (
          <Link className="object-row" href={`/objects/${object.id}`} key={object.id}>
            <span className="object-number">{String(start + index + 1).padStart(2, '0')}</span>
            <span className={`object-thumbnail ${object.tone}`} aria-hidden="true"><i /></span>
            <span className="object-name"><strong>{object.title}</strong><small>{object.date}</small></span>
            <span className="object-note">{object.gap ? `Unrecorded ${object.gap}` : object.status}</span>
            <span className="row-arrow" aria-hidden="true">↗</span>
          </Link>
        ))}
      </div>

      {pageCount > 1 && (
        <nav className="pager" aria-label="Collection pages">
          <Link className={current === 1 ? 'disabled' : ''} aria-disabled={current === 1}
            href={`/?page=${Math.max(1, current - 1)}#collection`} onClick={(event) => choose(event, current - 1)}>← Previous</Link>
          <span className="pager-pages">
            {Array.from({ length: pageCount }, (_, position) => position + 1).map((number) => (
              <Link aria-current={number === current ? 'page' : undefined} className={number === current ? 'active' : ''}
                href={`/?page=${number}#collection`} key={number} onClick={(event) => choose(event, number)}>{number}</Link>
            ))}
          </span>
          <Link className={current === pageCount ? 'disabled' : ''} aria-disabled={current === pageCount}
            href={`/?page=${Math.min(pageCount, current + 1)}#collection`} onClick={(event) => choose(event, current + 1)}>Next →</Link>
        </nav>
      )}
      <p className="pager-count">Showing {start + 1}–{start + shown.length} of {collection.length} objects</p>
    </>
  );
}
