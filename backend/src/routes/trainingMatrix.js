const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.get('/:projectId/profiles', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM training_profiles WHERE project_id=$1 ORDER BY profile_name',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:projectId/trainings', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM training_references WHERE project_id=$1 ORDER BY training_title',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:projectId/profiles/:profileId/mappings', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.*, tr.training_title, tr.training_family, tr.duration_hhmm, tr.duration_decimal, tr.content_type
       FROM profile_training_mappings pm
       JOIN training_references tr ON tr.id = pm.training_id
       WHERE pm.profile_id=$1
       ORDER BY pm.sequence_order`,
      [req.params.profileId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/profiles', authenticate, async (req, res) => {
  const { profile_name, function_scope, eto_variant, default_tlg_group } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_profiles (project_id, profile_name, function_scope, eto_variant, default_tlg_group)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.projectId, profile_name, function_scope, eto_variant || false, default_tlg_group]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/trainings', authenticate, async (req, res) => {
  const { training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_references (project_id, training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.projectId, training_title, training_family, duration_hhmm, duration_decimal, learning_object_code, content_type, learning_url, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/profiles/:profileId/mappings', authenticate, async (req, res) => {
  const { training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO profile_training_mappings
       (profile_id, training_id, requirement_type, sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.profileId, training_id, requirement_type || 'mandatory', sequence_order, applies_when_eto, applies_when_boc_admin, applies_when_boc_member, applies_when_team_manager]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
