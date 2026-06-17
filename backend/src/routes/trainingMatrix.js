const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// ── Legacy routes (kept for role-matrix lookup compatibility) ─────────────────
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

// ── Playlists ─────────────────────────────────────────────────────────────────

router.get('/:projectId/playlists', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM playlists WHERE project_id=$1 ORDER BY title',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  try {
    const plRes = await pool.query('SELECT * FROM playlists WHERE id=$1 AND project_id=$2', [req.params.playlistId, req.params.projectId]);
    if (plRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const playlist = plRes.rows[0];

    const curricula = (await pool.query(
      'SELECT * FROM playlist_curricula WHERE playlist_id=$1 ORDER BY sequence_order, id',
      [playlist.id]
    )).rows;

    const modules = (await pool.query(
      'SELECT * FROM playlist_modules WHERE playlist_id=$1 ORDER BY sequence_order, id',
      [playlist.id]
    )).rows;

    const curriculaWithModules = curricula.map(c => ({
      ...c,
      modules: modules.filter(m => m.curriculum_id === c.id)
    }));
    const standaloneModules = modules.filter(m => m.curriculum_id === null);

    const mandatoryMinutes = modules
      .filter(m => m.requirement === 'mandatory')
      .reduce((sum, m) => sum + (m.duration_min || 0), 0);
    const hours = Math.floor(mandatoryMinutes / 60);
    const mins = mandatoryMinutes % 60;
    const duration_computed = `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;

    res.json({ ...playlist, curricula: curriculaWithModules, standalone_modules: standaloneModules, duration_computed, total_minutes: mandatoryMinutes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/playlists', authenticate, async (req, res) => {
  const { title, description, link, content_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const result = await pool.query(
      'INSERT INTO playlists (project_id, title, description, link, content_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.projectId, title, description, link, content_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  const { title, description, link, content_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE playlists SET title=$1, description=$2, link=$3, content_id=$4, updated_at=NOW() WHERE id=$5 AND project_id=$6 RETURNING *',
      [title, description, link, content_id, req.params.playlistId, req.params.projectId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/playlists/:playlistId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlists WHERE id=$1 AND project_id=$2', [req.params.playlistId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Import playlists from Training Path Flat xlsx ─────────────────────────────
// POST /:projectId/playlists/import
// Body: JSON produced by the frontend xlsx parser
// Shape:
// [
//   {
//     title: string,
//     description: string,
//     link: string,
//     content_id: string,
//     curricula: [
//       {
//         title: string, content_id: string, requirement: 'mandatory'|'optional',
//         sequence_order: number,
//         modules: [
//           { title, content_id, duration_min, requirement, sequence_order }
//         ]
//       }
//     ],
//     standalone_modules: [
//       { title, content_id, duration_min, requirement, sequence_order }
//     ]
//   }
// ]
// Behaviour: upsert by title within the project (update if exists, insert if not).
router.post('/:projectId/playlists/import', authenticate, async (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const playlists = req.body;
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return res.status(400).json({ error: 'Body must be a non-empty array of playlists' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const summary = [];

    for (const pl of playlists) {
      if (!pl.title) continue;

      // Upsert playlist
      const existing = await client.query(
        'SELECT id FROM playlists WHERE project_id=$1 AND title=$2',
        [projectId, pl.title]
      );

      let playlistId;
      if (existing.rows.length > 0) {
        playlistId = existing.rows[0].id;
        await client.query(
          'UPDATE playlists SET description=$1, link=$2, content_id=$3, updated_at=NOW() WHERE id=$4',
          [pl.description || null, pl.link || null, pl.content_id || null, playlistId]
        );
        // Remove existing curricula and modules so we rebuild cleanly
        await client.query('DELETE FROM playlist_modules WHERE playlist_id=$1 AND curriculum_id IN (SELECT id FROM playlist_curricula WHERE playlist_id=$1)', [playlistId]);
        await client.query('DELETE FROM playlist_curricula WHERE playlist_id=$1', [playlistId]);
        await client.query('DELETE FROM playlist_modules WHERE playlist_id=$1 AND curriculum_id IS NULL', [playlistId]);
      } else {
        const ins = await client.query(
          'INSERT INTO playlists (project_id, title, description, link, content_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [projectId, pl.title, pl.description || null, pl.link || null, pl.content_id || null]
        );
        playlistId = ins.rows[0].id;
      }

      // Insert curricula with their modules
      for (const cur of (pl.curricula || [])) {
        const curRes = await client.query(
          'INSERT INTO playlist_curricula (playlist_id, title, content_id, requirement, sequence_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [playlistId, cur.title, cur.content_id || null, cur.requirement || 'mandatory', cur.sequence_order || 0]
        );
        const curriculumId = curRes.rows[0].id;

        for (const mod of (cur.modules || [])) {
          await client.query(
            'INSERT INTO playlist_modules (playlist_id, curriculum_id, title, content_id, duration_min, requirement, sequence_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [playlistId, curriculumId, mod.title, mod.content_id || null, mod.duration_min || 0, mod.requirement || 'mandatory', mod.sequence_order || 0]
          );
        }
      }

      // Insert standalone modules
      for (const mod of (pl.standalone_modules || [])) {
        await client.query(
          'INSERT INTO playlist_modules (playlist_id, curriculum_id, title, content_id, duration_min, requirement, sequence_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [playlistId, null, mod.title, mod.content_id || null, mod.duration_min || 0, mod.requirement || 'mandatory', mod.sequence_order || 0]
        );
      }

      summary.push({ title: pl.title, id: playlistId });
    }

    await client.query('COMMIT');
    res.status(201).json({ imported: summary.length, playlists: summary });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Curricula ─────────────────────────────────────────────────────────────────

router.post('/:projectId/playlists/:playlistId/curricula', authenticate, async (req, res) => {
  const { title, content_id, requirement, sequence_order } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const result = await pool.query(
      'INSERT INTO playlist_curricula (playlist_id, title, content_id, requirement, sequence_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.params.playlistId, title, content_id, requirement || 'mandatory', sequence_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/playlists/:playlistId/curricula/:curriculumId', authenticate, async (req, res) => {
  const { title, content_id, requirement, sequence_order } = req.body;
  try {
    const result = await pool.query(
      'UPDATE playlist_curricula SET title=$1, content_id=$2, requirement=$3, sequence_order=$4 WHERE id=$5 AND playlist_id=$6 RETURNING *',
      [title, content_id, requirement, sequence_order, req.params.curriculumId, req.params.playlistId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/playlists/:playlistId/curricula/:curriculumId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlist_curricula WHERE id=$1 AND playlist_id=$2', [req.params.curriculumId, req.params.playlistId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Modules ───────────────────────────────────────────────────────────────────

router.post('/:projectId/playlists/:playlistId/modules', authenticate, async (req, res) => {
  const { title, content_id, duration_min, requirement, sequence_order, curriculum_id } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const result = await pool.query(
      'INSERT INTO playlist_modules (playlist_id, curriculum_id, title, content_id, duration_min, requirement, sequence_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.playlistId, curriculum_id || null, title, content_id, duration_min || 0, requirement || 'mandatory', sequence_order || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/playlists/:playlistId/modules/:moduleId', authenticate, async (req, res) => {
  const { title, content_id, duration_min, requirement, sequence_order, curriculum_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE playlist_modules SET title=$1, content_id=$2, duration_min=$3, requirement=$4, sequence_order=$5, curriculum_id=$6 WHERE id=$7 AND playlist_id=$8 RETURNING *',
      [title, content_id, duration_min, requirement, sequence_order, curriculum_id || null, req.params.moduleId, req.params.playlistId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/playlists/:playlistId/modules/:moduleId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM playlist_modules WHERE id=$1 AND playlist_id=$2', [req.params.moduleId, req.params.playlistId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
