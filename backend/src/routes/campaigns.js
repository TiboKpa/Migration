const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.get('/:projectId/campaigns', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM campaigns WHERE project_id=$1 ORDER BY generation_date DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/campaigns', authenticate, async (req, res) => {
  const { campaign_name, template_id, user_count, part_count, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO campaigns (project_id, campaign_name, generated_by, template_id, user_count, part_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.projectId, campaign_name, req.user.id, template_id, user_count, part_count, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/:projectId/campaigns/:campaignId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND project_id=$2',
      [req.params.campaignId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
