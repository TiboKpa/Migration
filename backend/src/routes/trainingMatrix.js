const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function renumberCurriculumModules(db, curriculumId) {
  await db.query(
    `UPDATE curriculum_module_items cmi
     SET sequence_order = sub.rn
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY sequence_order) AS rn
       FROM curriculum_module_items
       WHERE curriculum_id = $1
     ) sub
     WHERE cmi.id = sub.id`,
    [curriculumId]
  );
}

async function renumberPlaylistItems(db, playlistId) {
  await db.query(
    `UPDATE playlist_items pi
     SET sequence_order = sub.rn
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY sequence_order) AS rn
       FROM playlist_items
       WHERE playlist_id = $1
     ) sub
     WHERE pi.id = sub.id`,
    [playlistId]
  );
}

// ── Legacy routes ─────────────────────────────────────────────────────────────
router.get('/:projectId/profiles', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM training_profiles WHERE project_id=$1 ORDER BY profile_name', [req.params.projectId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET profiles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/trainings', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM training_references WHERE project_id=$1 ORDER BY training_title', [req.params.projectId]);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET trainings]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/profiles/:profileId/mappings', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, tr.training_title, tr.training_family, tr.duration_hhmm, tr.duration_decimal, tr.content_type
       FROM profile_training_mappings pm
       JOIN training_references tr ON tr.id = pm.training_id
       WHERE pm.profile_id=$1 ORDER BY pm.sequence_order`,
      [req.params.profileId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET profile mappings]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/profiles', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { profile_name, function_scope, eto_variant, default_tlg_group } = req.body;
  if (!profile_name || !String(profile_name).trim())
    return res.status(400).json({ error: 'profile_name is required' });
  try {
    const result = await pool.query(
      `INSERT INTO training_profiles (project_id, profile_name, function_scope, eto_variant, default_tlg_group) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.projectId, String(profile_name).slice(0, 200), function_scope || null, eto_variant === true, default_tlg_group || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST profiles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/trainings', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes } = req.body;
  if (!training_title || !String(training_title).trim())
    return res.status(400).json({ error: 'training_title is required' });
  try {
    const result = await pool.query(
      `INSERT INTO training_references (project_id, training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.projectId, String(training_title).slice(0, 500), training_family || null, duration_hhmm || null, duration_decimal || null, learning_object_code || null, content_type || null, learning_url ? String(learning_url).slice(0, 2048) : null, notes ? String(notes).slice(0, 2000) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST trainings]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/profiles/:profileId/mappings', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager } = req.body;
  if (!training_id) return res.status(400).json({ error: 'training_id is required' });
  try {
    const result = await pool.query(
      `INSERT INTO profile_training_mappings (profile_id, training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.profileId, training_id, requirement_type || 'mandatory', sequence_order || 0, applies_when_eto === true, applies_when_boc_admin === true, applies_when_boc_member === true, applies_when_team_manager === true]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST profile mappings]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Modules ───────────────────────────────────────────────────────────────────

router.get('/:projectId/modules', authenticate, requireMember(), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM training_modules WHERE project_id=$1 ORDER BY title', [req.params.projectId]);
    res.json(r.rows);
  } catch (err) {
    console.error('[GET modules]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/modules', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, content_id, duration_min, link } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO training_modules (project_id, title, content_id, duration_min, link)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, title) DO UPDATE
         SET content_id=EXCLUDED.content_id, duration_min=EXCLUDED.duration_min,
             link=EXCLUDED.link, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, String(title).slice(0, 500), content_id ? String(content_id).slice(0, 200) : null, Math.max(0, parseInt(duration_min) || 0), link ? String(link).slice(0, 2048) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST modules]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:projectId/modules/:moduleId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, content_id, duration_min, link } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `UPDATE training_modules SET title=$1, content_id=$2, duration_min=$3, link=$4, updated_at=NOW()
       WHERE id=$5 AND project_id=$6 RETURNING *`,
      [String(title).slice(0, 500), content_id ? String(content_id).slice(0, 200) : null, Math.max(0, parseInt(duration_min) || 0), link ? String(link).slice(0, 2048) : null, req.params.moduleId, req.params.projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT modules/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/modules/:moduleId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    await pool.query('DELETE FROM training_modules WHERE id=$1 AND project_id=$2', [req.params.moduleId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE modules/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/modules', authenticate, requireMember(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM training_modules WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All modules deleted' });
  } catch (err) {
    console.error('[DELETE modules]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Curricula ─────────────────────────────────────────────────────────────────

router.get('/:projectId/curricula', authenticate, requireMember(), async (req, res) => {
  try {
    const curricula = (await pool.query(
      'SELECT * FROM training_curricula WHERE project_id=$1 ORDER BY title',
      [req.params.projectId]
    )).rows;

    const items = curricula.length === 0 ? [] : (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id,
              tm.duration_min, tm.link AS module_link
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id = ANY($1::int[])
       ORDER BY cmi.sequence_order`,
      [curricula.map(c => c.id)]
    )).rows;

    res.json(curricula.map(c => ({ ...c, modules: items.filter(i => i.curriculum_id === c.id) })));
  } catch (err) {
    console.error('[GET curricula]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/curricula/:curriculumId', authenticate, requireMember(), async (req, res) => {
  try {
    const cur = (await pool.query(
      'SELECT * FROM training_curricula WHERE id=$1 AND project_id=$2',
      [req.params.curriculumId, req.params.projectId]
    )).rows[0];
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const modules = (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id,
              tm.duration_min, tm.link AS module_link
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id=$1 ORDER BY cmi.sequence_order`,
      [cur.id]
    )).rows;
    res.json({ ...cur, modules });
  } catch (err) {
    console.error('[GET curricula/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/curricula', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, content_id, link } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO training_curricula (project_id, title, content_id, link)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, title) DO UPDATE
         SET content_id=EXCLUDED.content_id, link=EXCLUDED.link, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, String(title).slice(0, 500), content_id ? String(content_id).slice(0, 200) : null, link ? String(link).slice(0, 2048) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST curricula]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:projectId/curricula/:curriculumId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, content_id, link } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `UPDATE training_curricula SET title=$1, content_id=$2, link=$3, updated_at=NOW()
       WHERE id=$4 AND project_id=$5 RETURNING *`,
      [String(title).slice(0, 500), content_id ? String(content_id).slice(0, 200) : null, link ? String(link).slice(0, 2048) : null, req.params.curriculumId, req.params.projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT curricula/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/curricula/:curriculumId/modules', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { module_id, requirement, sequence_order } = req.body;
  if (!module_id) return res.status(400).json({ error: 'module_id is required' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
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
    console.error('[POST curricula/:id/modules]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

router.patch('/:projectId/curricula/:curriculumId/modules/:moduleId/reorder', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { new_order } = req.body;
  if (!new_order || new_order < 1) return res.status(400).json({ error: 'new_order >= 1 is required' });
  const { curriculumId, moduleId } = req.params;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query(
      'SELECT sequence_order FROM curriculum_module_items WHERE curriculum_id=$1 AND module_id=$2',
      [curriculumId, moduleId]
    );
    if (cur.rows.length === 0) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
    const oldOrder = cur.rows[0].sequence_order;
    const newOrder = parseInt(new_order);
    if (oldOrder === newOrder) { await db.query('COMMIT'); return res.json({ old_order: oldOrder, new_order: newOrder }); }
    if (newOrder > oldOrder) {
      await db.query(
        `UPDATE curriculum_module_items SET sequence_order = sequence_order - 1
         WHERE curriculum_id=$1 AND sequence_order > $2 AND sequence_order <= $3`,
        [curriculumId, oldOrder, newOrder]
      );
    } else {
      await db.query(
        `UPDATE curriculum_module_items SET sequence_order = sequence_order + 1
         WHERE curriculum_id=$1 AND sequence_order >= $2 AND sequence_order < $3`,
        [curriculumId, newOrder, oldOrder]
      );
    }
    await db.query(
      'UPDATE curriculum_module_items SET sequence_order=$1 WHERE curriculum_id=$2 AND module_id=$3',
      [newOrder, curriculumId, moduleId]
    );
    await db.query('COMMIT');
    res.json({ old_order: oldOrder, new_order: newOrder });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[PATCH curricula/:id/modules/:id/reorder]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

router.delete('/:projectId/curricula/:curriculumId/modules/:moduleId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'DELETE FROM curriculum_module_items WHERE curriculum_id=$1 AND module_id=$2',
      [req.params.curriculumId, req.params.moduleId]
    );
    await renumberCurriculumModules(db, req.params.curriculumId);
    await db.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[DELETE curricula/:id/modules/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

router.delete('/:projectId/curricula/:curriculumId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    await pool.query('DELETE FROM training_curricula WHERE id=$1 AND project_id=$2', [req.params.curriculumId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE curricula/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/curricula', authenticate, requireMember(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM training_curricula WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All curricula deleted' });
  } catch (err) {
    console.error('[DELETE curricula]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Playlists ─────────────────────────────────────────────────────────────────

router.get('/:projectId/playlists', authenticate, requireMember(), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM playlists WHERE project_id=$1 ORDER BY title',
      [req.params.projectId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET playlists]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/playlists/:playlistId', authenticate, requireMember(), async (req, res) => {
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
              tc.link  AS curriculum_link,
              tm.title AS module_title, tm.content_id AS module_content_id,
              tm.duration_min, tm.link AS module_link
       FROM playlist_items pi
       LEFT JOIN training_curricula tc ON tc.id = pi.curriculum_id
       LEFT JOIN training_modules   tm ON tm.id = pi.module_id
       WHERE pi.playlist_id=$1
       ORDER BY pi.sequence_order`,
      [playlist.id]
    )).rows;

    const curriculumIds = [...new Set(items.filter(i => i.curriculum_id).map(i => i.curriculum_id))];
    const curriculumModules = curriculumIds.length === 0 ? [] : (await pool.query(
      `SELECT cmi.*, tm.title AS module_title, tm.content_id AS module_content_id,
              tm.duration_min, tm.link AS module_link
       FROM curriculum_module_items cmi
       JOIN training_modules tm ON tm.id = cmi.module_id
       WHERE cmi.curriculum_id = ANY($1::int[])
       ORDER BY cmi.sequence_order`,
      [curriculumIds]
    )).rows;

    const orderedItems = items.map(i => {
      if (i.curriculum_id) {
        return {
          kind:             'curriculum',
          playlist_item_id: i.id,
          curriculum_id:    i.curriculum_id,
          title:            i.curriculum_title,
          content_id:       i.curriculum_content_id,
          link:             i.curriculum_link,
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
        link:             i.module_link,
        duration_min:     i.duration_min,
        sequence_order:   i.sequence_order,
      };
    });

    const curricula          = orderedItems.filter(x => x.kind === 'curriculum');
    const standalone_modules = orderedItems.filter(x => x.kind === 'module');

    const allModules = [...curricula.flatMap(c => c.modules), ...standalone_modules];
    const total_minutes = allModules
      .filter(m => (m.requirement || 'mandatory') === 'mandatory')
      .reduce((s, m) => s + (m.duration_min || 0), 0);

    res.json({ ...playlist, ordered_items: orderedItems, curricula, standalone_modules, total_minutes });
  } catch (err) {
    console.error('[GET playlists/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/playlists', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, description, link, content_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `INSERT INTO playlists (project_id, title, description, link, content_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, title) DO UPDATE
         SET description=EXCLUDED.description, link=EXCLUDED.link,
             content_id=EXCLUDED.content_id, updated_at=NOW()
       RETURNING *`,
      [req.params.projectId, String(title).slice(0, 500), description ? String(description).slice(0, 2000) : null, link ? String(link).slice(0, 2048) : null, content_id ? String(content_id).slice(0, 200) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST playlists]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:projectId/playlists/:playlistId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { title, description, link, content_id } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  try {
    const r = await pool.query(
      `UPDATE playlists SET title=$1, description=$2, link=$3, content_id=$4, updated_at=NOW()
       WHERE id=$5 AND project_id=$6 RETURNING *`,
      [String(title).slice(0, 500), description ? String(description).slice(0, 2000) : null, link ? String(link).slice(0, 2048) : null, content_id ? String(content_id).slice(0, 200) : null,
       req.params.playlistId, req.params.projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT playlists/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/playlists/:playlistId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    await pool.query('DELETE FROM playlists WHERE id=$1 AND project_id=$2', [req.params.playlistId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE playlists/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/playlists', authenticate, requireMember(['owner']), async (req, res) => {
  try {
    await pool.query('DELETE FROM playlists WHERE project_id=$1', [req.params.projectId]);
    res.json({ message: 'All trainings deleted' });
  } catch (err) {
    console.error('[DELETE playlists]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/playlists/:playlistId/items', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
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
    console.error('[POST playlists/:id/items]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

router.patch('/:projectId/playlists/:playlistId/items/:itemId/reorder', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { new_order } = req.body;
  if (!new_order || new_order < 1) return res.status(400).json({ error: 'new_order >= 1 is required' });
  const { playlistId, itemId } = req.params;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query(
      'SELECT sequence_order FROM playlist_items WHERE id=$1 AND playlist_id=$2',
      [itemId, playlistId]
    );
    if (cur.rows.length === 0) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }
    const oldOrder = cur.rows[0].sequence_order;
    const newOrder = parseInt(new_order);
    if (oldOrder === newOrder) { await db.query('COMMIT'); return res.json({ old_order: oldOrder, new_order: newOrder }); }
    if (newOrder > oldOrder) {
      await db.query(
        `UPDATE playlist_items SET sequence_order = sequence_order - 1
         WHERE playlist_id=$1 AND sequence_order > $2 AND sequence_order <= $3`,
        [playlistId, oldOrder, newOrder]
      );
    } else {
      await db.query(
        `UPDATE playlist_items SET sequence_order = sequence_order + 1
         WHERE playlist_id=$1 AND sequence_order >= $2 AND sequence_order < $3`,
        [playlistId, newOrder, oldOrder]
      );
    }
    await db.query(
      'UPDATE playlist_items SET sequence_order=$1 WHERE id=$2 AND playlist_id=$3',
      [newOrder, itemId, playlistId]
    );
    await db.query('COMMIT');
    res.json({ old_order: oldOrder, new_order: newOrder });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[PATCH playlists/:id/items/:id/reorder]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

router.delete('/:projectId/playlists/:playlistId/items/:itemId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'DELETE FROM playlist_items WHERE id=$1 AND playlist_id=$2',
      [req.params.itemId, req.params.playlistId]
    );
    await renumberPlaylistItems(db, req.params.playlistId);
    await db.query('COMMIT');
    res.json({ message: 'Deleted' });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[DELETE playlists/:id/items/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { db.release(); }
});

// ── Import ────────────────────────────────────────────────────────────────────
router.post('/:projectId/playlists/import', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { modules = [], curricula = [], primary_trainings = [] } = req.body;

  const MAX_ITEMS = 2000;
  if (modules.length > MAX_ITEMS || curricula.length > MAX_ITEMS || primary_trainings.length > MAX_ITEMS)
    return res.status(400).json({ error: `Maximum ${MAX_ITEMS} items per import per category` });

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    const moduleIdByTitle = new Map();
    for (const mod of modules) {
      if (!mod.title) continue;
      const r = await db.query(
        `INSERT INTO training_modules (project_id, title, content_id, duration_min, link)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, title) DO UPDATE
           SET content_id=EXCLUDED.content_id, duration_min=EXCLUDED.duration_min,
               link=EXCLUDED.link, updated_at=NOW()
         RETURNING id, title`,
        [projectId, String(mod.title).slice(0, 500), mod.content_id ? String(mod.content_id).slice(0, 200) : null, Math.max(0, parseInt(mod.duration_min) || 0), mod.link ? String(mod.link).slice(0, 2048) : null]
      );
      moduleIdByTitle.set(r.rows[0].title.toLowerCase(), r.rows[0].id);
    }

    const curriculumIdByTitle = new Map();
    for (const cur of curricula) {
      if (!cur.title) continue;
      const r = await db.query(
        `INSERT INTO training_curricula (project_id, title, content_id, link)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (project_id, title) DO UPDATE
           SET content_id=EXCLUDED.content_id, link=EXCLUDED.link, updated_at=NOW()
         RETURNING id, title`,
        [projectId, String(cur.title).slice(0, 500), cur.content_id ? String(cur.content_id).slice(0, 200) : null, cur.link ? String(cur.link).slice(0, 2048) : null]
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

    let importedPlaylists = 0;
    for (const pt of primary_trainings) {
      if (!pt.title) continue;
      const r = await db.query(
        `INSERT INTO playlists (project_id, title, description, link, content_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, title) DO UPDATE
           SET description=EXCLUDED.description, link=EXCLUDED.link,
               content_id=EXCLUDED.content_id, updated_at=NOW()
         RETURNING id`,
        [projectId, String(pt.title).slice(0, 500), pt.description ? String(pt.description).slice(0, 2000) : null, pt.link ? String(pt.link).slice(0, 2048) : null, pt.content_id ? String(pt.content_id).slice(0, 200) : null]
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

    await db.query('COMMIT');
    res.status(201).json({
      imported_modules:   modules.length,
      imported_curricula: curricula.length,
      imported_playlists: importedPlaylists,
    });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[POST playlists/import]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    db.release();
  }
});

module.exports = router;
