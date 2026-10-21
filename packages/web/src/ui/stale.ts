import { createContext, useContext } from 'react';

/**
 * Whether what the page shows is the last known state rather than a live one: the stream dropped and is reconnecting,
 * or the server stopped answering. The app provides it from the stream state, and every state the page draws (a chip, a
 * card in the graph) reads it, so none of them can claim to be live while it is not (answer 3 of the sketches).
 */
export const StaleContext = createContext(false);

export function useStale(): boolean {
  return useContext(StaleContext);
}
