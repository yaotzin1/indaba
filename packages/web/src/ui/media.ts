import { useEffect, useState } from 'react';

/** Below this width the graph runs top to bottom (answer 5 of the sketches): the same 640 px the step list uses. */
export const NARROW = '(max-width: 639px)';

function mediaList(query: string): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : undefined;
}

/**
 * Whether a media query matches now, following it as the window is resized or a phone is turned. False where the
 * browser cannot say (no `matchMedia`), so the page then keeps its wide layout.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaList(query)?.matches ?? false);
  useEffect(() => {
    const media = mediaList(query);
    if (media === undefined) {
      return;
    }
    const onChange = (): void => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
