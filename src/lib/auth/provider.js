/* ---------------------------------------------------------------------- *
 * DAIC ARCHIVE — LOCAL WORKSPACE GATE
 *
 * The archive has NO authentication service. There is no /api/auth/login,
 * no session, no token, no server-side role. Nothing here verifies anyone.
 *
 * What this is: a local separation between the visitor-facing reading room
 * and the archivist workspace, so a kiosk left unattended does not open on
 * the ingestion tools. It is a mode switch with a door on it, not a
 * security boundary, and every screen that uses it says so.
 *
 * When the backend grows real authentication, replace the body of login()
 * with that call and delete the notice in ArchivistLoginView.
 * ---------------------------------------------------------------------- */

/** Shown wherever the gate is presented, so nobody mistakes it for security. */
export const GATE_NOTICE =
  'The archive has no authentication service. This gate only separates the ' +
  'archivist workspace from the visitor view on this device — it does not ' +
  'verify identity and it protects no data.';

/** True while there is no backend authentication to delegate to. */
export const IS_LOCAL_GATE = true;

/**
 * Open the archivist workspace.
 *
 * Accepts any non-empty pair because there is nothing to check it against.
 * No credential is transmitted, compared, hashed, or stored.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{authenticated: boolean, role: string, username: string, verified: false}>}
 */
export async function login(username, password) {
  if (!username?.trim() || !password?.trim()) {
    throw new Error('Enter a name and passphrase to open the archivist workspace.');
  }

  return {
    authenticated: true,
    role: 'archivist',
    username: username.trim(),
    // Never claim this identity was checked. The UI reads this flag.
    verified: false,
  };
}

/**
 * Close the archivist workspace. Local only — there is no session to end.
 */
export async function logout() {
  return { authenticated: false };
}
