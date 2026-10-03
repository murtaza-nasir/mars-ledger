// Which build a screen should switch to (src/client/update.tsx), kept free of the DOM for tests.

/** The build this screen should reload into, or null: never for a dev bundle or an unknown server build, and once per
 *  build (no reload loop when a cache keeps serving the old page). Any difference counts, so a rollback reloads too. */
export function pendingBuild(server: string | null, mine: string, reloadedFor: string | null): string | null {
  if (!server || !mine || mine === 'dev' || server === mine) return null;
  if (reloadedFor === server) return null;
  return server;
}
