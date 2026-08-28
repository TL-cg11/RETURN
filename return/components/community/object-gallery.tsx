'use client';

import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

export type GalleryImage = {
  id: string;
  alt: string;
  caption: string;
  url: string;
  sourceLabel: 'Museum collection image' | 'Community contribution';
  addedLabel: string;
};

/**
 * The object's photographs (FR-M1, FR-M2, FR-M3).
 *
 * Contains rather than covers. A museum object photograph that is cropped to fill a
 * frame has had part of the object removed from the record, which is the opposite of
 * what this page is for; empty margin is the honest cost.
 *
 * The magnifier is opt-in, because a lens that follows the pointer unasked makes the
 * page hard to read. It uses the same source image at its natural size, so what it
 * shows is real resolution rather than an upscale.
 *
 * Turning it on places the lens at the centre and focuses the frame, so it is usable
 * without a pointer: arrow keys move the lens and Escape puts it away (RETURN_PLAN
 * §20.4). A feature only reachable by hovering is not reachable at all for some people.
 */
export function ObjectGallery({ images, children }: { images: GalleryImage[]; children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [zooming, setZooming] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  if (images.length === 0) return <>{children}</>;

  const current = images[Math.min(index, images.length - 1)];
  const step = (by: number) => { setIndex((now) => (now + by + images.length) % images.length); setLens(null); };

  const LENS_STEP = 0.06;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));

  function toggleZoom() {
    if (zooming) { setZooming(false); setLens(null); return; }
    setZooming(true);
    // Start at the centre so the lens exists before the pointer or the arrow keys move it.
    setLens({ x: 0.5, y: 0.5 });
    frame.current?.focus();
  }

  function steer(event: KeyboardEvent<HTMLDivElement>) {
    if (!zooming) return;
    if (event.key === 'Escape') { setZooming(false); setLens(null); return; }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-LENS_STEP, 0], ArrowRight: [LENS_STEP, 0],
      ArrowUp: [0, -LENS_STEP], ArrowDown: [0, LENS_STEP],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setLens((now) => ({ x: clamp((now?.x ?? 0.5) + move[0]), y: clamp((now?.y ?? 0.5) + move[1]) }));
  }

  function track(event: MouseEvent<HTMLDivElement>) {
    if (!zooming || !frame.current) return;
    const box = frame.current.getBoundingClientRect();
    setLens({
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    });
  }

  return (
    <div className="object-gallery">
      <div
        className={`gallery-frame${zooming ? ' is-zooming' : ''}`}
        ref={frame}
        onMouseMove={track}
        onMouseLeave={() => zooming && setLens({ x: 0.5, y: 0.5 })}
        onKeyDown={steer}
        tabIndex={zooming ? 0 : -1}
        aria-label={zooming ? 'Magnified photograph. Use the arrow keys to move the magnifier, Escape to close it.' : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from R2 through /api/assets, not a static import */}
        <img src={current.url} alt={current.alt} />
        {zooming && lens && (
          <span
            className="gallery-lens"
            aria-hidden="true"
            style={{
              left: `${lens.x * 100}%`,
              top: `${lens.y * 100}%`,
              backgroundImage: `url(${current.url})`,
              backgroundPosition: `${lens.x * 100}% ${lens.y * 100}%`,
            }}
          />
        )}

        {images.length > 1 && (
          <>
            <button type="button" className="gallery-arrow prev" onClick={() => step(-1)} aria-label="Previous photograph">‹</button>
            <button type="button" className="gallery-arrow next" onClick={() => step(1)} aria-label="Next photograph">›</button>
          </>
        )}
      </div>

      <div className="gallery-foot">
        <div className="gallery-caption">
          <p className="gallery-origin"><span>{current.sourceLabel}</span><time>{current.addedLabel}</time></p>
          <p>{current.caption || current.alt}</p>
          {images.length > 1 && (
            <div className="gallery-dots" role="tablist" aria-label="Photographs">
              {images.map((image, position) => (
                <button
                  type="button" key={image.id} role="tab"
                  aria-selected={position === index}
                  aria-label={`Photograph ${position + 1} of ${images.length}`}
                  className={position === index ? 'active' : ''}
                  onClick={() => { setIndex(position); setLens(null); }}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`gallery-zoom${zooming ? ' active' : ''}`}
          aria-pressed={zooming}
          onClick={toggleZoom}
        >
          <span aria-hidden="true">⌕</span> {zooming ? 'Magnifier on' : 'Magnify'}
        </button>
      </div>
      {zooming && <p className="form-help">Move the pointer over the photograph to magnify it, or use the arrow keys. Escape closes the magnifier.</p>}
    </div>
  );
}
