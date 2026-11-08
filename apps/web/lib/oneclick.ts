// https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication
export const ONECLICK_URL = 'https://1click.chaindefuser.com';

/** Without a key 1Click still works and adds 0.25%. */
export function oneClickHeaders(): Record<string, string> {
  const jwt = process.env.ONECLICK_JWT;
  return jwt ? { 'X-API-Key': jwt } : {};
}

/** Live quotes return a real deposit address, so they are off unless explicitly enabled. */
export const liveQuotesEnabled = () => process.env.ONECLICK_ALLOW_LIVE === '1';
