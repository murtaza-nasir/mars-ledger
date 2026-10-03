// Auto-update: which build a screen reloads into, and the server's build id.
import {describe, expect, it} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pendingBuild} from '../src/client/updateRule';

describe('auto-update', () => {
  it('reloads into another build, once, and never from a dev bundle or an unknown server build', () => {
    expect(pendingBuild('22747689-20261002T0925', '7571990a-20261001T1200', null)).toBe('22747689-20261002T0925');
    expect(pendingBuild('7571990a-20261001T1200', '22747689-20261002T0925', null)).toBe('7571990a-20261001T1200'); // a rollback
    expect(pendingBuild('22747689-20261002T0925', '22747689-20261002T0925', null)).toBeNull();
    expect(pendingBuild(null, '22747689-20261002T0925', null)).toBeNull();
    expect(pendingBuild('22747689-20261002T0925', 'dev', null)).toBeNull();
    expect(pendingBuild('22747689-20261002T0925', '7571990a-20261001T1200', '22747689-20261002T0925')).toBeNull();
  });
  it('the server reads its build id from CLIENT_DIST/build.txt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-build-'));
    writeFileSync(join(dir, 'build.txt'), '22747689-20261002T0925\n');
    process.env.CLIENT_DIST = dir;
    const {serverBuild} = await import('../src/server/build');
    expect(serverBuild()).toBe('22747689-20261002T0925');
  });
});
