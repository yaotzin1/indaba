/**
 * A parser for Server-Sent Events, fed text as it arrives. The page reads the stream with `fetch` so it can send the
 * `Authorization` header, which the browser's `EventSource` cannot (AC-05); this is the part `EventSource` would
 * otherwise do.
 */

export interface SseEvent {
  /** The `id:` field, when it is a whole number; the client resumes from the last one. */
  readonly id: number | undefined;
  /** The `event:` field, or `message` when there is none. */
  readonly event: string;
  readonly data: string;
}

/** Text held while waiting for the end of an event. A stream that never ends one is dropped rather than grown. */
export const MAX_PENDING_CHARS = 4_000_000;

export class SseParser {
  private pending = '';

  /** The events completed by this chunk, in order. */
  push(chunk: string): SseEvent[] {
    this.pending = (this.pending + chunk).replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let end = this.pending.indexOf('\n\n');
    while (end >= 0) {
      const event = parseBlock(this.pending.slice(0, end));
      if (event !== undefined) {
        events.push(event);
      }
      this.pending = this.pending.slice(end + 2);
      end = this.pending.indexOf('\n\n');
    }
    if (this.pending.length > MAX_PENDING_CHARS) {
      this.pending = '';
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | undefined {
  let id: number | undefined;
  let event = 'message';
  const data: string[] = [];
  let sawData = false;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) {
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'data') {
      data.push(value);
      sawData = true;
    } else if (field === 'event') {
      event = value;
    } else if (field === 'id') {
      const n = Number(value);
      id = value !== '' && Number.isSafeInteger(n) && n >= 0 ? n : id;
    }
  }
  return sawData ? { id, event, data: data.join('\n') } : undefined;
}
