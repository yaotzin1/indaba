import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Socket } from 'node:net';
import { IndabaError } from '@indaba/core';

/** A collector address, checked: only `http`, `https`, `tcp` and `udp`, a host, and a port where one is needed. */
export interface CollectorAddress {
  readonly scheme: 'http' | 'https' | 'tcp' | 'udp';
  readonly host: string;
  readonly port: number;
  /** The URL for `http` and `https`. */
  readonly url: URL;
}

const SCHEMES = ['http', 'https', 'tcp', 'udp'] as const;

function isScheme(value: string): value is CollectorAddress['scheme'] {
  return (SCHEMES as readonly string[]).includes(value);
}

/**
 * Reads a collector address from the configuration (AC-16): never from a workflow, an agent or a request. A user name
 * or password in it is refused, because the credential belongs in a named environment variable and an address is
 * logged when it cannot be reached.
 */
export function parseCollectorAddress(address: string, allowed: readonly string[]): CollectorAddress {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new IndabaError('The collector address is not a URL.');
  }
  const scheme = url.protocol.replace(/:$/, '');
  if (!isScheme(scheme) || !allowed.includes(scheme)) {
    throw new IndabaError(
      `The collector address must start with ${allowed.map((s) => `${s}://`).join(' or ')}.`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new IndabaError(
      'The collector address must not hold a user name or password; name a variable in secretEnv.',
    );
  }
  if (url.hostname === '') {
    throw new IndabaError('The collector address has no host.');
  }
  const defaultPort = scheme === 'https' ? 443 : scheme === 'http' ? 80 : undefined;
  const port = url.port === '' ? defaultPort : Number(url.port);
  if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IndabaError('The collector address needs a port.');
  }
  // `new URL` keeps IPv6 hosts in brackets; a socket wants them bare.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  return { scheme, host, port, url };
}

/** The `Authorization` header of a credential: a value with a scheme is sent as it is, a bare one as a bearer token. */
export function authorizationOf(credential: string): string {
  return /^\S+\s+\S/.test(credential) ? credential : `Bearer ${credential}`;
}

/**
 * Posts one body. A 2xx answer is success; anything else, a redirect included (a redirect is never followed, so a
 * collector cannot send records elsewhere), is a failure. The answer's body is read and thrown away.
 */
export function postJson(
  address: CollectorAddress,
  body: string,
  credential: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const request = address.scheme === 'https' ? httpsRequest : httpRequest;
  return new Promise<void>((resolve, reject) => {
    const req = request(
      address.url,
      {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(credential === undefined ? {} : { authorization: authorizationOf(credential) }),
        },
      },
      (res: IncomingMessage) => {
        res.resume();
        const status = res.statusCode ?? 0;
        res.on('end', () =>
          status >= 200 && status < 300
            ? resolve()
            : reject(new IndabaError(`the collector answered ${status}`)),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * A stream connection kept open between records and opened again after it breaks. Each frame is written whole; a write
 * resolves when the frame was handed to the system.
 */
export class StreamConnection {
  private socket: Socket | undefined;
  private connecting: Promise<Socket> | undefined;

  constructor(private readonly address: CollectorAddress) {}

  async send(frame: Uint8Array, signal: AbortSignal): Promise<void> {
    const socket = await this.open(signal);
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        this.drop();
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.write(frame, (error) => {
        signal.removeEventListener('abort', onAbort);
        if (error) {
          this.drop();
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    if (socket === undefined || socket.destroyed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      socket.end(() => resolve());
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 1000).unref();
    });
  }

  private open(signal: AbortSignal): Promise<Socket> {
    if (this.socket !== undefined && !this.socket.destroyed) {
      return Promise.resolve(this.socket);
    }
    this.connecting ??= new Promise<Socket>((resolve, reject) => {
      const socket = connect({ host: this.address.host, port: this.address.port, signal });
      socket.unref();
      socket.once('connect', () => {
        this.socket = socket;
        this.connecting = undefined;
        socket.on('error', () => this.drop());
        socket.on('close', () => {
          if (this.socket === socket) {
            this.socket = undefined;
          }
        });
        resolve(socket);
      });
      socket.once('error', (error) => {
        this.connecting = undefined;
        socket.destroy();
        reject(error);
      });
    });
    return this.connecting;
  }

  private drop(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}

/** One datagram socket, opened on first use. */
export class DatagramConnection {
  private socket: UdpSocket | undefined;

  constructor(private readonly address: CollectorAddress) {}

  async send(datagrams: readonly Uint8Array[], signal: AbortSignal): Promise<void> {
    const socket = this.open();
    for (const datagram of datagrams) {
      if (signal.aborted) {
        throw signal.reason;
      }
      await new Promise<void>((resolve, reject) => {
        socket.send(datagram, this.address.port, this.address.host, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    }
  }

  close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    return socket === undefined ? Promise.resolve() : new Promise((resolve) => socket.close(() => resolve()));
  }

  private open(): UdpSocket {
    if (this.socket === undefined) {
      const socket = createSocket(this.address.host.includes(':') ? 'udp6' : 'udp4');
      socket.on('error', () => {
        if (this.socket === socket) {
          this.socket = undefined;
        }
        socket.close();
      });
      socket.unref();
      this.socket = socket;
    }
    return this.socket;
  }
}
