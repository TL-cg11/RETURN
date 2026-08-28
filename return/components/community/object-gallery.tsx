'use client';

import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

export type GalleryImage = {
  id: string;
  alt: string;
  caption: string;
  url: string;
  sourceLabel: 'Museum collection image' | 'Community contribution';
  addedLabel: string;
  width: number | null;
  height: number | null;
};

/** Matches `background-size: 280%` on the photographic lens, so both magnify alike. */
const LENS_ZOOM = 2.8;
const LENS_STEP = 0.06;

/**
 * The object's photographs (FR-M1, FR-M2, FR-M3), and the drawn stand-in when a record
 * has none (FR2-M1).
 *
 * Contains rather than covers. A museum object photograph that is cropped to fill a
 * frame has had part of the object removed from the record, which is the opposite of
 * what this page is for; empty margin is the honest cost.
 *
 * The magnifier is opt-in, because a lens that follows the pointer unasked makes the
 * page hard to read. Over a photograph it samples the file itself, so what it reveals is
 * real resolution rather than an upscale.
 *
 * Over the drawn stand-in there is no file to sample, so the lens renders a second copy
 * of the same artwork under a transform. It is CSS geometry, so it scales without
 * blurring — but it cannot reveal anything the page was not already showing. The control
 * is present so the collection behaves the same way on every record; a record with a
 * real photograph is where the magnifier earns its keep.
 *
 * Turning it on places the lens at the centre and focuses the frame, so it is usable
 * without a pointer: arrow keys move the lens and Escape puts it away (RETURN_PLAN
 * §20.4). A feature only reachable by hovering is not reachable at all for some people.
 */
export function ObjectGallery({ images, children }: { images: GalleryImage[]; children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [zooming, setZooming] = useState(false);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  // The drawn lens places a scaled copy in pixels, so it needs the frame's real size.
  // The photographic lens works in percentages and never reads this.
  const [frameBox, setFrameBox] = useState<{ w: number; h: number } | null>(null);
  // Which input last placed the lens. The pointer and the keyboard want opposite
  // things when the pointer leaves the frame, and only this tells them apart.
  const drivenBy = useRef<'pointer' | 'keyboard'>('pointer');
  const frame = useRef<HTMLDivElement>(null);

  const hasPhotos = images.length > 0;
  const current = hasPhotos ? images[Math.min(index, images.length - 1)] : null;
  const step = (by: number) => { setIndex((now) => (now + by + images.length) % images.length); setLens(null); };
  const clamp = (value: number) => Math.min(1, Math.max(0, value));

  function measure() {
    const box = frame.current?.getBoundingClientRect();
    if (box) setFrameBox({ w: box.width, h: box.height });
    return box;
  }

  function toggleZoom() {
    if (zooming) { setZooming(false); setLens(null); return; }
    setZooming(true);
    drivenBy.current = 'keyboard';
    measure();
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
    drivenBy.current = 'keyboard';
    // Re-measured here so a resize between key presses cannot leave a keyboard user's
    // lens sampling the wrong part of the frame.
    measure();
    setLens((now) => ({ x: clamp((now?.x ?? 0.5) + move[0]), y: clamp((now?.y ?? 0.5) + move[1]) }));
  }

  function track(event: MouseEvent<HTMLDivElement>) {
    if (!zooming) return;
    drivenBy.current = 'pointer';
    const box = measure();
    if (!box) return;
    setLens({
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    });
  }

  /**
   * The lens belongs to the pointer while the pointer is driving it, so it leaves with
   * the pointer rather than hanging over the artwork marking a place nobody is looking at.
   *
   * It does not leave for a keyboard user. The pointer can sit anywhere on the page, or
   * cross the frame's edge by accident, while someone steps the lens with the arrow
   * keys — clearing it then would take the magnifier away mid-use from the person who
   * has no other way to move it. `zooming` stays true either way, so the magnifier is
   * still on and re-entering the frame picks it straight back up.
   */
  function release() {
    if (drivenBy.current === 'pointer') setLens(null);
  }

  const subject = hasPhotos ? 'photograph' : 'illustration';

  return (
    <div className="object-gallery">
      <div
        className={`gallery-frame${zooming ? ' is-zooming' : ''}${hasPhotos ? '' : ' holds-drawing'}`}
        ref={frame}
        onMouseMove={track}
        onMouseLeave={release}
        onKeyDown={steer}
        tabIndex={zooming ? 0 : -1}
        aria-label={zooming ? `Magnified ${subject}. Use the arrow keys to move the magnifier, Escape to close it.` : undefined}
      >
        {current ? (
          /* eslint-disable-next-line @next/next/no-img-element -- served from R2 through /api/assets, not a static import */
          <img src={current.url} alt={current.alt} width={current.width ?? undefined} height={current.height ?? undefined}
            className={current.width && current.height ? 'natural-size' : undefined} />
        ) : (
          <div className="gallery-drawn">{children}</div>
        )}

        {zooming && lens && (current ? (
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
        ) : frameBox && (
          <span className="gallery-lens holds-drawing" aria-hidden="true" style={{ left: `${lens.x * 100}%`, top: `${lens.y * 100}%` }}>
            {/* The copy's own origin sits at the lens centre, so translating it by the
                scaled pointer offset puts the point under the pointer exactly in the
                middle. The lens's pixel size never enters the arithmetic. */}
            <span
              className="lens-copy"
              style={{
                width: `${frameBox.w}px`,
                height: `${frameBox.h}px`,
                transform: `translate(${-LENS_ZOOM * lens.x * frameBox.w}px, ${-LENS_ZOOM * lens.y * frameBox.h}px) scale(${LENS_ZOOM})`,
              }}
            >
              <div className="gallery-drawn">{children}</div>
            </span>
          </span>
        ))}

        {images.length > 1 && (
          <>
            <button type="button" className="gallery-arrow prev" onClick={() => step(-1)} aria-label="Previous photograph">‹</button>
            <button type="button" className="gallery-arrow next" onClick={() => step(1)} aria-label="Next photograph">›</button>
          </>
        )}
      </div>

      <div className="gallery-foot">
        <div className="gallery-caption">
          {current ? (
            <>
              <p className="gallery-origin"><span>{current.sourceLabel}</span><time>{current.addedLabel}</time></p>
              <p>{current.caption || current.alt}</p>
            </>
          ) : (
            <p>No photograph has been published for this record yet. The illustration stands in for one.</p>
          )}
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
        {/* The photograph on screen is a view of a file; this hands over the file itself.
            The drawn stand-in is not a file, so there is nothing to offer. */}
        {current && (
          <a className="gallery-download" href={`${current.url}?download=1`} download>
            <span aria-hidden="true">↓</span> Download
          </a>
        )}
        <button
          type="button"
          className={`gallery-zoom${zooming ? ' active' : ''}`}
          aria-pressed={zooming}
          onClick={toggleZoom}
        >
          <span aria-hidden="true">⌕</span> {zooming ? 'Magnifier on' : 'Magnify'}
        </button>
      </div>
      {zooming && (
        <p className="form-help">
          Move the pointer over the {subject} to magnify it, or use the arrow keys. The lens
          follows the pointer and clears when it leaves. Escape closes the magnifier.
          {!hasPhotos && ' The illustration is drawn rather than photographed, so magnifying it enlarges the same detail rather than revealing more.'}
        </p>
      )}
    </div>
  );
}
