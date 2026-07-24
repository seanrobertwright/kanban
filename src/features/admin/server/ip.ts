/** Strict IPv4 CIDR parsing keeps malformed policy entries from becoming an
 * accidental allow-all. IPv6 is deliberately rejected until it has equivalent
 * test coverage and a trusted-proxy deployment story. */
function ipv4ToNumber(value: string): number | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const byte = Number(part);
    if (byte > 255) return undefined;
    result = result * 256 + byte;
  }
  return result >>> 0;
}

export function normalizeCidr(value: string): string | undefined {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/);
  if (!match) return undefined;
  const address = ipv4ToNumber(match[1]);
  if (address === undefined) return undefined;
  const bits = Number(match[2]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const network = (address & mask) >>> 0;
  return `${[(network >>> 24) & 255, (network >>> 16) & 255, (network >>> 8) & 255, network & 255].join(".")}/${bits}`;
}

export function isIpAllowed(ip: string, cidrs: string[]): boolean {
  const address = ipv4ToNumber(ip.trim());
  if (address === undefined) return false;
  return cidrs.some((cidr) => {
    const normalized = normalizeCidr(cidr);
    if (!normalized) return false;
    const [networkText, bitsText] = normalized.split("/");
    const bits = Number(bitsText);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (address & mask) >>> 0 === (ipv4ToNumber(networkText)! & mask) >>> 0;
  });
}
