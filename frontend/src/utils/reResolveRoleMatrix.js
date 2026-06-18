import client from '../api/client';

/**
 * Fire-and-forget: asks the backend to re-link training names to catalogue IDs
 * for all import-sourced role matrix rows. Called after any catalogue mutation
 * (module / curriculum / playlist create, update, delete, import).
 * Errors are swallowed -- the role matrix will simply remain in its previous
 * state until the next successful resolve.
 */
export async function reResolveRoleMatrix(projectId) {
  try {
    await client.post(`/projects/${projectId}/role-matrix/re-resolve`);
  } catch (err) {
    console.warn('[role-matrix] re-resolve failed silently:', err?.message);
  }
}
