import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export const DEFAULT_WIDTH = 420;
export const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const MAX_VIEWPORT_FRACTION = 0.7;
const KEY_STEP = 16;
const STORAGE_KEY = 'cos-chat-width';

export const maxWidthFor = (viewportWidth: number): number =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * MAX_VIEWPORT_FRACTION)));

export function clampWidth(width: number, viewportWidth: number): number {
  const wanted = Number.isFinite(width) ? Math.round(width) : DEFAULT_WIDTH;
  return Math.min(maxWidthFor(viewportWidth), Math.max(MIN_WIDTH, wanted));
}

export function parseStoredWidth(raw: string | null, viewportWidth: number): number {
  const saved = raw ? Number(raw) : Number.NaN;
  return clampWidth(Number.isFinite(saved) ? saved : DEFAULT_WIDTH, viewportWidth);
}

// localStorage can throw (privacy modes, quota); width is a nicety, so ignore failures.
function readStoredWidth(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}

/** Width state plus props for a vertical drag handle on the panel's left edge. */
export function useResizableWidth() {
  const [width, setWidth] = useState(() => parseStoredWidth(readStoredWidth(), window.innerWidth));
  const widthRef = useRef(width);
  widthRef.current = width;
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const commit = useCallback((next: number) => {
    const clamped = clampWidth(next, window.innerWidth);
    setWidth(clamped);
    storeWidth(clamped);
  }, []);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('resizing');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    storeWidth(widthRef.current);
  };

  const handleProps = {
    role: 'separator',
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize chat panel',
    'aria-valuenow': width,
    'aria-valuemin': MIN_WIDTH,
    'aria-valuemax': maxWidthFor(window.innerWidth),
    tabIndex: 0,
    title: 'Drag to resize · double-click to reset',
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startX: e.clientX, startWidth: widthRef.current };
      document.body.classList.add('resizing');
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      // The handle sits on the left edge: moving left widens the panel.
      setWidth(clampWidth(drag.current.startWidth + (drag.current.startX - e.clientX), window.innerWidth));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: () => commit(DEFAULT_WIDTH),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') commit(widthRef.current + KEY_STEP);
      else if (e.key === 'ArrowRight') commit(widthRef.current - KEY_STEP);
      else return;
      e.preventDefault();
    },
  };

  return { width, handleProps };
}
