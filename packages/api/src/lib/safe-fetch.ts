import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

/** An error whose message is safe to show to the end user. */
export class SafeFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]] as const) {
  blocked.addSubnet(net6, prefix, 'ipv6');
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isBlockedAddress(mapped[1]);
  const family = net.isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  maxBytes?: number;
  timeoutMs?: number;
  /** Tests only: allow loopback/private targets. */
  allowPrivateNetwork?: boolean;
}

export interface SafeFetchResult {
  status: number;
  url: string;
  body: string;
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: any, callback: (...args: any[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = (addresses as unknown as dns.LookupAddress[]) ?? [];
      const allowed = allowPrivate ? list : list.filter((a) => !isBlockedAddress(a.address));
      if (allowed.length === 0 || (!allowPrivate && allowed.length !== list.length)) {
        return callback(new SafeFetchError('That address is not allowed.'));
      }
      if (options?.all) return callback(null, allowed);
      callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

function requestOnce(url: URL, opts: Required<Pick<SafeFetchOptions, 'maxBytes' | 'timeoutMs'>> & SafeFetchOptions): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'Accept-Encoding': 'gzip, deflate, br', ...opts.headers },
        // The check happens at connect time, so a hostname that resolves to a private address
        // (including DNS rebinding) is refused regardless of what was validated earlier.
        lookup: guardedLookup(opts.allowPrivateNetwork ?? false) as any,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, location: res.headers.location, body: '' });
          return;
        }

        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
        let stream: Readable = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            req.destroy();
            reject(new SafeFetchError('That page is too large to import.'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', () => reject(new SafeFetchError('Could not read that page.')));
      },
    );
    req.on('timeout', () => req.destroy(new SafeFetchError('The site took too long to respond.')));
    req.on('error', (err) => {
      reject(err instanceof SafeFetchError ? err : new SafeFetchError('Could not reach that site.'));
    });
    req.end();
  });
}

/**
 * Fetches a public web page for recipe import. Only http(s) to public addresses is allowed;
 * redirects are followed manually (each hop re-checked), and the response size is capped.
 * Errors thrown are SafeFetchError (message safe to show to users) or the HTTP status is returned.
 */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...options, maxBytes: options.maxBytes ?? MAX_BYTES, timeoutMs: options.timeoutMs ?? TIMEOUT_MS };
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('That is not a valid URL.');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new SafeFetchError('Only http and https links can be imported.');
    }
    if (current.username || current.password) throw new SafeFetchError('Links with credentials are not allowed.');
    // IP literals skip DNS, so they must be checked here.
    const host = current.hostname.replace(/^\[|\]$/g, '');
    if (!opts.allowPrivateNetwork && net.isIP(host) && isBlockedAddress(host)) {
      throw new SafeFetchError('That address is not allowed.');
    }

    const result = await requestOnce(current, opts);
    if (result.location) {
      try {
        current = new URL(result.location, current);
      } catch {
        throw new SafeFetchError('The site sent an invalid redirect.');
      }
      continue;
    }
    return { status: result.status, url: current.toString(), body: result.body };
  }
  throw new SafeFetchError('The site redirected too many times.');
}
