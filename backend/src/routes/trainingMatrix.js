const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Insert-and-shift for curriculum_module_items.
 * If `pos` is already taken, shift all items at >= pos up by 1 first.
 * pos is clamped to minimum 1.
 */
async function shiftAndInsertCurriculumModule(db, curriculumId, moduleId, requirement, pos) {
  const safePos = Math.max(1, pos);
  await db.query(
    `UPDATE curriculum_module_items
     SET sequence_order = sequence_order + 1
     WHERE curriculum_id = $1 AND sequence_order >= $2`,
    [curriculumId, safePos]
  );
  await db.query(
    `INSERT INTO curriculum_module_items (curriculum_id, module_id, requirement, sequence_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (curriculum_id, module_id) DO UPDATE
       SET requirement = EXCLUDED.requirement, sequence_order = EXCLUDED.sequence_order`,
    [curriculumId, moduleId, requirement, safePos]
  );
}

/**
 * Insert-and-shift for playlist_items.
 * If `pos` is already taken, shift all items at >= pos up by 1 first.
 * pos is clamped to minimum 1.
 * During import we pass shift=false to preserve the exact xlsx order.
 */
async function shiftAndInsertPlaylistItem(db, playlistId, curriculumId, moduleId, pos, shift = true) {
  const safePos = Math.max(1, pos);
  if (shift) {
    await db.query(
      `UPDATE playlist_items
       SET sequence_order = sequence_order + 1
       WHERE playlist_id = $1 AND sequence_order >= $2`,
      [playlistId, safePos]
    );
  }
  await db.query(
    `INSERT INTO playlist_items (playlist_id, curriculum_id, module_id, sequence_order)
     VALUES ($1, $2, $3, $4)`,
    [playlistId, curriculumId || null, moduleId || null, safePos]
  );
}

// ── Legacy routes ─────────────────────────────────────────────────────────────
router.get('/:projectId/profiles', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM training_profiles WHERE project_id=$1 ORDER BY profile_name', [req.params.projectId]);
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:projectId/trainings', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM training_references WHERE project_id=$1 ORDER BY training_title', [req.params.projectId]);
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:projectId/profiles/:profileId/mappings', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, tr.training_title, tr.training_family, tr.duration_hhmm, tr.duration_decimal, tr.content_type
       FROM profile_training_mappings pm
       JOIN training_references tr ON tr.id = pm.training_id
       WHERE pm.profile_id=$1 ORDER BY pm.sequence_order`,
      [req.params.profileId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/profiles', authenticate, async (req, res) => {
  const { profile_name, function_scope, eto_variant, default_tlg_group } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_profiles (project_id, profile_name, function_scope, eto_variant, default_tlg_group) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.projectId, profile_name, function_scope, eto_variant || false, default_tlg_group]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/trainings', authenticate, async (req, res) => {
  const { training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_references (project_id, training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.projectId, training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/profiles/:profileId/mappings', authenticate, async (req, res) => {
  const { training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO profile_training_mappings (profile_id, training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.profileId, training_id, requirement_type || 'mandatory', sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Modules ───────────────────────────────────────────────────────────────────

router.get('/:projectId/modules', authenticate, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM training_modules WHERE project_id=$1 ORDER BY title', [req.params.projectId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/modules', authenticate, async (req, res) => {
  const { title, content_id, duration_min } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO training_modules (project_id, title, content_id, duration_min)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, title) DO UPDATE
         SET content_id=EXCLUDED.content_id, duration_min=EXCLUDED.duration_min, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, title, content_id || null, duration_min || 0]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/modules/:moduleId', authenticate, async (req, res) => {
  const { title, content_id, duration_min } = req.body;
  try {
    const r = await pool.query(
      `UPDATE training_modules SET title=$1, content_id=$2, duration_min=$3, updated_at=NOW()
       WHERE id=$4 AND project_id=$5 RETURNING *`,
      [title, content_id || null, duration_min || 0, req.params.moduleId, req.params.projectId]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/modules/:moduleId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM training_modules WHERE id=$1 AND project_id=$2', [req.params.moduleId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/modules', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM training_modules WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All modules deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Curricula ─────────────────────────────────────────────────────────────────

router.get('/:projectId/curricula', authenticate, async (req, res) => {
  try {
    const curricula = (await pool.query(
      'SELECT * FROM training_curricula WHERE project_id=$1 ORDER BY title',
      [req.params.projectId]
    )).rows;

    const items = curricula.length === 0 ? [] : (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id, tm.duration_min
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id = ANY($1::int[])
       ORDER BY cmi.sequence_order`,
      [curricula.map(c => c.id)]
    )).rows;

    res.json(curricula.map(c => ({ ...c, modules: items.filter(i => i.curriculum_id === c.id) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:projectId/curricula/:curriculumId', authenticate, async (req, res) => {
  try {
    const cur = (await pool.query(
      'SELECT * FROM training_curricula WHERE id=$1 AND project_id=$2',
      [req.params.curriculumId, req.params.projectId]
    )).rows[0];
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const modules = (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id, tm.duration_min
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id=$1 ORDER BY cmi.sequence_order`,
      [cur.id]
    )).rows;
    res.json({ ...cur, modules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/curricula', authenticate, async (req, res) => {
  const { title, content_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO training_curricula (project_id, title, content_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (project_id, title) DO UPDATE SET content_id=EXCLUDED.content_id, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, title, content_id || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/curricula/:curriculumId', authenticate, async (req, res) => {
  const { title, content_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `UPDATE training_curricula SET title=$1, content_id=$2, updated_at=NOW()
       WHERE id=$3 AND project_id=$4 RETURNING *`,
      [title, content_id || null, req.params.curriculumId, req.params.projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add module to curriculum with insert-and-shift
router.post('/:projectId/curricula/:curriculumId/modules', authenticate, async (req, res) => {
  const { module_id, requirement, sequence_order } = req.body;
  if (!module_id) return res.status(400).json({ error: 'module_id is required' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // If no position given, place at end
    let pos = parseInt(sequence_order);
    if (!pos || pos < 1) {
      const maxR = await db.query(
        'SELECT COALESCE(MAX(sequence_order), 0) AS m FROM curriculum_module_items WHERE curriculum_id=$1',
        [req.params.curriculumId]
      );
      pos = maxR.rows[0].m + 1;
    }
    await shiftAndInsertCurriculumModule(db, req.params.curriculumId, module_id, requirement || 'mandatory', pos);
    await db.query('COMMIT');
    res.status(201).json({ message: 'Added' });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
});

router.delete('/:projectId/curricula/:curriculumId/modules/:moduleId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM curriculum_module_items WHERE curriculum_id=$1 AND module_id=$2', [req.params.curriculumId, req.params.moduleId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/curricula/:curriculumId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM training_curricula WHERE id=$1 AND project_id=$2', [req.params.curriculumId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/curricula', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM training_curricula WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All curricula deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Playlists ─────────────────────────────────────────────────────────────────

router.get('/:projectId/playlists', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM playlists WHERE project_id=$1 ORDER BY is_complementary, title',
      [req.params.projectId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  try {
    const plRes = await pool.query(
      'SELECT * FROM playlists WHERE id=$1 AND project_id=$2',
      [req.params.playlistId, req.params.projectId]
    );
    if (plRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const playlist = plRes.rows[0];

    const items = (await pool.query(
      `SELECT pi.*,
              tc.title AS curriculum_title, tc.content_id AS curriculum_content_id,
              tm.title AS module_title, tm.content_id AS module_content_id, tm.duration_min
       FROM playlist_items pi
       LEFT JOIN training_curricula tc ON tc.id = pi.curriculum_id
       LEFT JOIN training_modules   tm ON tm.id = pi.module_id
       WHERE pi.playlist_id=$1
       ORDER BY pi.sequence_order`,
      [playlist.id]
    )).rows;

    const curriculumIds = [...new Set(items.filter(i => i.curriculum_id).map(i => i.curriculum_id))];
    const curriculumModules = curriculumIds.length === 0 ? [] : (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id, tm.duration_min
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id = ANY($1::int[])
       ORDER BY cmi.sequence_order`,
      [curriculumIds]
    )).rows;

    // Build a unified ordered list of all playlist items (curricula + standalone modules)
    const orderedItems = items.map(i => {
      if (i.curriculum_id) {
        return {
          kind:             'curriculum',
          playlist_item_id: i.id,
          curriculum_id:    i.curriculum_id,
          title:            i.curriculum_title,
          content_id:       i.curriculum_content_id,
          sequence_order:   i.sequence_order,
          modules:          curriculumModules.filter(m => m.curriculum_id === i.curriculum_id),
        };
      }
      return {
        kind:             'module',
        playlist_item_id: i.id,
        module_id:        i.module_id,
        title:            i.module_title,
        content_id:       i.module_content_id,
        duration_min:     i.duration_min,
        sequence_order:   i.sequence_order,
      };
    });

    // Keep legacy fields for backward compat
    const curricula = orderedItems.filter(x => x.kind === 'curriculum');
    const standalone_modules = orderedItems.filter(x => x.kind === 'module');

    const refs = (await pool.query(
      'SELECT * FROM playlist_complementary_refs WHERE playlist_id=$1 ORDER BY sequence_order',
      [playlist.id]
    )).rows;

    const allModules = [...curricula.flatMap(c => c.modules), ...standalone_modules];
    const total_minutes = allModules
      .filter(m => (m.requirement || 'mandatory') === 'mandatory')
      .reduce((s, m) => s + (m.duration_min || 0), 0);

    res.json({ ...playlist, ordered_items: orderedItems, curricula, standalone_modules, complementary_refs: refs, total_minutes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/playlists', authenticate, async (req, res) => {
  const { title, description, link, content_id, is_complementary } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO playlists (project_id, title, description, link, content_id, is_complementary)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, title) DO UPDATE
         SET description=EXCLUDED.description, link=EXCLUDED.link,
             content_id=EXCLUDED.content_id, is_complementary=EXCLUDED.is_complementary, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, title, description || null, link || null, content_id || null, is_complementary || false]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  const { title, description, link, content_id, is_complementary } = req.body;
  try {
    const r = await pool.query(
      `UPDATE playlists SET title=$1, description=$2, link=$3, content_id=$4,
        is_complementary=$5, updated_at=NOW()
       WHERE id=$6 AND project_id=$7 RETURNING *`,
      [title, description || null, link || null, content_id || null, is_complementary || false,
       req.params.playlistId, req.params.projectId]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlists WHERE id=$1 AND project_id=$2', [req.params.playlistId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/playlists', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlists WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All trainings deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add item to playlist with insert-and-shift
router.post('/:projectId/playlists/:playlistId/items', authenticate, async (req, res) => {
  const { curriculum_id, module_id, sequence_order } = req.body;
  if (!curriculum_id && !module_id) return res.status(400).json({ error: 'curriculum_id or module_id is required' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let pos = parseInt(sequence_order);
    if (!pos || pos < 1) {
      const maxR = await db.query(
        'SELECT COALESCE(MAX(sequence_order), 0) AS m FROM playlist_items WHERE playlist_id=$1',
        [req.params.playlistId]
      );
      pos = maxR.rows[0].m + 1;
    }
    await shiftAndInsertPlaylistItem(db, req.params.playlistId, curriculum_id || null, module_id || null, pos, true);
    await db.query('COMMIT');
    res.status(201).json({ message: 'Added' });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
});

router.delete('/:projectId/playlists/:playlistId/items/:itemId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlist_items WHERE id=$1 AND playlist_id=$2', [req.params.itemId, req.params.playlistId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Import ────────────────────────────────────────────────────────────────────
router.post('/:projectId/playlists/import', authenticate, async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { modules = [], curricula = [], primary_trainings = [], complementary_trainings = [] } = req.body;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // Step 1: upsert modules
    const moduleIdByTitle = new Map();
    for (const mod of modules) {
      if (!mod.title) continue;
      const r = await db.query(
        `INSERT INTO training_modules (project_id, title, content_id, duration_min)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (project_id, title) DO UPDATE
           SET content_id=EXCLUDED.content_id, duration_min=EXCLUDED.duration_min, updated_at=NOW()
         RETURNING id, title`,
        [projectId, mod.title, mod.content_id || null, mod.duration_min || 0]
      );
      moduleIdByTitle.set(r.rows[0].title.toLowerCase(), r.rows[0].id);
    }

    // Step 2: upsert curricula + module items (no shift during import — keep xlsx order)
    const curriculumIdByTitle = new Map();
    for (const cur of curricula) {
      if (!cur.title) continue;
      const r = await db.query(
        `INSERT INTO training_curricula (project_id, title, content_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (project_id, title) DO UPDATE SET content_id=EXCLUDED.content_id, updated_at=NOW()
         RETURNING id, title`,
        [projectId, cur.title, cur.content_id || null]
      );
      const curId = r.rows[0].id;
      curriculumIdByTitle.set(r.rows[0].title.toLowerCase(), curId);

      await db.query('DELETE FROM curriculum_module_items WHERE curriculum_id=$1', [curId]);
      for (const item of (cur.modules || [])) {
        const modId = moduleIdByTitle.get(item.title.toLowerCase());
        if (!modId) continue;
        const pos = Math.max(1, item.sequence_order || 1);
        await db.query(
          `INSERT INTO curriculum_module_items (curriculum_id, module_id, requirement, sequence_order)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (curriculum_id, module_id) DO UPDATE
             SET requirement=EXCLUDED.requirement, sequence_order=EXCLUDED.sequence_order`,
          [curId, modId, item.requirement || 'mandatory', pos]
        );
      }
    }

    // Step 3: primary trainings (no shift — preserve xlsx order)
    let importedPlaylists = 0;
    for (const pt of primary_trainings) {
      if (!pt.title) continue;
      const r = await db.query(
        `INSERT INTO playlists (project_id, title, description, link, content_id, is_complementary)
         VALUES ($1,$2,$3,$4,$5,false)
         ON CONFLICT (project_id, title) DO UPDATE
           SET description=EXCLUDED.description, link=EXCLUDED.link,
               content_id=EXCLUDED.content_id, is_complementary=false, updated_at=NOW()
         RETURNING id`,
        [projectId, pt.title, pt.description || null, pt.link || null, pt.content_id || null]
      );
      const playlistId = r.rows[0].id;
      await db.query('DELETE FROM playlist_items WHERE playlist_id=$1', [playlistId]);

      for (const cur of (pt.curricula || [])) {
        const curId = curriculumIdByTitle.get(cur.title.toLowerCase());
        if (!curId) continue;
        const pos = Math.max(1, cur.sequence_order || 1);
        await shiftAndInsertPlaylistItem(db, playlistId, curId, null, pos, false);
      }
      for (const mod of (pt.standalone_modules || [])) {
        const modId = moduleIdByTitle.get(mod.title.toLowerCase());
        if (!modId) continue;
        const pos = Math.max(1, mod.sequence_order || 1);
        await shiftAndInsertPlaylistItem(db, playlistId, null, modId, pos, false);
      }
      importedPlaylists++;
    }

    // Step 4: complementary trainings
    for (const ct of complementary_trainings) {
      if (!ct.title) continue;
      const r = await db.query(
        `INSERT INTO playlists (project_id, title, description, link, content_id, is_complementary)
         VALUES ($1,$2,$3,NULL,NULL,true)
         ON CONFLICT (project_id, title) DO UPDATE
           SET description=EXCLUDED.description, is_complementary=true, updated_at=NOW()
         RETURNING id`,
        [projectId, ct.title, ct.description || null]
      );
      const playlistId = r.rows[0].id;
      await db.query('DELETE FROM playlist_complementary_refs WHERE playlist_id=$1', [playlistId]);
      for (const ref of (ct.references || [])) {
        await db.query(
          'INSERT INTO playlist_complementary_refs (playlist_id, title, content_id, link, sequence_order) VALUES ($1,$2,$3,$4,$5)',
          [playlistId, ref.title || null, ref.content_id || null, ref.link || null, ref.sequence_order || 0]
        );
      }
      importedPlaylists++;
    }

    await db.query('COMMIT');
    res.status(201).json({
      imported_modules:   modules.length,
      imported_curricula: curricula.length,
      imported_playlists: importedPlaylists,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    db.release();
  }
});

module.exports = router;
