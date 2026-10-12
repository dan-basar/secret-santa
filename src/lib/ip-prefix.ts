// What the rate limiter counts as one client. An IPv4 address is one client, but
// an IPv6 user normally holds a whole /64 block (millions of addresses) and could
// get a fresh limit just by switching address, so IPv6 is counted by its first
// 64 bits. IPv4 written as IPv6 (::ffff:1.2.3.4) counts as the IPv4 address.
export function rateLimitClient(ip: string): string {
  if (!ip.includes(':')) return ip;
  const lower = ip.toLowerCase().split('%')[0];
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];

  // Expand "::" so there are 8 groups, then keep the first 4
  const [head, tail] = lower.includes('::') ? lower.split('::') : [lower, undefined];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
  return groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}
