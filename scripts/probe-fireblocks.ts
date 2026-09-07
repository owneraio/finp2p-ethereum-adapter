#!/usr/bin/env node
import console from "console";
import { createPrivateKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { FireblocksSDK } from "fireblocks-sdk";

type Stage = { name: string; ok: boolean; detail: string };

const mask = (s: string | undefined, keep = 4): string => {
  if (!s) return "<missing>";
  if (s.length <= keep * 2) return "*".repeat(s.length);
  return `${s.slice(0, keep)}…${s.slice(-keep)} (len=${s.length})`;
};

const describeKeyShape = (raw: string): string => {
  const hasBegin = raw.includes("-----BEGIN");
  const hasEnd = raw.includes("-----END");
  const hasLiteralNewlines = raw.includes("\n");
  const hasEscapedNewlines = raw.includes("\\n");
  const beginLine = raw.split(/\r?\n/).find(l => l.includes("BEGIN")) ?? "<no BEGIN line>";
  return [
    `beginMarker=${hasBegin}`,
    `endMarker=${hasEnd}`,
    `realNewlines=${hasLiteralNewlines}`,
    `escapedNewlines=${hasEscapedNewlines}`,
    `beginLine="${beginLine.trim()}"`,
  ].join(", ");
};

const normalizeKey = (raw: string): string => {
  if (raw.includes("\n")) return raw;
  if (raw.includes("\\n")) return raw.replace(/\\n/g, "\n");
  return raw;
};

const resolvePrivateKey = (): { source: string; value: string } | undefined => {
  const direct = process.env.FIREBLOCKS_API_PRIVATE_KEY;
  const b64 = process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64;
  if (direct) return { source: "FIREBLOCKS_API_PRIVATE_KEY", value: direct };
  if (b64) return { source: "FIREBLOCKS_API_PRIVATE_KEY_BASE64", value: Buffer.from(b64, "base64").toString("utf-8") };
  return undefined;
};

const probe = async (): Promise<Stage[]> => {
  const stages: Stage[] = [];
  const apiKey = process.env.FIREBLOCKS_API_KEY;
  const apiBaseUrl = process.env.FIREBLOCKS_API_BASE_URL ?? "https://api.fireblocks.io";
  const keyRef = resolvePrivateKey();

  stages.push({
    name: "env: FIREBLOCKS_API_KEY",
    ok: !!apiKey,
    detail: mask(apiKey),
  });

  stages.push({
    name: "env: FIREBLOCKS_API_PRIVATE_KEY(_BASE64)?",
    ok: !!keyRef,
    detail: keyRef ? `source=${keyRef.source}, len=${keyRef.value.length}` : "neither env var set",
  });

  stages.push({
    name: "env: FIREBLOCKS_API_BASE_URL",
    ok: true,
    detail: apiBaseUrl,
  });

  if (!apiKey || !keyRef) return stages;

  const rawKey = keyRef.value;
  stages.push({
    name: "shape: raw",
    ok: rawKey.includes("-----BEGIN"),
    detail: describeKeyShape(rawKey),
  });

  const normalized = normalizeKey(rawKey);
  if (normalized !== rawKey) {
    stages.push({
      name: "shape: normalized (\\n → newline)",
      ok: normalized.includes("-----BEGIN") && normalized.includes("\n"),
      detail: describeKeyShape(normalized),
    });
  }

  let asymmetric = false;
  try {
    const keyObject = createPrivateKey(normalized);
    asymmetric = keyObject.asymmetricKeyType !== undefined;
    stages.push({
      name: "crypto: createPrivateKey",
      ok: true,
      detail: `asymmetricKeyType=${keyObject.asymmetricKeyType}, format=${keyObject.type}`,
    });
  } catch (e: any) {
    stages.push({
      name: "crypto: createPrivateKey",
      ok: false,
      detail: `${e?.code ?? e?.name}: ${e?.message}`,
    });
    return stages;
  }

  if (!asymmetric) {
    stages.push({
      name: "jwt: sign (skipped)",
      ok: false,
      detail: "key is not asymmetric — RS256 requires an RSA/EC private key",
    });
    return stages;
  }

  try {
    const nonce = Math.floor(Math.random() * 1_000_000_000).toString();
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uri: "/v1/vault/accounts_paged", nonce, iat: now, exp: now + 30, sub: apiKey },
      normalized,
      { algorithm: "RS256" },
    );
    stages.push({
      name: "jwt: sign RS256",
      ok: true,
      detail: `tokenLen=${token.length}`,
    });
  } catch (e: any) {
    stages.push({
      name: "jwt: sign RS256",
      ok: false,
      detail: `${e?.code ?? e?.name}: ${e?.message}`,
    });
    return stages;
  }

  try {
    const sdk = new FireblocksSDK(normalized, apiKey, apiBaseUrl);
    const page = await sdk.getVaultAccountsWithPageInfo({ limit: 1 });
    stages.push({
      name: "fireblocks: getVaultAccountsWithPageInfo(limit=1)",
      ok: true,
      detail: `returned ${page.accounts?.length ?? 0} account(s)`,
    });
  } catch (e: any) {
    const status = e?.response?.status;
    const data = e?.response?.data;
    stages.push({
      name: "fireblocks: getVaultAccountsWithPageInfo(limit=1)",
      ok: false,
      detail: `${e?.code ?? e?.name}${status ? ` status=${status}` : ""}: ${e?.message}${data ? ` body=${JSON.stringify(data)}` : ""}`,
    });
  }

  return stages;
};

probe().then(stages => {
  console.log("Fireblocks probe results:");
  for (const s of stages) {
    console.log(`  [${s.ok ? "OK  " : "FAIL"}] ${s.name} — ${s.detail}`);
  }
  const failed = stages.filter(s => !s.ok);
  process.exit(failed.length === 0 ? 0 : 1);
}).catch(e => {
  console.error("probe crashed:", e);
  process.exit(2);
});
