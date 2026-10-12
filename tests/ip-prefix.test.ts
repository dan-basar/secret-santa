import { describe, it, expect } from 'vitest';
import { rateLimitClient } from '@/lib/ip-prefix';

describe('rateLimitClient', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(rateLimitClient('203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts every IPv6 address in one /64 as one client', () => {
    const a = rateLimitClient('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(rateLimitClient('2001:0db8:0001:0002::1')).toBe(a);
    expect(rateLimitClient('2001:DB8:1:2:ffff::')).toBe(a);
    expect(rateLimitClient('2001:db8:1:3::1')).not.toBe(a);
  });

  it('handles short forms and zone ids', () => {
    expect(rateLimitClient('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitClient('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('treats IPv4 written as IPv6 as the IPv4 address', () => {
    expect(rateLimitClient('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });
});
