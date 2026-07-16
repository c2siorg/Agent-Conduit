/**
 * IP address classifier for SSRF protection (AAP §8.12). Blocks fetches to any address that is not a
 * routable public host: loopback, private, link-local (incl. the cloud metadata endpoint
 * 169.254.169.254), carrier-grade NAT, multicast, and reserved ranges — for both IPv4 and IPv6.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value >>> 0;
}

function inRange(ip: number, cidrBase: string, bits: number): boolean {
  const base = ipv4ToInt(cidrBase);
  if (base === null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) {
    return true; // unparseable -> treat as unsafe
  }
  return (
    inRange(n, '0.0.0.0', 8) || // "this" network
    inRange(n, '10.0.0.0', 8) || // private
    inRange(n, '100.64.0.0', 10) || // CGNAT
    inRange(n, '127.0.0.0', 8) || // loopback
    inRange(n, '169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange(n, '172.16.0.0', 12) || // private
    inRange(n, '192.0.0.0', 24) || // IETF protocol assignments
    inRange(n, '192.168.0.0', 16) || // private
    inRange(n, '198.18.0.0', 15) || // benchmarking
    inRange(n, '224.0.0.0', 4) || // multicast
    inRange(n, '240.0.0.0', 4) // reserved / broadcast
  );
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? ''; // strip zone id
  // IPv4-mapped/compatible (::ffff:a.b.c.d) -> classify the embedded v4.
  const mapped = /(?:^::ffff:|^::)(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped && mapped[1]) {
    return isBlockedIpv4(mapped[1]);
  }
  if (addr === '::1' || addr === '::' || addr === '') {
    return true; // loopback / unspecified
  }
  const head = addr.split(':')[0] ?? '';
  const first = parseInt(head || '0', 16);
  if (Number.isNaN(first)) {
    return true;
  }
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }
  if ((first & 0xff00) === 0xff00) {
    return true;
  }
  return false;
}

/** True if `ip` is not a safe, routable public address (and therefore must not be fetched). */
export function isBlockedAddress(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}
