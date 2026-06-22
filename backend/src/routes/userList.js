const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

const userSchema = z.object({
  sesa_id: z.string().max(50).optional().nullable(),
  first_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  mail: z.string().email().max(254).optional().nullable(),
  pbom_champion: z.boolean().optional(),
  manager_mail: z.string().email().max(254).optional().nullable().or(z.literal('')),
  function: z.string().max(200).optional().nullable(),
  role: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  recommended_training: z.string().max(500).optional().nullable(),
  boc_admin: z.boolean().optional(),
  boc_member: z.boolean().optional(),
  eto_user: z.boolean().optional(),
  team_manager: z.boolean().optional(),
  windchill_access: z.boolean().optional(),
  tlg_group: z.string().max(200).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  comments: z.string().max(2000).optional().nullable(),
  last_contact: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const USER_FIELDS = [
  'sesa_id','first_name','last_name','mail','pbom_champion','manager_mail',
  'function','role','description','recommended_training','boc_admin','boc_member',
  'eto_user','team_manager','windchill_access','tlg_group','status','comments','last_contact'
];

router.get('/:projectId/users', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM project_users WHERE project_id=$1 ORDER BY last_name, first_name',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/users', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const u = parsed.data;
  try {
    const result = await pool.query(
      `INSERT INTO project_users
       (project_id, sesa_id, first_name, last_name, mail, pbom_champion, manager_mail,
        function, role, description, recommended_training, boc_admin, boc_member,
        eto_user, team_manager, windchill_access, tlg_group, status, comments, last_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [
        req.params.projectId,
        u.sesa_id, u.first_name, u.last_name, u.mail,
        u.pbom_champion || false, u.manager_mail || null,
        u.function, u.role, u.description, u.recommended_training,
        u.boc_admin || false, u.boc_member || false,
        u.eto_user || false, u.team_manager || false,
        u.windchill_access || false, u.tlg_group,
        u.status || 'active', u.comments, u.last_contact || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/users/import-json', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) return res.status(400).json({ error: 'No users provided' });
  if (users.length > 5000) return res.status(400).json({ error: 'Maximum 5000 users per import' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of users) {
      const parsed = userSchema.safeParse(u);
      if (!parsed.success) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid user entry: ${parsed.error.errors[0].message}` });
      }
      const d = parsed.data;
      await client.query(
        `INSERT INTO project_users
         (project_id, sesa_id, first_name, last_name, mail, pbom_champion, manager_mail,
          function, role, description, recommended_training, boc_admin, boc_member,
          eto_user, team_manager, windchill_access, tlg_group, status, comments, last_contact)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (project_id, sesa_id) DO UPDATE SET
           first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
           mail=EXCLUDED.mail, pbom_champion=EXCLUDED.pbom_champion,
           manager_mail=EXCLUDED.manager_mail, function=EXCLUDED.function,
           role=EXCLUDED.role, description=EXCLUDED.description,
           recommended_training=EXCLUDED.recommended_training,
           boc_admin=EXCLUDED.boc_admin, boc_member=EXCLUDED.boc_member,
           eto_user=EXCLUDED.eto_user, team_manager=EXCLUDED.team_manager,
           windchill_access=EXCLUDED.windchill_access, tlg_group=EXCLUDED.tlg_group,
           status=EXCLUDED.status, comments=EXCLUDED.comments,
           last_contact=EXCLUDED.last_contact, updated_at=NOW()`,
        [
          req.params.projectId,
          d.sesa_id, d.first_name, d.last_name, d.mail,
          d.pbom_champion || false, d.manager_mail || null,
          d.function, d.role, d.description, d.recommended_training,
          d.boc_admin || false, d.boc_member || false,
          d.eto_user || false, d.team_manager || false,
          d.windchill_access || false, d.tlg_group,
          d.status || 'active', d.comments, d.last_contact || null
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ imported: users.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST users/import-json]', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally { client.release(); }
});

router.put('/:projectId/users/:userId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => USER_FIELDS.includes(k)));
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No valid fields' });
  const partialSchema = userSchema.partial();
  const parsed = partialSchema.safeParse(fields);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const keys = Object.keys(parsed.data);
  const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
  const vals = keys.map(k => parsed.data[k]);
  try {
    const result = await pool.query(
      `UPDATE project_users SET ${sets}, updated_at=NOW() WHERE id=$${vals.length + 1} AND project_id=$${vals.length + 2} RETURNING *`,
      [...vals, req.params.userId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT users/:userId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/users', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM project_users WHERE project_id=$1 RETURNING id',
      [req.params.projectId]
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error('[DELETE all users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId/users/:userId', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    await pool.query('DELETE FROM project_users WHERE id=$1 AND project_id=$2', [req.params.userId, req.params.projectId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE users/:userId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
