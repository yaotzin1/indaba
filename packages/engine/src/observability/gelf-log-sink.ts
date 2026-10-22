import type { LogLevel, LogRecord } from '@indaba/core';
import { RemoteLogSink, type RemoteLogSinkOptions } from './remote-log-sink.js';
import {
  type CollectorAddress,
  DatagramConnection,
  parseCollectorAddress,
  postJson,
  StreamConnection,
} from './remote-transport.js';

export interface GelfLogSinkOptions extends RemoteLogSinkOptions {
  /** `http(s)://host:port/gelf`, `tcp://host:port` or `udp://host:port`, from the configuration only (AC-16). */
  readonly address: string;
  /** The `host` field of every message: the machine the records come from. */
  readonly source: string;
  /** For the HTTP input, sent as the `Authorization` header. Read by the caller from a named variable. */
  readonly credential?: string;
  /** The process id, the first half of every UDP chunk id, so two processes' chunks never mix. */
  readonly pid?: number;
}

/** GELF levels are syslog severities. */
const SYSLOG: Readonly<Record<LogLevel, number>> = { error: 3, warn: 4, info: 6, debug: 7 };

/** A GELF additional field name: letters, digits, `_`, `.` and `-`; `_id` is reserved by the format. */
function fieldName(key: string): string {
  const name = `_${key.replace(/[^\w.-]/g, '_')}`;
  return name === '_id' ? '_field_id' : name;
}

/**
 * The GELF 1.1 message of a record: `short_message` is the fixed sentence, the component, the context, the process id
 * and every field are additional fields. `timestamp` is the record's own time in seconds, never the clock of the send.
 */
export function toGelf(record: LogRecord, source: string): Record<string, string | number | boolean> {
  const message: Record<string, string | number | boolean> = {
    version: '1.1',
    host: source,
    short_message: record.message,
    timestamp: Date.parse(record.time) / 1000,
    level: SYSLOG[record.level],
    _component: record.component,
    _level_name: record.level,
  };
  if (record.pid !== undefined) {
    message._pid = record.pid;
  }
  for (const [key, value] of Object.entries(record.context ?? {})) {
    if (typeof value === 'string') {
      message[fieldName(key)] = value;
    }
  }
  for (const [key, value] of Object.entries(record.fields ?? {})) {
    const name = fieldName(key);
    if (!(name in message)) {
      message[name] = value;
    }
  }
  return message;
}

/** The largest datagram sent, and the payload of one chunk after its 12-byte header (GELF chunking). */
const DATAGRAM_LIMIT = 8192;
const CHUNK_HEADER = 12;
const MAX_CHUNKS = 128;

/**
 * Splits a message into GELF chunks when it does not fit one datagram: two magic bytes, an 8-byte message id, the
 * sequence number and the count. The id is the sink's own counter and process id, so no randomness is drawn.
 */
export function gelfDatagrams(payload: Uint8Array, messageId: Uint8Array): Uint8Array[] {
  if (payload.byteLength <= DATAGRAM_LIMIT) {
    return [payload];
  }
  const size = DATAGRAM_LIMIT - CHUNK_HEADER;
  const count = Math.ceil(payload.byteLength / size);
  if (count > MAX_CHUNKS) {
    throw new Error('the message is too large for GELF over UDP');
  }
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const body = payload.subarray(index * size, (index + 1) * size);
    const chunk = new Uint8Array(CHUNK_HEADER + body.byteLength);
    chunk[0] = 0x1e;
    chunk[1] = 0x0f;
    chunk.set(messageId.subarray(0, 8), 2);
    chunk[10] = index;
    chunk[11] = count;
    chunk.set(body, CHUNK_HEADER);
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Sends records to Graylog, or anything that takes GELF 1.1 (specs/logging, AC-15): over HTTP (a POST per message, the
 * recommended input), TCP (each message ended by a zero byte, on one kept connection) or UDP (one datagram, chunked
 * past 8 KiB). Written with `node:http`, `node:net` and `node:dgram`; no dependency. TLS for TCP is not offered
 * (section 8, item 8); use the HTTPS input for an encrypted connection.
 */
export class GelfLogSink extends RemoteLogSink {
  readonly address: CollectorAddress;
  private readonly stream: StreamConnection | undefined;
  private readonly datagrams: DatagramConnection | undefined;

  constructor(options: GelfLogSinkOptions) {
    const address = parseCollectorAddress(options.address, ['http', 'https', 'tcp', 'udp']);
    const stream = address.scheme === 'tcp' ? new StreamConnection(address) : undefined;
    const datagrams = address.scheme === 'udp' ? new DatagramConnection(address) : undefined;
    const pid = new Uint8Array(4);
    new DataView(pid.buffer).setUint32(0, Math.max(0, Math.trunc(options.pid ?? 0)) >>> 0);
    let sequence = 0;
    super(async (record, signal) => {
      const body = JSON.stringify(toGelf(record, options.source));
      if (stream !== undefined) {
        const bytes = Buffer.from(body, 'utf8');
        await stream.send(Buffer.concat([bytes, Buffer.from([0])]), signal);
      } else if (datagrams !== undefined) {
        sequence = (sequence + 1) >>> 0;
        const id = new Uint8Array(8);
        id.set(pid, 0);
        new DataView(id.buffer).setUint32(4, sequence);
        await datagrams.send(gelfDatagrams(Buffer.from(body, 'utf8'), id), signal);
      } else {
        await postJson(address, body, options.credential, signal);
      }
    }, options);
    this.address = address;
    this.stream = stream;
    this.datagrams = datagrams;
  }

  protected override async close(): Promise<void> {
    await Promise.all([this.stream?.close(), this.datagrams?.close()]);
  }
}
