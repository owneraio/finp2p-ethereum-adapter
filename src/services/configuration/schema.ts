/**
 * Configuration metadata served to configuration UIs. A UI renders groups and
 * fields from this description alone; it needs no adapter-specific code.
 */

/** public: shown as is · confidential: shown to the config UI, never logged · secret: write-only */
export type Classification = 'public' | 'confidential' | 'secret';

/** stored: kept and returned · sealed: kept sealed and never returned, only a fingerprint */
export type Treatment = 'stored' | 'sealed';

export type FieldType = 'string' | 'text' | 'url' | 'enum' | 'integer' | 'decimal' | 'address';

/**
 * `field` alone: the field is set. With `equals` or `in`: its value matches.
 * `all`: every condition holds. `not`: the condition does not hold.
 */
export interface Condition {
  field?: string;
  equals?: string;
  in?: string[];
  all?: Condition[];
  not?: Condition;
}

/** A remote check run through the generic validation endpoint with `ref`. */
export interface ValidationRef {
  ref: string;
  scope: 'field' | 'group';
  /** endpoint that runs it: POST {path} with { field | group: ref } */
  path: string;
  /** the fields whose values the check reads; it can run once all required ones are set */
  inputs: string[];
  description: string;
}

export interface FieldMeta {
  id: string;
  /** the environment variable this field replaces */
  env: string;
  label: string;
  type: FieldType;
  classification: Classification;
  treatment: Treatment;
  required: boolean | Condition;
  when?: Condition;
  default?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** checked locally and again on write */
  format?: { pattern: string; message: string };
  validation?: ValidationRef;
}

export interface FieldGroup {
  id: string;
  title: string;
  description: string;
  /** a critical group must be complete and valid before the configuration can be applied */
  critical: boolean;
  when?: Condition;
  fields: FieldMeta[];
  /** runs once the group's fields are filled */
  validation?: ValidationRef;
}

export interface ConfigSchema {
  schemaVersion: 1;
  component: string;
  groups: FieldGroup[];
}

export type ConfigValues = Record<string, string | undefined>;

export function conditionHolds(condition: Condition | undefined, values: ConfigValues): boolean {
  if (!condition) return true;
  if (condition.all) return condition.all.every(c => conditionHolds(c, values));
  if (condition.not) return !conditionHolds(condition.not, values);
  if (condition.field === undefined) return true;
  const value = values[condition.field];
  if (condition.equals !== undefined) return value === condition.equals;
  if (condition.in !== undefined) return value !== undefined && condition.in.includes(value);
  return value !== undefined && value !== '';
}

export function allFields(schema: ConfigSchema): FieldMeta[] {
  return schema.groups.flatMap(g => g.fields);
}

/** Fields that apply under the current values: their group and the field itself are shown. */
export function activeFields(schema: ConfigSchema, values: ConfigValues): FieldMeta[] {
  return schema.groups
    .filter(g => conditionHolds(g.when, values))
    .flatMap(g => g.fields.filter(f => conditionHolds(f.when, values)));
}

export function isRequired(field: FieldMeta, values: ConfigValues): boolean {
  return typeof field.required === 'boolean' ? field.required : conditionHolds(field.required, values);
}
