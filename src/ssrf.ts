import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type LookupFn = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupFn = (hostname) => lookup(hostname, { all: true, verbatim: true });

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().trim();
  const ver = isIP(ip);
  if (ver === 4) return isPrivateIpv4(ip);
  if (ver !== 6) return true;

  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
    const hexParts = mapped.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
      }
    }
    return true;
  }

  const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

export async function validatePublicHttpUrl(
  rawUrl: string,
  lookupFn: LookupFn = defaultLookup,
): Promise<{ ok: true; url: string; hostname: string } | { ok: false; error: string }> {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 255) {
    return { ok: false, error: 'URL is required and must be at most 255 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// schemes are permitted.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Embedded URL credentials are not permitted.' };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, error: 'Loopback and internal hostnames are blocked.' };
  }

  if (isIP(host) !== 0) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, error: 'Private, loopback, or reserved IP addresses are blocked.' };
    }
    return { ok: true, url: parsed.toString(), hostname: host };
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookupFn(host);
  } catch {
    return { ok: false, error: `Could not resolve hostname: ${host}` };
  }

  if (resolved.length === 0 || resolved.some((entry) => isPrivateOrReservedIp(entry.address))) {
    return { ok: false, error: 'Target resolves to a private, loopback, or reserved IP address.' };
  }

  return { ok: true, url: parsed.toString(), hostname: host };
}
