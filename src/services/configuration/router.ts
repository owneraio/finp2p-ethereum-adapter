import express from 'express';
import winston from 'winston';
import { ConfigStore } from './store';
import { ValidationResult, Validator } from './validators';

const VALIDATION_TIMEOUT_MS = 20_000;

export interface ConfigRouterOptions {
  store: ConfigStore;
  validators: Record<string, Validator>;
  logger?: winston.Logger;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

function scrub(text: string, secrets: string[]): string {
  return secrets.filter(s => s.length >= 6).reduce((t, s) => t.split(s).join('••••'), text);
}

/**
 * Adapter-internal configuration API:
 *   GET  /schema    groups and fields to render, with classification, treatment and checks
 *   GET  /values    current values (sealed ones as fingerprints), check results, what blocks apply
 *   PUT  /values    { values: { [fieldId]: string | null } }, all or nothing, format-checked
 *   POST /validate  { field: id } or { group: id }, runs that check on the current values
 *   POST /apply     activates the values once nothing is missing and every check passed
 */
export function createConfigRouter({ store, validators, logger }: ConfigRouterOptions): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/schema', (_req, res) => {
    res.json(store.schema);
  });

  router.get('/values', (_req, res) => {
    res.json(store.view());
  });

  router.put('/values', async (req, res) => {
    const updates = req.body?.values;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      res.status(400).json({ error: 'Expected { "values": { "<fieldId>": "<value>" | null } }.' });
      return;
    }
    const errors = await store.write(updates);
    if (Object.keys(errors).length) {
      res.status(422).json({ error: 'Some values were rejected; nothing was saved.', fields: errors });
      return;
    }
    logger?.info('configuration values updated', { fields: Object.keys(updates) });
    res.json(store.view());
  });

  router.post('/validate', async (req, res) => {
    const { field, group } = req.body ?? {};
    const refId: unknown = field ?? group;
    if (typeof refId !== 'string' || (field !== undefined && group !== undefined)) {
      res.status(400).json({ error: 'Expected { "field": "<fieldId>" } or { "group": "<groupId>" }.' });
      return;
    }
    const ref = store.findValidation(refId, field !== undefined ? 'field' : 'group');
    const validator = ref && validators[ref.ref];
    if (!ref || !validator) {
      res.status(404).json({ error: `No check is defined for ${field !== undefined ? 'field' : 'group'} ${refId}.` });
      return;
    }
    const { active, missing } = store.readiness(ref);
    if (!active) {
      res.status(409).json({ error: `${refId} does not apply to the current configuration.` });
      return;
    }
    if (missing.length) {
      res.status(409).json({ error: 'Fill in the required fields before this check can run.', missing });
      return;
    }
    let result: ValidationResult;
    try {
      result = await withTimeout(validator(await store.resolved()), VALIDATION_TIMEOUT_MS);
    } catch (e) {
      result = { status: 'invalid', message: `The check failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const secrets = await store.sealedValues();
    result = { ...result, message: scrub(result.message, secrets), details: result.details?.map(d => ({ label: d.label, value: scrub(d.value, secrets) })) };
    const { inputsHash, ...record } = store.record(ref, result);
    logger?.info('configuration check', { ref: ref.ref, scope: ref.scope, status: result.status });
    res.json(record);
  });

  router.post('/apply', async (_req, res) => {
    const outcome = await store.apply();
    if (!outcome.ok) {
      res.status(409).json({ error: 'The configuration is not complete.', problems: outcome.problems });
      return;
    }
    logger?.info('configuration applied', { version: outcome.applied.version });
    res.json(outcome.applied);
  });

  return router;
}
