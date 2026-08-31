'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ContributedImage = {
  id: string; url: string; alt: string; caption: string; addedLabel: string;
  width: number | null; height: number | null;
};

export type ContributedFile = {
  id: string; url: string; name: string; kind: string; kilobytes: number; caption: string;
};

/**
 * One contribution's material, kept with the words that came with it (FR2-D1).
 *
 * A separate "documents" section elsewhere on the page split a contribution in half:
 * the photographs sat in the card and the files sat somewhere else, so a reader had to
 * reassemble what one person had sent. Everything one person contributed belongs in
 * their card.
 *
 * Clicking a photograph opens it here rather than navigating away (FR2-C3 follow-up).
 * A new tab loses the record you were reading, and the asset route answers with an
 * image and nothing around it — no caption, no attribution, no way back.
 */
export function ContributedMedia({ images, files, title }: {
  images: ContributedImage[]; files: ContributedFile[]; title: string;
}) {
  const [opened, setOpened] = useState<ContributedImage | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Escape leaves by the same door as the close button, so focus lands back on the
  // photograph either way. A dialog that returns focus to the page body puts a keyboard
  // reader at the top of the document instead of where they were reading.
  const close = useCallback(() => {
    setOpened(null);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!opened) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opened, close]);

  if (images.length === 0 && files.length === 0) return null;

  return (
    <>
      {images.length > 0 && (
        <div className="contributed-media">
          {images.map((image, index) => (
            <figure key={image.id}>
              <button
                type="button" className="contributed-image-frame"
                aria-label={`Open ${image.caption || image.alt || `photograph ${index + 1}`} larger`}
                onClick={(event) => { openerRef.current = event.currentTarget; setOpened(image); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- protected asset route, not a static import */}
                <img src={image.url} alt={image.alt || `${title}, photograph ${index + 1}`}
                  width={image.width ?? undefined} height={image.height ?? undefined}
                  className={image.width && image.height ? 'natural-size' : undefined} />
                <span className="contributed-image-hint" aria-hidden="true">⤢</span>
              </button>
              <figcaption>
                <span>Community contribution · {image.addedLabel}</span>
                {image.caption || image.alt || 'Contributed photograph'}
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="contributed-files">
          {files.map((file) => (
            <li key={file.id}>
              <span className="file-mark" aria-hidden="true">{file.kind === 'audio' ? '◉' : '≡'}</span>
              <div>
                <a href={`${file.url}?download=1`} download>{file.caption || file.name}</a>
                <small><span className="file-kind">{file.kind}</span> · {file.kilobytes} KB · contributed with this material</small>
              </div>
              <span className="file-get" aria-hidden="true">↓</span>
            </li>
          ))}
        </ul>
      )}

      {opened && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={opened.caption || opened.alt || 'Contributed photograph'}>
          <button type="button" className="lightbox-scrim" aria-label="Close" onClick={close} />
          <div className="lightbox-panel">
            {/* eslint-disable-next-line @next/next/no-img-element -- protected asset route, not a static import */}
            <img src={opened.url} alt={opened.alt || title} />
            <div className="lightbox-foot">
              <div>
                <p className="gallery-origin"><span>Community contribution</span><time>{opened.addedLabel}</time></p>
                <p>{opened.caption || opened.alt || 'Contributed photograph'}</p>
              </div>
              <a className="gallery-download" href={`${opened.url}?download=1`} download>
                <span aria-hidden="true">↓</span> Download
              </a>
              <button type="button" ref={closeRef} className="lightbox-close" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
