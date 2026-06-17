const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.get('/:projectId/users', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM project_users WHERE project_id=$1 ORDER BY last_name, first_name',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/users/import-json', authenticate, async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) return res.status(400).json({ error: 'No users provided' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of users) {
      await client.query(
        `INSERT INTO project_users
         (project_id, sesa_id, first_name, last_name, mail, pbom_champion, manager_mail,
          function, role, description, recommended_training, boc_admin, boc_member,
          eto_user, team_manager, windchill_access, tlg_group, status, comments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
           updated_at=NOW()`,
        [
          req.params.projectId,
          u.sesa_id, u.first_name, u.last_name, u.mail,
          u.pbom_champion || false, u.manager_mail,
          u.function, u.role, u.description, u.recommended_training,
          u.boc_admin || false, u.boc_member || false,
          u.eto_user || false, u.team_manager || false,
          u.windchill_access || false, u.tlg_group,
          u.status || 'pending', u.comments
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ imported: users.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.put('/:projectId/users/:userId', authenticate, async (req, res) => {
  const allowed = ['sesa_id','first_name','last_name','mail','pbom_champion','manager_mail',
    'function','role','description','recommended_training','boc_admin','boc_member',
    'eto_user','team_manager','windchill_access','tlg_group','status','comments'];
  const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No valid fields' });
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
  const vals = keys.map(k => fields[k]);
  try {
    const result = await pool.query(
      `UPDATE project_users SET ${sets}, updated_at=NOW() WHERE id=$${vals.length + 1} AND project_id=$${vals.length + 2} RETURNING *`,
      [...vals, req.params.userId, req.params.projectId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/users/:userId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_users WHERE id=$1 AND project_id=$2', [req.params.userId, req.params.projectId]);
    res.json({ message: 'User deleted' });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
