import { describe, expect, it } from "vitest";
import { isIpAllowed, normalizeCidr } from "./ip";

describe("IP allowlists", () => {
  it("canonicalizes CIDRs to their network address", () => {
    expect(normalizeCidr(" 10.10.12.42/20 ")).toBe("10.10.0.0/20");
    expect(normalizeCidr("10.0.0.1/33")).toBeUndefined();
    expect(normalizeCidr("not-an-ip/24")).toBeUndefined();
  });

  it("matches only addresses inside one of the configured ranges", () => {
    const policy = ["10.10.0.0/20", "192.168.4.5/32"];
    expect(isIpAllowed("10.10.15.255", policy)).toBe(true);
    expect(isIpAllowed("192.168.4.5", policy)).toBe(true);
    expect(isIpAllowed("10.10.16.0", policy)).toBe(false);
    expect(isIpAllowed("2001:db8::1", policy)).toBe(false);
  });
});
