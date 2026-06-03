import { format } from "winston";

const MESSAGE = Symbol.for("message");
const SECRET_KEY_PATTERN = /^NETWORK_AUTH$|_PRIVATE_KEY(_BASE64)?$/;
const REDACTED = "[redacted]";

let cachedSecrets: string[] | undefined;

const collectSecrets = (env: NodeJS.ProcessEnv): string[] => {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!value || !SECRET_KEY_PATTERN.test(key)) continue;
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
