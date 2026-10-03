// Where the source code of this deployment lives. The AGPL asks a deployment that runs changed code over a network
// to offer its source, so a fork sets SOURCE_URL to its own repository.
export const DEFAULT_SOURCE_URL = 'https://github.com/murtaza-nasir/mars-ledger';

/** SOURCE_URL when it is an http(s) address, else the default. */
export function sourceUrl(v: string | undefined): string {
  const s = (v ?? '').trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : DEFAULT_SOURCE_URL;
}

/** The address as people read it: no scheme, no trailing slash. */
export const sourceLabel = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
