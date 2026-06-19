const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

const projectSchema = z.object({
  project_name: z.string().min(1).max(200),
  plant_name: z.string().max(200).optional(),
  application_name: z.string().max(200).optional(),
  go_live_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateProjectSchema = projectSchema.extend({
  status: z.string().max(50).optional(),
});

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, pm.role as user_role
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /projects]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { project_name, plant_name, application_name, go_live_date, notes } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query(
      `INSERT INTO projects (project_name, plant_name, application_name, go_live_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [project_name, plant_name, application_name, go_live_date, notes, req.user.id]
    );
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,'owner')`,
      [proj.rows[0].id, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(proj.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /projects]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE p.id = $1 AND pm.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /projects/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  const parsed = updateProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { project_name, plant_name, application_name, go_live_date, status, notes } = parsed.data;
  try {
    const result = await pool.query(
      `UPDATE projects SET project_name=$1, plant_name=$2, application_name=$3,
       go_live_date=$4, status=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 AND id IN (
         SELECT project_id FROM project_members WHERE user_id=$8 AND role IN ('owner','editor')
       ) RETURNING *`,
      [project_name, plant_name, application_name, go_live_date, status, notes, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found or forbidden' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /projects/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE projects SET status='archived', updated_at=NOW()
       WHERE id=$1 AND id IN (
         SELECT project_id FROM project_members WHERE user_id=$2 AND role='owner'
       )`,
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Project archived' });
  } catch (err) {
    console.error('[DELETE /projects/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
