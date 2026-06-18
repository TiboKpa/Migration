const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// Build a stable concatenate key from function, role and the sorted additional_info keys.
function buildConcatenate(fn, role, additionalInfo) {
  const parts = Object.keys(additionalInfo).sort().map(k => `${k}:${additionalInfo[k] ? 'Yes' : 'No'}`);
  return `${fn}||${role}||${parts.join('|')}`;
}

function parseAdditionalInfo(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseJsonField(raw, fallback) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normalizeRow(row) {
  return {
    ...row,
    additional_info: parseAdditionalInfo(row.additional_info),
    tlg_addon: parseJsonField(row.tlg_addon, []),
    complementary_items: parseJsonField(row.complementary_items, []),
  };
}

// GET all entries for a project
router.get('/:projectId/role-matrix', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM role_matrix WHERE project_id=$1 ORDER BY function, role',
      [req.params.projectId]
    );
    res.json(result.rows.map(normalizeRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET primary trainings for the recommended training dropdown
router.get('/:projectId/role-matrix/training-profiles', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title AS profile_name
       FROM playlists
       WHERE project_id=$1 AND (is_complementary = false OR is_complementary IS NULL)
       ORDER BY title`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET all modules + curricula for complementary items picker
router.get('/:projectId/role-matrix/complementary-options', authenticate, async (req, res) => {
  try {
    const [mods, currs] = await Promise.all([
      pool.query('SELECT id, title FROM training_modules WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
      pool.query('SELECT id, title FROM training_curricula WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
    ]);
    res.json({
      modules: mods.rows.map(r => ({ ...r, type: 'module' })),
      curricula: currs.rows.map(r => ({ ...r, type: 'curriculum' })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST single entry
router.post('/:projectId/role-matrix', authenticate, async (req, res) => {
  const {
    function: fn, role,
    additional_info: rawInfo,
    tlg_primary, tlg_addon,
    recommended_training_id, complementary_items,
  } = req.body;

  const additional_info = parseAdditionalInfo(rawInfo);
  const concatenate = buildConcatenate(fn, role, additional_info);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO role_matrix
         (project_id, function, role, additional_info, concatenate,
          tlg_primary, tlg_addon, recommended_training_id, complementary_items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.params.projectId, fn, role,
        JSON.stringify(additional_info),
        concatenate,
        tlg_primary || '',
        JSON.stringify(tlg_addon || []),
        recommended_training_id || null,
        JSON.stringify(complementary_items || []),
      ]
    );
    await client.query('COMMIT');
    res.json(normalizeRow(result.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST bulk import
router.post('/:projectId/role-matrix/import', authenticate, async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'No entries provided' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const additional_info = e.additional_info && typeof e.additional_info === 'object'
        ? e.additional_info
        : {
            'PBOM Champion': !!e.pbom_champion,
            'BOC Admin': !!e.boc_admin,
            'BOC Member': !!e.boc_member,
            'ETO User': !!e.eto_user,
            'Team Manager': !!e.team_manager,
          };
      const concatenate = buildConcatenate(e.function, e.role, additional_info);
      await client.query(
        `INSERT INTO role_matrix
           (project_id, function, role, additional_info, concatenate,
            tlg_primary, tlg_addon)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          req.params.projectId, e.function, e.role,
          JSON.stringify(additional_info),
          concatenate,
          e.tlg_primary || e.tlg_group || '',
          JSON.stringify(e.tlg_addon || []),
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ imported: entries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PUT single entry
router.put('/:projectId/role-matrix/:id', authenticate, async (req, res) => {
  const {
    function: fn, role,
    additional_info: rawInfo,
    tlg_primary, tlg_addon,
    recommended_training_id, complementary_items,
  } = req.body;

  const additional_info = parseAdditionalInfo(rawInfo);
  const concatenate = buildConcatenate(fn, role, additional_info);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE role_matrix SET
        function=$1, role=$2,
        additional_info=$3, concatenate=$4,
        tlg_primary=$5, tlg_addon=$6,
        recommended_training_id=$7, complementary_items=$8,
        updated_at=NOW()
      WHERE id=$9 AND project_id=$10
      RETURNING *`,
      [
        fn, role,
        JSON.stringify(additional_info),
        concatenate,
        tlg_primary || '',
        JSON.stringify(tlg_addon || []),
        recommended_training_id || null,
        JSON.stringify(complementary_items || []),
        req.params.id, req.params.projectId,
      ]
    );
    await client.query('COMMIT');
    res.json(normalizeRow(result.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE single entry
router.delete('/:projectId/role-matrix/:id', authenticate, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM role_matrix WHERE id=$1 AND project_id=$2',
      [req.params.id, req.params.projectId]
    );
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all entries for a project
router.delete('/:projectId/role-matrix', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM role_matrix WHERE project_id=$1 RETURNING id',
      [req.params.projectId]
    );
    res.json({ message: 'All role matrix entries deleted', deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lookup (used by training matrix generation)
router.post('/:projectId/role-matrix/lookup', authenticate, async (req, res) => {
  const { function: fn, role, additional_info: rawInfo } = req.body;
  const additional_info = parseAdditionalInfo(rawInfo);
  const concatenate = buildConcatenate(fn, role, additional_info);
  try {
    const result = await pool.query(
      'SELECT * FROM role_matrix WHERE project_id=$1 AND concatenate=$2',
      [req.params.projectId, concatenate]
    );
    if (result.rows.length === 0) return res.json({ found: false });
    res.json({ ...normalizeRow(result.rows[0]), found: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
