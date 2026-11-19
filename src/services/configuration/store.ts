import { createHash } from 'crypto';
import { ConfigSchema, ConfigValues, FieldMeta, ValidationRef, activeFields, allFields, conditionHolds, isRequired } from './schema';
import { ValidationResult } from './validators';

/** Where sealed values live. In-memory here; a KMS-backed vault plugs in behind the same interface. */
export interface SecretVault {
  seal(fieldId: string, value: string): Promise<void>;
  open(fieldId: string): Promise<string | undefined>;
  remove(fieldId: string): Promise<void>;
}

export class InMemorySecretVault implements SecretVault {
  private readonly sealed = new Map<string, string>();
  async seal(fieldId: string, value: string) { this.sealed.set(fieldId, value); }
  async open(fieldId: string) { return this.sealed.get(fieldId); }
  async remove(fieldId: string) { this.sealed.delete(fieldId); }
}

export const fingerprint = (value: string): string => `SHA256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;

export interface ValidationRecord extends ValidationResult {
  ref: string;
  scope: ValidationRef['scope'];
  checkedAt: string;
  /** what the check ran on; a change to any input makes the record stale */
  inputsHash: string;
}

export interface AppliedConfig {
  version: number;
  appliedAt: string;
}

export type FieldView = string | { sealed: true; fingerprint: string };

export interface Problem {
  kind: 'missing' | 'unvalidated' | 'invalid' | 'stale';
  ref: string;
  message: string;
}

export class ConfigStore {
  private readonly plain = new Map<string, string>();
  private readonly fingerprints = new Map<string, string>();
  private readonly validations = new Map<string, ValidationRecord>();
  private applied: AppliedConfig | undefined;
  private appliedEnv: Record<string, string> = {};
  private readonly fields: Map<string, FieldMeta>;

  constructor(readonly schema: ConfigSchema, private readonly vault: SecretVault = new InMemorySecretVault()) {
    this.fields = new Map(allFields(schema).map(f => [f.id, f]));
  }

  field(id: string): FieldMeta | undefined {
    return this.fields.get(id);
  }

  /** Writes all updates or none. `null` or an empty string clears a field. */
  async write(updates: Record<string, string | null>): Promise<Record<string, string>> {
    const errors: Record<string, string> = {};
    for (const [id, raw] of Object.entries(updates)) {
      const meta = this.fields.get(id);
      if (!meta) { errors[id] = 'Unknown field.'; continue; }
      if (raw === null || raw === '') continue;
      if (typeof raw !== 'string') { errors[id] = 'Expected a string.'; continue; }
      const value = meta.classification === 'secret' ? raw : raw.trim();
      if (meta.format && !new RegExp(meta.format.pattern).test(value)) errors[id] = meta.format.message;
      if (meta.options && !meta.options.some(o => o.value === value)) errors[id] = `Expected one of: ${meta.options.map(o => o.value).join(', ')}.`;
    }
    if (Object.keys(errors).length) return errors;

    for (const [id, raw] of Object.entries(updates)) {
      const meta = this.fields.get(id)!;
      if (raw === null || raw === '') {
        this.plain.delete(id);
        if (this.fingerprints.delete(id)) await this.vault.remove(id);
      } else if (meta.classification === 'secret') {
        await this.vault.seal(id, raw);
        this.fingerprints.set(id, fingerprint(raw));
      } else {
        this.plain.set(id, raw.trim());
      }
    }
    return {};
  }

  /** Values for conditions and display: defaults filled in, sealed values reduced to a marker. */
  private effective(): ConfigValues {
    const values: ConfigValues = {};
    for (const f of this.fields.values()) {
      if (this.plain.has(f.id)) values[f.id] = this.plain.get(f.id);
      else if (this.fingerprints.has(f.id)) values[f.id] = this.fingerprints.get(f.id);
      else if (f.default !== undefined) values[f.id] = f.default;
    }
    return values;
  }

  /** Every value with sealed ones opened: only for validators and the applied configuration. */
  async resolved(): Promise<ConfigValues> {
    const values = this.effective();
    for (const id of this.fingerprints.keys()) values[id] = await this.vault.open(id);
    return values;
  }

  view() {
    const effective = this.effective();
    const values: Record<string, FieldView> = {};
    for (const [id, v] of this.plain) values[id] = v;
    for (const [id, fp] of this.fingerprints) values[id] = { sealed: true, fingerprint: fp };
    const active = new Set(activeFields(this.schema, effective).map(f => f.id));
    return {
      values,
      groups: this.schema.groups.map(g => ({
        id: g.id,
        active: conditionHolds(g.when, effective),
        fields: g.fields.map(f => ({ id: f.id, active: active.has(f.id), required: active.has(f.id) && isRequired(f, effective), set: this.isSet(f.id) })),
        validation: g.validation ? this.validationState(g.validation) : undefined,
      })),
      fieldValidations: allFields(this.schema).filter(f => f.validation).map(f => this.validationState(f.validation!)),
      applied: this.applied ?? null,
      problems: this.problems(),
    };
  }

  private isSet(id: string): boolean {
    return this.plain.has(id) || this.fingerprints.has(id);
  }

  findValidation(ref: string, scope?: ValidationRef['scope']): ValidationRef | undefined {
    const refs = [...this.schema.groups.map(g => g.validation), ...allFields(this.schema).map(f => f.validation)];
    return refs.find(r => r && r.ref === ref && (!scope || r.scope === scope));
  }

  /** Whether the check applies under the current values, and the required inputs still missing. */
  readiness(ref: ValidationRef): { active: boolean; missing: string[] } {
    const effective = this.effective();
    const active = new Set(activeFields(this.schema, effective).map(f => f.id));
    const owner = ref.scope === 'group' ? this.schema.groups.find(g => g.validation?.ref === ref.ref) : undefined;
    const isActive = ref.scope === 'group' ? !!owner && conditionHolds(owner.when, effective) : active.has(ref.ref);
    const missing = ref.inputs.filter(id => {
      const f = this.fields.get(id)!;
      return active.has(id) && isRequired(f, effective) && !this.isSet(id) && f.default === undefined;
    });
    if (ref.scope === 'field' && !this.isSet(ref.ref)) missing.unshift(ref.ref);
    return { active: isActive, missing: [...new Set(missing)] };
  }

  private inputsHash(ref: ValidationRef): string {
    const effective = this.effective();
    const snapshot = ref.inputs.map(id => [id, effective[id] ?? null]);
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  }

  record(ref: ValidationRef, result: ValidationResult): ValidationRecord {
    const rec: ValidationRecord = { ...result, ref: ref.ref, scope: ref.scope, checkedAt: new Date().toISOString(), inputsHash: this.inputsHash(ref) };
    this.validations.set(`${ref.scope}:${ref.ref}`, rec);
    return rec;
  }

  validationState(ref: ValidationRef): (Omit<ValidationRecord, 'inputsHash'> & { stale: boolean }) | { ref: string; scope: string; status: 'unvalidated' } {
    const rec = this.validations.get(`${ref.scope}:${ref.ref}`);
    if (!rec) return { ref: ref.ref, scope: ref.scope, status: 'unvalidated' };
    const { inputsHash, ...rest } = rec;
    return { ...rest, stale: inputsHash !== this.inputsHash(ref) };
  }

  /** What stands between the current values and an apply. */
  problems(): Problem[] {
    const effective = this.effective();
    const problems: Problem[] = [];
    for (const f of activeFields(this.schema, effective)) {
      if (isRequired(f, effective) && !this.isSet(f.id) && f.default === undefined) problems.push({ kind: 'missing', ref: f.id, message: `${f.label} is required.` });
    }
    const checks: ValidationRef[] = [
      ...this.schema.groups.filter(g => g.validation && conditionHolds(g.when, effective)).map(g => g.validation!),
      ...activeFields(this.schema, effective).filter(f => f.validation && this.isSet(f.id)).map(f => f.validation!),
    ];
    for (const ref of checks) {
      const state = this.validationState(ref);
      if (state.status === 'unvalidated') problems.push({ kind: 'unvalidated', ref: ref.ref, message: `${ref.ref} has not been checked.` });
      else if ('stale' in state && state.stale) problems.push({ kind: 'stale', ref: ref.ref, message: `${ref.ref} was checked before its values changed; check it again.` });
      else if (state.status === 'invalid') problems.push({ kind: 'invalid', ref: ref.ref, message: state.message });
    }
    return problems;
  }

  /** Activates the current values as a new version, provided nothing is missing and every check passed on these values. */
  async apply(): Promise<{ ok: true; applied: AppliedConfig } | { ok: false; problems: Problem[] }> {
    const problems = this.problems();
    if (problems.length) return { ok: false, problems };
    const values = await this.resolved();
    const active = activeFields(this.schema, this.effective());
    this.appliedEnv = Object.fromEntries(active.filter(f => values[f.id] !== undefined).map(f => [f.env, values[f.id]!]));
    this.applied = { version: (this.applied?.version ?? 0) + 1, appliedAt: new Date().toISOString() };
    return { ok: true, applied: this.applied };
  }

  /** The applied configuration as the environment variables the adapter reads today. */
  appliedEnvironment(): Record<string, string> {
    return { ...this.appliedEnv };
  }

  /** Every sealed value, so error messages can be scrubbed of them. */
  async sealedValues(): Promise<string[]> {
    const out: string[] = [];
    for (const id of this.fingerprints.keys()) {
      const v = await this.vault.open(id);
      if (v) out.push(v);
    }
    return out;
  }
}
