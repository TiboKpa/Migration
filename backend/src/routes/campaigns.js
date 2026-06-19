const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

const campaignSchema = z.object({
  campaign_name: z.string().min(1).max(200),
  template_id: z.number().int().positive().optional().nullable(),
  user_count: z.number().int().min(0).optional().nullable(),
  part_count: z.number().int().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get('/:projectId/campaigns', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM campaigns WHERE project_id=$1 ORDER BY generation_date DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET campaigns]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/campaigns', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { campaign_name, template_id, user_count, part_count, notes } = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO campaigns (project_id, campaign_name, generated_by, template_id, user_count, part_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.projectId, campaign_name, req.user.id, template_id, user_count, part_count, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST campaigns]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/campaigns/:campaignId', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND project_id=$2',
      [req.params.campaignId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET campaigns/:campaignId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
