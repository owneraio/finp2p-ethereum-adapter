import jwt, { Algorithm } from 'jsonwebtoken';
import crypto from 'crypto';
import * as auth from './auth.json';

export const generateNonce = () => {
  const buffer = Buffer.alloc(32);
  buffer.fill(crypto.randomBytes(24), 0, 24);

  const nowEpochSeconds = Math.floor(new Date().getTime() / 1000);
  const t = BigInt(nowEpochSeconds);
  buffer.writeBigInt64BE(t, 24);

  return buffer;
};

enum Secret {
  HS256 = 1,
  RS256 = 2,
}

type AuthKeys = {
  key: string,
  secret: AuthSecret
  private: AuthPrivate
};

type AuthSecret = {
  type: number,
  raw: string
};

type AuthPrivate = {
  raw: string
};

export const createJwtToken = (organization: string, keyAndSecret: AuthKeys): string => {
  const timestamp = Math.floor(new Date().getTime() / 1000);
  const nonce = generateNonce();
  const expireAt = timestamp + 30;
  let algorithm: Algorithm;
  switch (keyAndSecret.secret.type) {
    case Secret.HS256:
      algorithm = 'HS256';
      break;
    case Secret.RS256:
      algorithm = 'RS256';
      break;
    default:
      throw new Error(`unsupported secret type: ${keyAndSecret.secret.type}`);
  }

  const payload = {
    aud: organization,
    apiKey: keyAndSecret.key,
    nonce: nonce.toString('hex'),
    iat: timestamp,
    exp: expireAt,
  };

  return jwt.sign(payload, keyAndSecret.private.raw, { algorithm });
};

export const generateAuthorizationHeader = (organization: string): string  => {
  // @ts-ignore
  const authKeys = auth[organization] as AuthKeys[] | undefined;
  if (authKeys === undefined || authKeys.length === 0) {
    throw new Error('api key and secret not found for organization: ' + organization);
  }
  return createJwtToken(organization, authKeys![0]);
};

