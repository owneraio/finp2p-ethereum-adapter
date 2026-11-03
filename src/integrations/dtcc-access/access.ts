import winston from "winston";
import { IdentityClient, IdentityError, IssuedToken } from "./identity";

/**
 * service-account: the connector's service account alone authorizes calls (DTCC's documented machine user).
 * delegated: a user's DTCC login must first delegate to the service account for a window (the agreed Direct Connect model).
 */
export type DtccAuthMode = 'service-account' | 'delegated';

export const ENTITY_CLAIM = 'entity';

export interface Delegation {
  subject: string;
  entity: string;
  scopes: string[];
  grantedAt: Date;
  expiresAt: Date;
}

export interface DtccAccessOptions {
  mode: DtccAuthMode;
  maxDelegationSeconds: number;
  /** expected audience of user tokens: the Router UI's OIDC client */
  userAudience?: string;
  logger?: winston.Logger;
  now?: () => number;
}

export class DtccAccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const REFRESH_MARGIN_MS = 30_000;

const scopesOf = (claims: Record<string, unknown>): string[] =>
  typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [];

/** Holds the service-account token (and, in delegated mode, the user's delegation) for every DTCC call. */
export class DtccAccess {
  private current?: Delegation;
  private cached?: { scope: string; token: Promise<IssuedToken> };
  private readonly now: () => number;

  constructor(private readonly identity: IdentityClient, readonly options: DtccAccessOptions) {
    this.now = options.now ?? Date.now;
  }

  get mode(): DtccAuthMode {
    return this.options.mode;
  }

  /** The active delegation, if any. */
  delegation(): Delegation | undefined {
    if (this.current && this.current.expiresAt.getTime() <= this.now()) {
      this.options.logger?.info(`DTCC delegation from ${this.current.subject} expired`);
      this.current = undefined;
      this.cached = undefined;
    }
    return this.current;
  }

  /** Records a delegation from an IDT-issued user token; it never exceeds the user's scopes or entity. */
  async delegate(userToken: string, windowSeconds: number, requestedScopes?: string[]): Promise<Delegation> {
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0 || windowSeconds > this.options.maxDelegationSeconds) {
      throw new DtccAccessError(`The delegation window must be between 1 and ${this.options.maxDelegationSeconds} seconds`, 400);
    }
    const user = await this.identity.verify(userToken, this.options.userAudience).catch(e => {
      throw new DtccAccessError((e as Error).message, e instanceof IdentityError && e.status ? e.status : 401);
    });
    const userScopes = scopesOf(user);
    const scopes = requestedScopes?.length ? requestedScopes : userScopes;
    const beyond = scopes.filter(s => !userScopes.includes(s));
    if (beyond.length) throw new DtccAccessError(`The user does not hold the scopes ${beyond.join(', ')}`, 403);

    const service = await this.issue(scopes.join(' '));
    const userEntity = user[ENTITY_CLAIM];
    const serviceEntity = service.claims[ENTITY_CLAIM];
    if (!userEntity || userEntity !== serviceEntity) {
      throw new DtccAccessError(`The user acts for entity ${userEntity ?? 'none'}, but the service account belongs to ${serviceEntity ?? 'none'}`, 403);
    }

    this.current = {
      subject: String(user.sub),
      entity: String(userEntity),
      scopes,
      grantedAt: new Date(this.now()),
      expiresAt: new Date(this.now() + windowSeconds * 1000),
    };
    this.options.logger?.info(`DTCC delegation from ${this.current.subject} (${this.current.entity}) active until ${this.current.expiresAt.toISOString()}, scopes: ${scopes.join(' ') || 'none'}`);
    return this.current;
  }

  revoke(): boolean {
    const had = !!this.delegation();
    if (had) this.options.logger?.info(`DTCC delegation from ${this.current!.subject} revoked`);
    this.current = undefined;
    this.cached = undefined;
    return had;
  }

  /** A service-account token for the next DTCC call. In delegated mode, only while a delegation is active, and within its scopes. */
  async token(): Promise<string> {
    if (this.options.mode === 'service-account') return (await this.issue('')).token;
    const delegation = this.delegation();
    if (!delegation) {
      throw new DtccAccessError('DTCC access needs a user delegation: a user must log in at DTCC Identity and delegate to the connector', 401);
    }
    return (await this.issue(delegation.scopes.join(' '))).token;
  }

  private async issue(scope: string): Promise<IssuedToken> {
    const cached = this.cached;
    if (cached && cached.scope === scope) {
      const issued = await cached.token.catch(() => undefined);
      if (issued && issued.expiresAt - REFRESH_MARGIN_MS > this.now()) return issued;
    }
    const token = this.identity.serviceAccountToken(scope || undefined);
    this.cached = { scope, token };
    try {
      return await token;
    } catch (e) {
      if (this.cached?.token === token) this.cached = undefined;
      throw e;
    }
  }
}
