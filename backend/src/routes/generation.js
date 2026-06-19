const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

const previewSchema = z.object({
  user_id: z.number().int().positive(),
});

function resolveTrainingPath(user, mappings) {
  return mappings.filter(m => {
    if (m.applies_when_eto && !user.eto_user) return false;
    if (m.applies_when_boc_admin && !user.boc_admin) return false;
    if (m.applies_when_boc_member && !user.boc_member) return false;
    if (m.applies_when_team_manager && !user.team_manager) return false;
    return true;
  });
}

function renderTemplate(html, data) {
  return Object.entries(data).reduce((acc, [key, val]) => {
    return acc.replace(new RegExp(`\\{${key}\\}`, 'g'), val || '');
  }, html);
}

router.post('/:projectId/generate/preview', authenticate, requireMember(), async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { user_id } = parsed.data;
  try {
    const project = (await pool.query(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE p.id=$1 AND pm.user_id=$2`,
      [req.params.projectId, req.user.id]
    )).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const template = (await pool.query(
      'SELECT * FROM templates WHERE project_id=$1 AND is_default=true',
      [req.params.projectId]
    )).rows[0];
    if (!template) return res.status(400).json({ error: 'No active template' });
    const user = (await pool.query(
      'SELECT * FROM project_users WHERE id=$1 AND project_id=$2',
      [user_id, req.params.projectId]
    )).rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const profile = (await pool.query(
      'SELECT * FROM training_profiles WHERE project_id=$1 AND profile_name=$2',
      [req.params.projectId, user.role]
    )).rows[0];
    let resolvedPath = [];
    if (profile) {
      const mappings = (await pool.query(
        `SELECT pm.*, tr.training_title, tr.training_family, tr.duration_decimal, tr.duration_hhmm
         FROM profile_training_mappings pm
         JOIN training_references tr ON tr.id=pm.training_id
         WHERE pm.profile_id=$1 ORDER BY pm.sequence_order`,
        [profile.id]
      )).rows;
      resolvedPath = resolveTrainingPath(user, mappings);
    }
    const totalHours = resolvedPath.reduce((sum, m) => sum + (parseFloat(m.duration_decimal) || 0), 0).toFixed(1);
    const rendered = renderTemplate(template.html_content, {
      APP_NAME: project.application_name,
      PLANT_NAME: project.plant_name,
      GO_LIVE_DATE: project.go_live_date,
      USER_ROLE: user.role,
      TOTAL_HOURS: totalHours,
      WAVE_HOURS: totalHours,
      WAVE_NUMBER: '1',
      W1_TEXT: resolvedPath.map(m => m.training_title).join(', '),
      W2_TEXT: '',
      W3_TEXT: '',
      W4_TEXT: '',
      SUPPORT_CHAMPIONS: project.support_champions || ''
    });
    res.json({ html: rendered, path: resolvedPath, total_hours: totalHours });
  } catch (err) {
    console.error('[POST generate/preview]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
