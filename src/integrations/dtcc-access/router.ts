import express from "express";
import { DtccAccess, DtccAccessError, Delegation } from "./access";
import { IdentityError } from "./identity";

const view = (d: Delegation | undefined) => d && {
  subject: d.subject, entity: d.entity, scopes: d.scopes,
  grantedAt: d.grantedAt.toISOString(), expiresAt: d.expiresAt.toISOString(),
};

/**
 * POST /delegation   Authorization: Bearer <IDT user token>, body { windowSeconds, scopes? }
 * GET /delegation    the mode and the active delegation
 * DELETE /delegation revokes it
 */
export function createDtccAccessRouter(access: DtccAccess): express.Router {
  const router = express.Router();
  router.use(express.json());

  router.get('/delegation', (_req, res) => {
    res.json({ mode: access.mode, delegation: view(access.delegation()) ?? null });
  });

  router.post('/delegation', async (req, res) => {
    if (access.mode !== 'delegated') {
      res.status(409).json({ error: 'The connector runs on its service account alone; delegation is not used' });
      return;
    }
    const userToken = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!userToken) {
      res.status(401).json({ error: 'Send the user token from DTCC Identity as Authorization: Bearer <token>' });
      return;
    }
    const { windowSeconds, scopes } = req.body ?? {};
    if (scopes !== undefined && !(Array.isArray(scopes) && scopes.every((s: unknown) => typeof s === 'string'))) {
      res.status(400).json({ error: 'scopes must be a list of strings' });
      return;
    }
    try {
      res.status(201).json({ delegation: view(await access.delegate(userToken, Number(windowSeconds), scopes)) });
    } catch (e) {
      const status = e instanceof DtccAccessError ? e.status : e instanceof IdentityError ? 502 : 500;
      res.status(status).json({ error: (e as Error).message });
    }
  });

  router.delete('/delegation', (_req, res) => {
    access.revoke();
    res.status(204).end();
  });

  return router;
}
