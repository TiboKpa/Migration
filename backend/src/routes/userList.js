const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/:projectId/users', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM project_users WHERE project_id=$1 ORDER BY last_name, first_name',
      [req.params.projectId]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/:projectId/users/import', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        await client.query(
          `INSERT INTO project_users
           (project_id, sesa_id, first_name, last_name, mail, function, role,
            pbom_champion, boc_admin, boc_member, eto_user, team_manager,
            windchill_access, tlg_group, manager_mail, status, comments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (project_id, sesa_id) DO UPDATE SET
             first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
             mail=EXCLUDED.mail, function=EXCLUDED.function, role=EXCLUDED.role,
             updated_at=NOW()`,
          [
            req.params.projectId,
            row['SESA ID'] || row['sesa_id'],
            row['First Name'] || row['first_name'],
            row['Last Name'] || row['last_name'],
            row['Mail'] || row['mail'],
            row['Function'] || row['function'],
            row['Role'] || row['role'],
            row['PBOM Champion'] === 'Yes',
            row['BOC Admin'] === 'Yes',
            row['BOC Member - MC - MCO'] === 'Yes',
            row['ETO User'] === 'Yes',
            row['Team Manager - Container Management'] === 'Yes',
            row['Windchill Access'] === 'Yes',
            row['TLG Group'] || row['tlg_group'],
            row['Manager/lead Mail'] || row['manager_mail'],
            row['Status'] || row['status'] || 'pending',
            row['Comments'] || row['comments']
          ]
        );
      }
      await client.query('COMMIT');
      res.json({ imported: rows.length });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally { client.release(); }
  } catch { res.status(500).json({ error: 'Failed to parse file' }); }
});

router.put('/:projectId/users/:userId', authenticate, async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'No fields to update' });
  const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
  const vals = keys.map(k => fields[k]);
  try {
    const result = await pool.query(
      `UPDATE project_users SET ${sets}, updated_at=NOW() WHERE id=$${vals.length + 1} AND project_id=$${vals.length + 2} RETURNING *`,
      [...vals, req.params.userId, req.params.projectId]
    );
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/:projectId/users/:userId', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM project_users WHERE id=$1 AND project_id=$2', [req.params.userId, req.params.projectId]);
    res.json({ message: 'User deleted' });
  } catch { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
