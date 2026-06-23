const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) return cb(null, true);
    cb(new Error('Only HTML files are allowed'));
  },
});

const templateMetaSchema = z.object({
  template_name: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

// GET all templates for project
router.get('/:projectId/templates', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM templates WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET templates]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single template
router.get('/:projectId/templates/:templateId', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM templates WHERE id=$1 AND project_id=$2',
      [req.params.templateId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET templates/:templateId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST upload new template
router.post('/:projectId/templates/upload', authenticate, requireMember(['owner', 'editor']), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const metaParsed = templateMetaSchema.safeParse(req.body);
  if (!metaParsed.success) return res.status(400).json({ error: metaParsed.error.errors[0].message });
  const html = req.file.buffer.toString('utf8');
  const { template_name, notes } = metaParsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO templates (project_id, template_name, source_type, html_content, notes)
       VALUES ($1,$2,'uploaded',$3,$4) RETURNING *`,
      [req.params.projectId, template_name || req.file.originalname, html, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST templates/upload]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH rename template
router.patch('/:projectId/templates/:templateId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { template_name } = req.body;
  if (!template_name || typeof template_name !== 'string' || !template_name.trim()) {
    return res.status(400).json({ error: 'template_name is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE templates SET template_name=$1, updated_at=NOW()
       WHERE id=$2 AND project_id=$3 AND source_type='uploaded' RETURNING *`,
      [template_name.trim(), req.params.templateId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found or not renameable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PATCH templates/:templateId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT activate / set as default
router.put('/:projectId/templates/:templateId/activate', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('UPDATE templates SET is_default=false WHERE project_id=$1', [req.params.projectId]);
    const result = await dbClient.query(
      'UPDATE templates SET is_default=true, updated_at=NOW() WHERE id=$1 AND project_id=$2 RETURNING *',
      [req.params.templateId, req.params.projectId]
    );
    await dbClient.query(
      'UPDATE projects SET default_template_id=$1, updated_at=NOW() WHERE id=$2',
      [req.params.templateId, req.params.projectId]
    );
    await dbClient.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('[PUT templates/:templateId/activate]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { dbClient.release(); }
});

// DELETE template (uploaded only)
router.delete('/:projectId/templates/:templateId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM templates WHERE id=$1 AND project_id=$2 AND source_type='uploaded'",
      [req.params.templateId, req.params.projectId]
    );
    res.json({ message: 'Template deleted' });
  } catch (err) {
    console.error('[DELETE templates/:templateId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
