const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

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

// -- Dimensions ------------------------------------------------------------

router.get('/:projectId/role-matrix/dimensions', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT type, value FROM role_matrix_dimensions WHERE project_id=$1 ORDER BY type, value',
      [req.params.projectId]
    );
    res.json({
      functions: result.rows.filter(r => r.type === 'function').map(r => r.value),
      roles:     result.rows.filter(r => r.type === 'role').map(r => r.value),
      info_keys: result.rows.filter(r => r.type === 'info_key').map(r => r.value),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/role-matrix/dimensions', authenticate, async (req, res) => {
  const { type, value } = req.body;
  if (!['function', 'role', 'info_key'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });
  if (!value || !String(value).trim())
    return res.status(400).json({ error: 'Value is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO role_matrix_dimensions (project_id, type, value)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.projectId, type, String(value).trim()]
    );
    const dimResult = await client.query(
      'SELECT type, value FROM role_matrix_dimensions WHERE project_id=$1',
      [req.params.projectId]
    );
    const functions = dimResult.rows.filter(r => r.type === 'function').map(r => r.value);
    const roles     = dimResult.rows.filter(r => r.type === 'role').map(r => r.value);
    const info_keys = dimResult.rows.filter(r => r.type === 'info_key').map(r => r.value);
    await generateMatrixRows(client, req.params.projectId, functions, roles, info_keys);
    await client.query('COMMIT');
    res.json({ functions, roles, info_keys });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.delete('/:projectId/role-matrix/dimensions', authenticate, async (req, res) => {
  const { type, value } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM role_matrix_dimensions WHERE project_id=$1 AND type=$2 AND value=$3',
      [req.params.projectId, type, value]
    );
    if (type === 'function') {
      await client.query(
        'DELETE FROM role_matrix WHERE project_id=$1 AND function=$2',
        [req.params.projectId, value]
      );
    } else if (type === 'role') {
      await client.query(
        'DELETE FROM role_matrix WHERE project_id=$1 AND role=$2',
        [req.params.projectId, value]
      );
    } else if (type === 'info_key') {
      // Delete all rows that carried this info key, then re-generate without it
      await client.query(
        `DELETE FROM role_matrix WHERE project_id=$1 AND additional_info ? $2`,
        [req.params.projectId, value]
      );
      const dimResult = await client.query(
        'SELECT type, value FROM role_matrix_dimensions WHERE project_id=$1',
        [req.params.projectId]
      );
      const functions = dimResult.rows.filter(r => r.type === 'function').map(r => r.value);
      const roles     = dimResult.rows.filter(r => r.type === 'role').map(r => r.value);
      const info_keys = dimResult.rows.filter(r => r.type === 'info_key').map(r => r.value);
      await generateMatrixRows(client, req.params.projectId, functions, roles, info_keys);
    }
    await client.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// -- Row generation helper -------------------------------------------------

function cartesianInfoCombos(info_keys) {
  if (info_keys.length === 0) return [{}];
  let combos = [{}];
  for (const key of info_keys) {
    const next = [];
    for (const combo of combos) {
      next.push({ ...combo, [key]: false });
      next.push({ ...combo, [key]: true });
    }
    combos = next;
  }
  return combos;
}

async function generateMatrixRows(client, projectId, functions, roles, info_keys) {
  const combos = cartesianInfoCombos(info_keys);
  for (const fn of functions) {
    for (const role of roles) {
      for (const info of combos) {
        const concatenate = buildConcatenate(fn, role, info);
        await client.query(
          `INSERT INTO role_matrix
             (project_id, function, role, additional_info, concatenate,
              tlg_primary, tlg_addon, recommended_training_id, complementary_items)
           VALUES ($1, $2, $3, $4, $5, '', '[]', NULL, '[]')
           ON CONFLICT (project_id, concatenate) DO NOTHING`,
          [projectId, fn, role, JSON.stringify(info), concatenate]
        );
      }
    }
  }
}

// -- Matrix CRUD -----------------------------------------------------------

router.get('/:projectId/role-matrix', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM role_matrix WHERE project_id=$1 ORDER BY function, role',
      [req.params.projectId]
    );
    res.json(result.rows.map(normalizeRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:projectId/role-matrix/training-profiles', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title AS profile_name FROM playlists
       WHERE project_id=$1 AND (is_complementary = false OR is_complementary IS NULL)
       ORDER BY title`,
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:projectId/role-matrix/complementary-options', authenticate, async (req, res) => {
  try {
    const [mods, currs] = await Promise.all([
      pool.query('SELECT id, title FROM training_modules WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
      pool.query('SELECT id, title FROM training_curricula WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
    ]);
    res.json({
      modules:  mods.rows.map(r => ({ ...r, type: 'module' })),
      curricula: currs.rows.map(r => ({ ...r, type: 'curriculum' })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT - only outputs (TLG, trainings)
router.put('/:projectId/role-matrix/:id', authenticate, async (req, res) => {
  const { tlg_primary, tlg_addon, recommended_training_id, complementary_items } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE role_matrix SET
         tlg_primary=$1, tlg_addon=$2,
         recommended_training_id=$3, complementary_items=$4,
         updated_at=NOW()
       WHERE id=$5 AND project_id=$6
       RETURNING *`,
      [
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

// DELETE all rows
router.delete('/:projectId/role-matrix', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM role_matrix WHERE project_id=$1 RETURNING id',
      [req.params.projectId]
    );
    res.json({ deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST bulk import (backwards compat)
router.post('/:projectId/role-matrix/import', authenticate, async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'No entries provided' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const additional_info = e.additional_info && typeof e.additional_info === 'object'
        ? e.additional_info : {};
      const concatenate = buildConcatenate(e.function, e.role, additional_info);
      await client.query(
        `INSERT INTO role_matrix
           (project_id, function, role, additional_info, concatenate, tlg_primary, tlg_addon)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (project_id, concatenate) DO UPDATE SET
           tlg_primary = EXCLUDED.tlg_primary,
           tlg_addon   = EXCLUDED.tlg_addon`,
        [
          req.params.projectId, e.function, e.role,
          JSON.stringify(additional_info), concatenate,
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

// Lookup
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
