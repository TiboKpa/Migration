const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/:projectId/templates', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM templates WHERE project_id=$1 ORDER BY created_at DESC',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/templates/upload', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const html = req.file.buffer.toString('utf8');
  const { template_name, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO templates (project_id, template_name, source_type, html_content, notes)
       VALUES ($1,$2,'uploaded',$3,$4) RETURNING *`,
      [req.params.projectId, template_name || req.file.originalname, html, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/:projectId/templates/:templateId/activate', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE templates SET is_default=false WHERE project_id=$1',
      [req.params.projectId]
    );
    const result = await client.query(
      'UPDATE templates SET is_default=true, updated_at=NOW() WHERE id=$1 AND project_id=$2 RETURNING *',
      [req.params.templateId, req.params.projectId]
    );
    await client.query(
      'UPDATE projects SET default_template_id=$1, updated_at=NOW() WHERE id=$2',
      [req.params.templateId, req.params.projectId]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.delete('/:projectId/templates/:templateId', authenticate, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM templates WHERE id=$1 AND project_id=$2 AND source_type='uploaded'",
      [req.params.templateId, req.params.projectId]
    );
    res.json({ message: 'Template deleted' });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
