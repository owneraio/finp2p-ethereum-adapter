import fs from 'fs';
import { ZodiaApiError, ZodiaClient } from '../src/integrations/custody/zodia/client';

/**
 * Read-only probe of a Zodia company: proves the request signature and the
 * keys, then lists what exists — currencies, wallets, addresses, whitelisted
 * beneficiary addresses, recent service requests. Nothing here creates or
 * moves anything.
 *
 *   set -a; . ./.env.zodia; set +a; npx ts-node scripts/zodia-probe.ts
 */
const pem = (inline: string | undefined, path: string | undefined) => inline ? inline.replace(/\\n/g, '\n') : path ? fs.readFileSync(path, 'utf8') : undefined;

async function main(): Promise<void> {
  const baseUrl = process.env.ZODIA_BASE_URL ?? 'https://gateway-preprod.uat.api-zodia.io';
  const companyId = process.env.ZODIA_COMPANY_ID;
  const submitterId = process.env.ZODIA_SUBMITTER_ID;
  const companyPrivateKey = pem(process.env.ZODIA_COMPANY_PRIVATE_KEY, process.env.ZODIA_COMPANY_PRIVATE_KEY_PATH);
  const makerPrivateKey = pem(process.env.ZODIA_MAKER_PRIVATE_KEY, process.env.ZODIA_MAKER_PRIVATE_KEY_PATH);
  if (!companyId || !submitterId || !companyPrivateKey || !makerPrivateKey) {
    throw new Error('ZODIA_COMPANY_ID, ZODIA_SUBMITTER_ID, ZODIA_COMPANY_PRIVATE_KEY[_PATH] and ZODIA_MAKER_PRIVATE_KEY[_PATH] are required');
  }
  const client = new ZodiaClient({ baseUrl, companyId, submitterId, companyPrivateKey, makerPrivateKey });
  const say = (line: string) => process.stdout.write(`${line}\n`);
  say(`company ${companyId}, submitter ${submitterId}, ${baseUrl}`);

  // The first call is the whole authentication story: a 401 here is the
  // company key or the company id; a 400 with ER-114 is the submitter.
  const currencies = await client.currencies();
  say(`\nsignature accepted. ${currencies.length} currencies:`);
  for (const c of currencies) say(`  ${c.currencyId.padEnd(16)} ${c.currency.padEnd(6)} ratio ${c.ratio}${c.name ? `  (${c.name})` : ''}`);

  const wallets = await client.wallets({ statuses: ['ACTIVE'] });
  say(`\n${wallets.length} active wallets:`);
  for (const w of wallets) {
    const held = (w.balances ?? []).map(b => `${b.currency} ${b.availableBalance?.amount ?? '?'}`).join(', ');
    say(`  ${w.id.padEnd(28)} ${(w.name ?? '').padEnd(24)} ${w.currencyId.padEnd(12)} ${held || 'balance not reported'}`);
  }

  const addresses = await client.addresses({});
  say(`\n${addresses.length} wallet addresses:`);
  for (const a of addresses) say(`  ${a.walletId.padEnd(28)} ${(a.currencyId ?? '').padEnd(12)} ${a.address}`);

  const beneficiaries = await client.beneficiaryAddresses({ statuses: ['ACTIVE'] });
  say(`\n${beneficiaries.length} active beneficiary addresses (the only external destinations a transfer may name):`);
  for (const b of beneficiaries) say(`  ${b.cryptoAddressId.padEnd(38)} ${b.blockchainId.padEnd(12)} ${b.address}  ${(b.addressPurpose ?? []).join('/')}`);

  const requests = await client.serviceRequests({ paginationLimit: 10 });
  say(`\nlast ${requests.length} service requests:`);
  for (const r of requests) say(`  ${r.requestId.padEnd(22)} ${r.serviceId.padEnd(11)} ${r.status.padEnd(24)} ${r.entityId ?? ''}${r.endToEndId ? `  e2e=${r.endToEndId}` : ''}`);
}

main().catch(e => {
  if (e instanceof ZodiaApiError) {
    process.stderr.write(`${e.message}\n`);
    if (e.codes.includes('ER-210')) process.stderr.write('The company id is known to Zodia but the RSA key does not match the public key they hold for it.\n');
    if (e.codes.includes('ER-211')) process.stderr.write('Zodia does not entitle this company id (they are uppercase, e.g. OWNERA) or this submitter to the resource.\n');
  } else process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
