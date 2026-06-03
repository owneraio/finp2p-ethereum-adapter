import { format } from "winston";

const MESSAGE = Symbol.for("message");
const EXACT_SECRET_KEYS = new Set(["NETWORK_AUTH"]);
const SECRET_KEY_SUFFIXES = [
  "_PRIVATE_KEY",
  "_PRIVATE_KEY_BASE64",
  "_AUTH_TOKEN",
  "_API_KEY",
  "_CONNECTION_STRING",
  "_SECRET",
  "_PASSWORD",
];
const REDACTED = "[redacted]";

const isSecretKey = (key: string): boolean =>
  EXACT_SECRET_KEYS.has(key) || SECRET_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));

let cachedSecrets: string[] | undefined;

const collectSecrets = (env: NodeJS.ProcessEnv): string[] => {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!value || !isSecretKey(key)) continue;
    values.add(value);
    // Also redact the JSON-escaped form (handles values containing quotes, backslashes, newlines).
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    if (jsonEscaped !== value) values.add(jsonEscaped);
  }
  // Longest first so a shorter secret that is a substring of a longer one doesn't mask it.
  return [...values].sort((a, b) => b.length - a.length);
};

const getSecrets = (): string[] => (cachedSecrets ??= collectSecrets(process.env));

export const redactSecrets = format((info) => {
  const secrets = getSecrets();
  if (secrets.length === 0) return info;
  const serialized = (info as Record<symbol, unknown>)[MESSAGE];
  if (typeof serialized !== "string") return info;
  let out = serialized;
  for (const s of secrets) out = out.replaceAll(s, REDACTED);
  (info as Record<symbol, unknown>)[MESSAGE] = out;
  return info;
});
