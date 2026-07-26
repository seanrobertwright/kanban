import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pool } from "@/shared/db/client";
import { verifyTeamsBotToken } from "./teams";

/**
 * verifyTeamsBotToken is the sole gate on the Teams messaging endpoint. These
 * tests mint a real RSA keypair, serve its public half through a mocked JWKS
 * fetch, and sign real RS256 JWTs — so the verification path (issuer, audience,
 * expiry, kid lookup, WebCrypto signature check) runs exactly as in production,
 * with only the network swapped out.
 */

const APP_ID = "test-teams-app-id";
const ISSUER = "https://api.botframework.com";
const KID = "test-signing-key";

let privateKey: KeyObject;
let publicJwk: JsonWebKey;

const b64url = (value: object | Buffer): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString(
    "base64url"
  );

/** A signed Bot Framework token; every part overridable to stage each attack. */
function mintToken(over: {
  header?: object;
  claims?: object;
  signWith?: KeyObject;
  tamper?: boolean;
} = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "RS256", typ: "JWT", kid: KID, ...over.header });
  const claims = b64url({
    iss: ISSUER,
    aud: APP_ID,
    exp: now + 3600,
    nbf: now - 60,
    serviceurl: "https://smba.trafficmanager.net/amer/",
    ...over.claims,
  });
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(over.signWith ?? privateKey);
  const payload = over.tamper
    ? b64url({ iss: ISSUER, aud: APP_ID, exp: now + 9999, admin: true })
    : claims;
  return `Bearer ${header}.${payload}.${signature.toString("base64url")}`;
}

beforeAll(() => {
  process.env.TEAMS_BOT_APP_ID = APP_ID;
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  publicJwk = pair.publicKey.export({ format: "jwk" }) as JsonWebKey;

  // The JWKS discovery is the only network the verifier touches; everything else
  // must be pure crypto, so this mock is the complete external surface.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("openidconfiguration")) {
        return Response.json({
          issuer: ISSUER,
          jwks_uri: "https://login.botframework.com/v1/.well-known/keys",
        });
      }
      return Response.json({
        keys: [{ ...publicJwk, kid: KID, use: "sig", alg: "RS256" }],
      });
    })
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});

describe("verifyTeamsBotToken", () => {
  it("accepts a well-formed token signed by the published key", async () => {
    await expect(verifyTeamsBotToken(mintToken())).resolves.toBe(true);
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      verifyTeamsBotToken(mintToken({ claims: { exp: past } }))
    ).resolves.toBe(false);
  });

  it("rejects a token minted for a different bot (wrong audience)", async () => {
    await expect(
      verifyTeamsBotToken(mintToken({ claims: { aud: "someone-elses-app" } }))
    ).resolves.toBe(false);
  });

  it("rejects a token from an unrecognised issuer", async () => {
    await expect(
      verifyTeamsBotToken(mintToken({ claims: { iss: "https://evil.example.test" } }))
    ).resolves.toBe(false);
  });

  it("rejects a token whose payload was swapped after signing", async () => {
    // Valid signature over the original claims, delivered with different claims:
    // the WebCrypto verify is what has to catch this, nothing earlier can.
    await expect(verifyTeamsBotToken(mintToken({ tamper: true }))).resolves.toBe(
      false
    );
  });

  it("rejects a token signed with a key the JWKS never published", async () => {
    const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await expect(
      verifyTeamsBotToken(mintToken({ signWith: rogue.privateKey }))
    ).resolves.toBe(false);
  });

  it("rejects an unknown kid rather than trying every key", async () => {
    await expect(
      verifyTeamsBotToken(mintToken({ header: { kid: "no-such-key" } }))
    ).resolves.toBe(false);
  });

  it("refuses alg confusion — anything but RS256", async () => {
    for (const alg of ["none", "HS256", "RS512"]) {
      await expect(
        verifyTeamsBotToken(mintToken({ header: { alg } }))
      ).resolves.toBe(false);
    }
  });

  it("rejects garbage: no header, non-Bearer, not-a-JWT, empty", async () => {
    await expect(verifyTeamsBotToken(null)).resolves.toBe(false);
    await expect(verifyTeamsBotToken("")).resolves.toBe(false);
    await expect(verifyTeamsBotToken("Basic dXNlcjpwYXNz")).resolves.toBe(false);
    await expect(verifyTeamsBotToken("Bearer not.a-jwt")).resolves.toBe(false);
    await expect(verifyTeamsBotToken("Bearer ....")).resolves.toBe(false);
    await expect(
      verifyTeamsBotToken("Bearer aGVsbG8.d29ybGQ.c2ln")
    ).resolves.toBe(false);
  });

  it("rejects a serviceurl claim that does not match the activity's serviceUrl", async () => {
    await expect(
      verifyTeamsBotToken(mintToken(), "https://smba.trafficmanager.net/emea/")
    ).resolves.toBe(false);
  });

  it("accepts when the serviceurl claim matches the activity", async () => {
    await expect(
      verifyTeamsBotToken(mintToken(), "https://smba.trafficmanager.net/amer/")
    ).resolves.toBe(true);
  });

  it("rejects everything when TEAMS_BOT_APP_ID is not configured", async () => {
    const saved = process.env.TEAMS_BOT_APP_ID;
    delete process.env.TEAMS_BOT_APP_ID;
    try {
      await expect(verifyTeamsBotToken(mintToken())).resolves.toBe(false);
    } finally {
      process.env.TEAMS_BOT_APP_ID = saved;
    }
  });
});
