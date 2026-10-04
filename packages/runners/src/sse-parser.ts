/**
 * Incremental Server-Sent Events parser. Feed it network chunks of any size and it
 * returns the `data:` payload of each event completed so far.
 */
export class SseParser {
  private buffer = '';

  feed(chunk: string): string[] {
    // A trailing lone CR may be the first half of a CRLF split across chunks: keep it pending.
    this.buffer = (this.buffer + chunk).replace(/\r\n|\r(?!$)/g, '\n');
    const payloads: string[] = [];

    for (let end = this.buffer.indexOf('\n\n'); end !== -1; end = this.buffer.indexOf('\n\n')) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);

      const data: string[] = [];
      for (const line of block.split('\n')) {
        // Empty lines and comments such as ": OPENROUTER PROCESSING" are keep-alives.
        if (line === '' || line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ +/, ''));
        }
      }
      if (data.length > 0) {
        payloads.push(data.join('\n'));
      }
    }
    return payloads;
  }
}
