const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

function isErrorRole(pdmRole) {
  return !pdmRole || String(pdmRole).toLowerCase().startsWith('error');
}

async function upsertPlaylist(client, projectId, pdmRole) {
  if (isErrorRole(pdmRole)) return;
  await client.query(
    `INSERT INTO training_profiles (project_id, profile_name)
     VALUES ($1, $2)
     ON CONFLICT (project_id, profile_name) DO NOTHING`,
    [projectId, pdmRole]
  );
}

// GET all entries for a project
router.get('/:projectId/role-matrix', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM role_matrix WHERE project_id=$1 ORDER BY function, role',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST single entry - also creates the training playlist
router.post('/:projectId/role-matrix', authenticate, async (req, res) => {
  const { function: fn, role, pbom_champion, boc_admin, boc_member, eto_user, team_manager, pdm_role, tlg_group } = req.body;
  const concatenate = `${fn}-${role}-${pbom_champion ? 'Yes' : 'No'}-${boc_admin ? 'Yes' : 'No'}-${boc_member ? 'Yes' : 'No'}-${eto_user ? 'Yes' : 'No'}-${team_manager ? 'Yes' : 'No'}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO role_matrix (project_id, function, role, pbom_champion, boc_admin, boc_member, eto_user, team_manager, concatenate, pdm_role, tlg_group)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (project_id, concatenate) DO UPDATE SET
         function=EXCLUDED.function, role=EXCLUDED.role, pbom_champion=EXCLUDED.pbom_champion,
         boc_admin=EXCLUDED.boc_admin, boc_member=EXCLUDED.boc_member, eto_user=EXCLUDED.eto_user,
         team_manager=EXCLUDED.team_manager, pdm_role=EXCLUDED.pdm_role, tlg_group=EXCLUDED.tlg_group,
         updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, fn, role, pbom_champion, boc_admin, boc_member, eto_user, team_manager, concatenate, pdm_role, tlg_group]
    );
    await upsertPlaylist(client, req.params.projectId, pdm_role);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST bulk import - upserts rules and creates all distinct playlists
router.post('/:projectId/role-matrix/import', authenticate, async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'No entries provided' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Collect distinct non-error pdm_role values for playlist creation
    const playlistNames = new Set();

    for (const e of entries) {
      const concatenate = `${e.function}-${e.role}-${e.pbom_champion ? 'Yes' : 'No'}-${e.boc_admin ? 'Yes' : 'No'}-${e.boc_member ? 'Yes' : 'No'}-${e.eto_user ? 'Yes' : 'No'}-${e.team_manager ? 'Yes' : 'No'}`;
      await client.query(
        `INSERT INTO role_matrix (project_id, function, role, pbom_champion, boc_admin, boc_member, eto_user, team_manager, concatenate, pdm_role, tlg_group)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (project_id, concatenate) DO UPDATE SET
           pdm_role=EXCLUDED.pdm_role, tlg_group=EXCLUDED.tlg_group, updated_at=NOW()`,
        [req.params.projectId, e.function, e.role, e.pbom_champion, e.boc_admin, e.boc_member, e.eto_user, e.team_manager, concatenate, e.pdm_role, e.tlg_group]
      );
      if (!isErrorRole(e.pdm_role)) playlistNames.add(e.pdm_role);
    }

    // Create one playlist per distinct pdm_role
    for (const name of playlistNames) {
      await upsertPlaylist(client, req.params.projectId, name);
    }

    await client.query('COMMIT');
    res.json({ imported: entries.length, playlists_created: playlistNames.size });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PUT single entry - also ensures the new pdm_role has a playlist
router.put('/:projectId/role-matrix/:id', authenticate, async (req, res) => {
  const { pdm_role, tlg_group } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'UPDATE role_matrix SET pdm_role=$1, tlg_group=$2, updated_at=NOW() WHERE id=$3 AND project_id=$4 RETURNING *',
      [pdm_role, tlg_group, req.params.id, req.params.projectId]
    );
    await upsertPlaylist(client, req.params.projectId, pdm_role);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE single entry
router.delete('/:projectId/role-matrix/:id', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM role_matrix WHERE id=$1 AND project_id=$2', [req.params.id, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lookup
router.post('/:projectId/role-matrix/lookup', authenticate, async (req, res) => {
  const { function: fn, role, pbom_champion, boc_admin, boc_member, eto_user, team_manager } = req.body;
  const yesNo = v => (v === true || v === 'Yes' || v === 'yes' || v === 1) ? 'Yes' : 'No';
  const concatenate = `${fn}-${role}-${yesNo(pbom_champion)}-${yesNo(boc_admin)}-${yesNo(boc_member)}-${yesNo(eto_user)}-${yesNo(team_manager)}`;
  try {
    const result = await pool.query(
      'SELECT pdm_role, tlg_group FROM role_matrix WHERE project_id=$1 AND concatenate=$2',
      [req.params.projectId, concatenate]
    );
    if (result.rows.length === 0) return res.json({ pdm_role: null, tlg_group: null, found: false });
    const row = result.rows[0];
    if (isErrorRole(row.pdm_role)) {
      return res.json({ pdm_role: 'Error (invalid role for this function)', tlg_group: 'Error', found: true, is_error: true });
    }
    res.json({ ...row, found: true, is_error: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
