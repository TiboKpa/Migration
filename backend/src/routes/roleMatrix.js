const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
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
    complementary_names: parseJsonField(row.complementary_names, []),
    na_training: row.na_training === true || row.na_training === 1,
    na_tlg: row.na_tlg === true || row.na_tlg === 1,
  };
}

function toBoolean(val) {
  return val === true || val === 'true' || val === 1;
}

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

async function insertRowsForPairs(client, projectId, fnList, roleList, info_keys) {
  const combos = cartesianInfoCombos(info_keys);
  for (const fn of fnList) {
    for (const role of roleList) {
      for (const info of combos) {
        const concatenate = buildConcatenate(fn, role, info);
        await client.query(
          `INSERT INTO role_matrix
             (project_id, function, role, additional_info, concatenate,
              tlg_primary, tlg_addon, na_tlg,
              recommended_training_id, complementary_items, na_training,
              primary_training_name, complementary_names)
           VALUES ($1, $2, $3, $4, $5, '', '[]', false, NULL, '[]', false, '', '[]')
           ON CONFLICT (project_id, concatenate) DO NOTHING`,
          [projectId, fn, role, JSON.stringify(info), concatenate]
        );
      }
    }
  }
}

async function expandExistingRowsForNewInfoKey(client, projectId, newKey) {
  const { rows } = await client.query(
    'SELECT * FROM role_matrix WHERE project_id=$1',
    [projectId]
  );

  for (const row of rows) {
    const info = parseAdditionalInfo(row.additional_info);
    if (newKey in info) continue;

    const updatedInfo = { ...info, [newKey]: false };
    const updatedConcatenate = buildConcatenate(row.function, row.role, updatedInfo);
    await client.query(
      `UPDATE role_matrix
         SET additional_info=$1, concatenate=$2, updated_at=NOW()
       WHERE id=$3`,
      [JSON.stringify(updatedInfo), updatedConcatenate, row.id]
    );

    const twinInfo = { ...info, [newKey]: true };
    const twinConcatenate = buildConcatenate(row.function, row.role, twinInfo);
    await client.query(
      `INSERT INTO role_matrix
         (project_id, function, role, additional_info, concatenate,
          tlg_primary, tlg_addon, na_tlg,
          recommended_training_id, complementary_items, na_training,
          primary_training_name, complementary_names)
       VALUES ($1, $2, $3, $4, $5, '', '[]', false, NULL, '[]', false, '', '[]')
       ON CONFLICT (project_id, concatenate) DO NOTHING`,
      [projectId, row.function, row.role, JSON.stringify(twinInfo), twinConcatenate]
    );
  }
}

async function resolveRoleMatrixTrainings(client, projectId) {
  const [playlistsRes, modulesRes, curriculaRes] = await Promise.all([
    client.query('SELECT id, title FROM playlists WHERE project_id=$1', [projectId]),
    client.query('SELECT id, title FROM training_modules WHERE project_id=$1', [projectId]),
    client.query('SELECT id, title FROM training_curricula WHERE project_id=$1', [projectId]),
  ]);

  const playlistMap   = new Map(playlistsRes.rows.map(r => [r.title.trim().toLowerCase(), r.id]));
  const moduleMap     = new Map(modulesRes.rows.map(r => [r.title.trim().toLowerCase(), r.id]));
  const curriculumMap = new Map(curriculaRes.rows.map(r => [r.title.trim().toLowerCase(), r.id]));

  function resolveTrainingId(name) {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    return playlistMap.get(key) || moduleMap.get(key) || curriculumMap.get(key) || null;
  }

  function resolveComplementaryItems(names) {
    if (!Array.isArray(names)) return [];
    return names.map(name => {
      const key = name.trim().toLowerCase();
      if (curriculumMap.has(key)) return { type: 'curriculum', id: curriculumMap.get(key), title: name.trim() };
      if (moduleMap.has(key))     return { type: 'module',     id: moduleMap.get(key),     title: name.trim() };
      if (playlistMap.has(key))   return { type: 'playlist',   id: playlistMap.get(key),   title: name.trim() };
      return { type: 'unresolved', id: null, title: name.trim() };
    });
  }

  const rowsRes = await client.query(
    `SELECT id, primary_training_name, complementary_names
     FROM role_matrix
     WHERE project_id=$1 AND na_training=false AND primary_training_name != ''`,
    [projectId]
  );

  let resolved = 0;
  let unresolved = 0;

  for (const row of rowsRes.rows) {
    const compNames = parseJsonField(row.complementary_names, []);
    const recommended_training_id = resolveTrainingId(row.primary_training_name);
    const complementary_items     = resolveComplementaryItems(compNames);
    if (recommended_training_id) resolved++;
    else unresolved++;
    await client.query(
      `UPDATE role_matrix SET
         recommended_training_id = $1,
         complementary_items     = $2,
         updated_at              = NOW()
       WHERE id = $3`,
      [recommended_training_id, JSON.stringify(complementary_items), row.id]
    );
  }

  return { resolved, unresolved, total: rowsRes.rows.length };
}

// -- Dimensions ------------------------------------------------------------

router.get('/:projectId/role-matrix/dimensions', authenticate, requireMember(), async (req, res) => {
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
  } catch (err) {
    console.error('[GET role-matrix/dimensions]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/role-matrix/dimensions', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { type, value } = req.body;
  if (!['function', 'role', 'info_key'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });
  if (!value || !String(value).trim())
    return res.status(400).json({ error: 'Value is required' });

  const trimmed = String(value).trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO role_matrix_dimensions (project_id, type, value)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.projectId, type, trimmed]
    );

    const dimResult = await client.query(
      'SELECT type, value FROM role_matrix_dimensions WHERE project_id=$1',
      [req.params.projectId]
    );
    const functions = dimResult.rows.filter(r => r.type === 'function').map(r => r.value);
    const roles     = dimResult.rows.filter(r => r.type === 'role').map(r => r.value);
    const info_keys = dimResult.rows.filter(r => r.type === 'info_key').map(r => r.value);

    if (functions.length > 0 && roles.length > 0) {
      if (type === 'function') {
        await insertRowsForPairs(client, req.params.projectId, [trimmed], roles, info_keys);
      } else if (type === 'role') {
        await insertRowsForPairs(client, req.params.projectId, functions, [trimmed], info_keys);
      } else if (type === 'info_key') {
        await expandExistingRowsForNewInfoKey(client, req.params.projectId, trimmed);
      }
    }

    await client.query('COMMIT');
    res.json({ functions, roles, info_keys });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST role-matrix/dimensions]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.delete('/:projectId/role-matrix/dimensions', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { type, value } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM role_matrix_dimensions WHERE project_id=$1 AND type=$2 AND value=$3',
      [req.params.projectId, type, value]
    );
    if (type === 'function') {
      await client.query('DELETE FROM role_matrix WHERE project_id=$1 AND function=$2', [req.params.projectId, value]);
    } else if (type === 'role') {
      await client.query('DELETE FROM role_matrix WHERE project_id=$1 AND role=$2', [req.params.projectId, value]);
    } else if (type === 'info_key') {
      const { rows } = await client.query(
        'SELECT id, function, role, additional_info FROM role_matrix WHERE project_id=$1',
        [req.params.projectId]
      );
      for (const row of rows) {
        const info = parseAdditionalInfo(row.additional_info);
        if (!(value in info)) continue;
        if (info[value] === true) {
          await client.query('DELETE FROM role_matrix WHERE id=$1', [row.id]);
        } else {
          const updatedInfo = { ...info };
          delete updatedInfo[value];
          const updatedConcatenate = buildConcatenate(row.function, row.role, updatedInfo);
          await client.query(
            `UPDATE role_matrix SET additional_info=$1, concatenate=$2, updated_at=NOW() WHERE id=$3`,
            [JSON.stringify(updatedInfo), updatedConcatenate, row.id]
          );
        }
      }
      await client.query(
        'DELETE FROM role_matrix_info_key_links WHERE project_id=$1 AND info_key=$2',
        [req.params.projectId, value]
      );
    }
    await client.query('COMMIT');
    const dimResult = await pool.query(
      'SELECT type, value FROM role_matrix_dimensions WHERE project_id=$1 ORDER BY type, value',
      [req.params.projectId]
    );
    res.json({
      functions: dimResult.rows.filter(r => r.type === 'function').map(r => r.value),
      roles:     dimResult.rows.filter(r => r.type === 'role').map(r => r.value),
      info_keys: dimResult.rows.filter(r => r.type === 'info_key').map(r => r.value),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DELETE role-matrix/dimensions]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

// -- Matrix rows ------------------------------------------------------------

router.get('/:projectId/role-matrix', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM role_matrix WHERE project_id=$1 ORDER BY function, role`,
      [req.params.projectId]
    );
    res.json(result.rows.map(normalizeRow));
  } catch (err) {
    console.error('[GET role-matrix]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/role-matrix/training-profiles', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT primary_training_name FROM role_matrix
       WHERE project_id=$1 AND primary_training_name != ''
       ORDER BY primary_training_name`,
      [req.params.projectId]
    );
    res.json(result.rows.map(r => r.primary_training_name));
  } catch (err) {
    console.error('[GET role-matrix/training-profiles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/role-matrix/complementary-options', authenticate, requireMember(), async (req, res) => {
  try {
    const [mods, currs, plays] = await Promise.all([
      pool.query('SELECT id, title FROM training_modules WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
      pool.query('SELECT id, title FROM training_curricula WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
      pool.query('SELECT id, title FROM playlists WHERE project_id=$1 ORDER BY title', [req.params.projectId]),
    ]);
    res.json({
      modules:   mods.rows.map(r => ({ ...r, type: 'module' })),
      curricula: currs.rows.map(r => ({ ...r, type: 'curriculum' })),
      playlists: plays.rows.map(r => ({ ...r, type: 'playlist' })),
    });
  } catch (err) {
    console.error('[GET role-matrix/complementary-options]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// -- Info key links --------------------------------------------------------

router.get('/:projectId/role-matrix/info-key-links', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT info_key, complementary_items FROM role_matrix_info_key_links WHERE project_id=$1',
      [req.params.projectId]
    );
    const links = {};
    for (const row of result.rows) {
      links[row.info_key] = parseJsonField(row.complementary_items, []);
    }
    res.json(links);
  } catch (err) {
    console.error('[GET role-matrix/info-key-links]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:projectId/role-matrix/info-key-links/:infoKey', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { complementary_items } = req.body;
  const { projectId, infoKey } = req.params;
  try {
    await pool.query(
      `INSERT INTO role_matrix_info_key_links (project_id, info_key, complementary_items)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, info_key)
       DO UPDATE SET complementary_items = EXCLUDED.complementary_items, updated_at = NOW()`,
      [projectId, infoKey, JSON.stringify(complementary_items)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PUT role-matrix/info-key-links]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:projectId/role-matrix/:id', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { na_training, na_tlg, tlg_primary, tlg_addon, recommended_training_id,
          primary_training_name, complementary_items, complementary_names } = req.body;
  try {
    const result = await pool.query(
      `UPDATE role_matrix SET
         na_training             = $1,
         na_tlg                  = $2,
         tlg_primary             = $3,
         tlg_addon               = $4,
         recommended_training_id = $5,
         primary_training_name   = $6,
         complementary_items     = $7,
         complementary_names     = $8,
         updated_at              = NOW()
       WHERE id=$9 AND project_id=$10
       RETURNING *`,
      [
        toBoolean(na_training),
        toBoolean(na_tlg),
        tlg_primary ?? '',
        JSON.stringify(Array.isArray(tlg_addon) ? tlg_addon : []),
        recommended_training_id ?? null,
        primary_training_name ?? '',
        JSON.stringify(Array.isArray(complementary_items) ? complementary_items : []),
        JSON.stringify(Array.isArray(complementary_names) ? complementary_names : []),
        req.params.id,
        req.params.projectId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(normalizeRow(result.rows[0]));
  } catch (err) {
    console.error('[PUT role-matrix/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/role-matrix', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_matrix WHERE project_id=$1', [req.params.projectId]);
    await client.query('DELETE FROM role_matrix_dimensions WHERE project_id=$1', [req.params.projectId]);
    await client.query('DELETE FROM role_matrix_info_key_links WHERE project_id=$1', [req.params.projectId]);
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DELETE role-matrix]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.post('/:projectId/role-matrix/import', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'entries must be a non-empty array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Collect unique dimension values
    const functions = [...new Set(entries.map(e => e.function))];
    const roles     = [...new Set(entries.map(e => e.role))];
    const infoKeys  = entries.length > 0 ? Object.keys(entries[0].additional_info ?? {}) : [];

    // 2. Upsert dimensions
    for (const fn of functions)
      await client.query(`INSERT INTO role_matrix_dimensions (project_id, type, value) VALUES ($1,'function',$2) ON CONFLICT DO NOTHING`, [req.params.projectId, fn]);
    for (const role of roles)
      await client.query(`INSERT INTO role_matrix_dimensions (project_id, type, value) VALUES ($1,'role',$2) ON CONFLICT DO NOTHING`, [req.params.projectId, role]);
    for (const key of infoKeys)
      await client.query(`INSERT INTO role_matrix_dimensions (project_id, type, value) VALUES ($1,'info_key',$2) ON CONFLICT DO NOTHING`, [req.params.projectId, key]);

    let created = 0; let updated = 0; let skipped = 0;

    for (const e of entries) {
      const additionalInfo = e.additional_info ?? {};
      const concatenate    = buildConcatenate(e.function, e.role, additionalInfo);

      const existing = await client.query(
        'SELECT id FROM role_matrix WHERE project_id=$1 AND concatenate=$2',
        [req.params.projectId, concatenate]
      );

      if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await client.query(
          `UPDATE role_matrix SET
             na_training           = $1,
             na_tlg                = $2,
             tlg_primary           = $3,
             tlg_addon             = $4,
             primary_training_name = $5,
             complementary_names   = $6,
             updated_at            = NOW()
           WHERE id = $7`,
          [
            toBoolean(e.na_training),
            toBoolean(e.na_tlg),
            e.tlg_primary ?? '',
            JSON.stringify(Array.isArray(e.tlg_addon) ? e.tlg_addon : []),
            e.recommended_name ?? '',
            JSON.stringify(Array.isArray(e.complementary_names) ? e.complementary_names : []),
            id,
          ]
        );
        updated++;
      } else {
        await client.query(
          `INSERT INTO role_matrix
             (project_id, function, role, additional_info, concatenate,
              na_training, na_tlg, tlg_primary, tlg_addon,
              primary_training_name, complementary_names,
              recommended_training_id, complementary_items)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,'[]')`,
          [
            req.params.projectId, e.function, e.role,
            JSON.stringify(additionalInfo), concatenate,
            toBoolean(e.na_training), toBoolean(e.na_tlg),
            e.tlg_primary ?? '',
            JSON.stringify(Array.isArray(e.tlg_addon) ? e.tlg_addon : []),
            e.recommended_name ?? '',
            JSON.stringify(Array.isArray(e.complementary_names) ? e.complementary_names : []),
          ]
        );
        created++;
      }
    }

    // 3. Re-resolve trainings
    const resolveStats = await resolveRoleMatrixTrainings(client, req.params.projectId);

    await client.query('COMMIT');
    res.json({ created, updated, skipped, ...resolveStats });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST role-matrix/import]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.post('/:projectId/role-matrix/re-resolve', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = await resolveRoleMatrixTrainings(client, req.params.projectId);
    await client.query('COMMIT');
    res.json(stats);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST role-matrix/re-resolve]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.post('/:projectId/role-matrix/lookup', authenticate, requireMember(), async (req, res) => {
  const { function: fn, role, additional_info } = req.body;
  if (!fn || !role) return res.status(400).json({ error: 'function and role are required' });
  try {
    const info = additional_info ?? {};
    const concatenate = buildConcatenate(fn, role, info);
    const result = await pool.query(
      'SELECT * FROM role_matrix WHERE project_id=$1 AND concatenate=$2',
      [req.params.projectId, concatenate]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(normalizeRow(result.rows[0]));
  } catch (err) {
    console.error('[POST role-matrix/lookup]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
