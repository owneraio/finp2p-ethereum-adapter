import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { randomBytes } from "crypto";

/**
 * Test-only stand-in for the router's investor onboarding.
 *
 * The shared adapter-tests suite registers every actor it builds with
 * `POST /mapping/owners { finId, accountMappings: { ledgerAccountId } }`. The
 * adapter no longer has that endpoint: investors are onboarded by the router
 * through `POST /api/accounts/create`. This facade sits where the suite expects
 * the mapping endpoint and translates the request the way the router would —
 * a walletAccount bind of the derived address, then polling the account
 * operation until it completes.
 *
 * Actors are built before the suite creates its assets, so every binding uses
 * one stable synthetic asset id. That is enough: network_accounts has no
 * foreign key to assets, and the adapter resolves an investor by finId.
 */
export const SYNTHETIC_ONBOARDING_ASSET_ID = "adapter-tests:102:onboarding";

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 60_000;

export interface RouterFacade {
  url: string;
  close(): Promise<void>;
}

/** The router's Idempotency-Key: hex of 24 random bytes followed by an 8-byte epoch timestamp in seconds. */
function idempotencyKey(): string {
  const epoch = Buffer.alloc(8);
  epoch.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  return Buffer.concat([randomBytes(24), epoch]).toString("hex");
}

type AccountOperation = { isCompleted: boolean; cid?: string; error?: { code: number; message: string }; response?: unknown };

async function onboard(adapterApiUrl: string, organizationId: string, finId: string, address: string): Promise<AccountOperation> {
  const created = await fetch(`${adapterApiUrl}/accounts/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({
      organizationId,
      assetId: SYNTHETIC_ONBOARDING_ASSET_ID,
      finId,
      bindInfo: { networkAccount: { type: "walletAccount", address }, ownershipSignature: { signature: "" } },
    }),
  });
  if (!created.ok) {
    return { isCompleted: true, error: { code: created.status, message: await created.text() } };
  }
  let op = await created.json() as AccountOperation;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!op.isCompleted) {
    if (Date.now() > deadline) return { isCompleted: true, error: { code: 0, message: `account operation ${op.cid} still pending after ${POLL_TIMEOUT_MS} ms` } };
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await fetch(`${adapterApiUrl}/operations/status/${op.cid}`);
    op = (await status.json() as { operation: AccountOperation }).operation;
  }
  return op;
}

export async function startRouterFacade(adapterApiUrl: string, organizationId: string): Promise<RouterFacade> {
  const app = express();
  app.use(express.json());

  app.post("/mapping/owners", async (req, res) => {
    const { finId, accountMappings } = req.body ?? {};
    const address = accountMappings?.ledgerAccountId;
    if (!finId || !address) {
      res.status(400).json({ error: "router facade: finId and accountMappings.ledgerAccountId are required" });
      return;
    }
    try {
      const op = await onboard(adapterApiUrl, organizationId, finId, address);
      if (op.error) {
        res.status(502).json({ error: `router facade: onboarding ${finId} failed: ${op.error.code} ${op.error.message}` });
        return;
      }
      res.json({ finId, accountMappings: { ledgerAccountId: address } });
    } catch (e) {
      res.status(502).json({ error: `router facade: onboarding ${finId} failed: ${(e as Error).message}` });
    }
  });

  app.all(/^\/mapping(\/.*)?$/, (_req, res) => {
    res.status(501).json({ error: "router facade: only POST /mapping/owners is translated, into router onboarding" });
  });

  const server = await new Promise<http.Server>(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
