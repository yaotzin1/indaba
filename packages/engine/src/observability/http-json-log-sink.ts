import { RemoteLogSink, type RemoteLogSinkOptions } from './remote-log-sink.js';
import { type CollectorAddress, parseCollectorAddress, postJson } from './remote-transport.js';

export interface HttpJsonLogSinkOptions extends RemoteLogSinkOptions {
  /** `http(s)://...`, from the configuration only (AC-16). */
  readonly address: string;
  /** Sent as the `Authorization` header. Read by the caller from a named variable, never from the file. */
  readonly credential?: string;
}

/**
 * One JSON record per POST, the record exactly as the file sink writes it (specs/logging, AC-15), for any collector
 * that takes JSON over HTTP. A 2xx answer is success; a redirect is not followed.
 */
export class HttpJsonLogSink extends RemoteLogSink {
  readonly address: CollectorAddress;

  constructor(options: HttpJsonLogSinkOptions) {
    const address = parseCollectorAddress(options.address, ['http', 'https']);
    super((record, signal) => postJson(address, JSON.stringify(record), options.credential, signal), options);
    this.address = address;
  }
}
