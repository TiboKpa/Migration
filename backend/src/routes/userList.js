const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

// Fixed columns that are always present on project_users.
const FIXED_FIELDS = [
  'sesa_id', 'first_name', 'last_name', 'mail', 'manager_mail',
  'function', 'role', 'description',
  'recommended_training', 'complementary_names',
  'tlg_group', 'tlg_addon',
  'status', 'comments', 'last_contact',
];

// Accepts a valid email string, or null/undefined/empty string (all stored as null).
const emailOrNull = z
  .union([
    z.string().email().max(254),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform(v => (v === '' || v == null) ? null : v)
  .optional()
  .nullable();

const fixedSchema = z.object({
  sesa_id:              z.string().max(50).optional().nullable(),
  first_name:           z.string().max(100).optional().nullable(),
  last_name:            z.string().max(100).optional().nullable(),
  mail:                 emailOrNull,
  manager_mail:         emailOrNull,
  function:             z.string().max(200).optional().nullable(),
  role:                 z.string().max(200).optional().nullable(),
  description:          z.string().max(1000).optional().nullable(),
  recommended_training: z.string().max(500).optional().nullable(),
  complementary_names:  z.array(z.string()).optional().default([]),
  tlg_group:            z.string().max(200).optional().nullable(),
  tlg_addon:            z.array(z.string()).optional().default([]),
  status:               z.string().max(50).optional().nullable(),
  comments:             z.string().max(2000).optional().nullable(),
  last_contact:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // additional_info carries dynamic infoKey booleans as a plain object
  additional_info:      z.record(z.boolean()).optional().default({}),
});

// Fetch infoKeys declared for a project from role_matrix_dimensions.
async function getInfoKeys(projectId) {
  const res = await pool.query(
    `SELECT value FROM role_matrix_dimensions WHERE project_id=$1 AND type='info_key' ORDER BY value`,
    [projectId]
  );
  return res.rows.map(r => r.value);
}

// Pack flat infoKey booleans from the request body into an additional_info object.
function packAdditionalInfo(body, infoKeys) {
  const additional_info = { ...(body.additional_info || {}) };
  for (const k of infoKeys) {
    if (k in body) {
      additional_info[k] = !!body[k];
      delete body[k];
    }
  }
  return additional_info;
}

// Unpack additional_info back to flat fields on a returned row.
function unpackRow(row) {
  if (!row) return row;
  const { additional_info, ...rest } = row;
  const info = additional_info && typeof additional_info === 'object' ? additional_info : {};
  return { ...rest, ...info, additional_info: info };
}

router.get('/:projectId/users', authenticate, requireMember(), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM project_users WHERE project_id=$1 ORDER BY last_name, first_name',
      [req.params.projectId]
    );
    res.json(result.rows.map(unpackRow));
  } catch (err) {
    console.error('[GET users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:projectId/users', authenticate, requireMember(['owner', 'editor']), async (req, res) => {
  try {
    const infoKeys = await getInfoKeys(req.params.projectId);
    const body = { ...req.body };
    const additional_info = packAdditionalInfo(body, infoKeys);
    body.additional_info = additional_info;

    const parsed = fixedSchema.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const u = parsed.data;

    const result = await pool.query(
      `INSERT INTO project_users
         (project_id, sesa_id, first_name, last_name, mail, manager_mail,
          function, role, description, recommended_training, complementary_names,
          tlg_group, tlg_addon, status, comments, last_contact, additional_info)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        req.params.projectId,
        u.sesa_id, u.first_name, u.last_name, u.mail, u.manager_mail ?? null,
        u.function, u.role, u.description, u.recommended_training,
        u.complementary_names || [],
        u.tlg_group, u.tlg_addon || [],
        u.status || 'active', u.comments, u.last_contact || null,
        JSON.stringify(u.additional_info || {}),
      ]
    );
    res.status(201).json(unpackRow(result.rows[0]));
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
    const infoKeys = await getInfoKeys(req.params.projectId);
    await client.query('BEGIN');
    for (const rawUser of users) {
      const body = { ...rawUser };
      const additional_info = packAdditionalInfo(body, infoKeys);
      body.additional_info = additional_info;
      const parsed = fixedSchema.safeParse(body);
      if (!parsed.success) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Invalid user entry: ${parsed.error.errors[0].message}` });
      }
      const d = parsed.data;
      await client.query(
        `INSERT INTO project_users
           (project_id, sesa_id, first_name, last_name, mail, manager_mail,
            function, role, description, recommended_training, complementary_names,
            tlg_group, tlg_addon, status, comments, last_contact, additional_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (project_id, sesa_id) DO UPDATE SET
           first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
           mail=EXCLUDED.mail, manager_mail=EXCLUDED.manager_mail,
           function=EXCLUDED.function, role=EXCLUDED.role,
           description=EXCLUDED.description,
           recommended_training=EXCLUDED.recommended_training,
           complementary_names=EXCLUDED.complementary_names,
           tlg_group=EXCLUDED.tlg_group, tlg_addon=EXCLUDED.tlg_addon,
           status=EXCLUDED.status, comments=EXCLUDED.comments,
           last_contact=EXCLUDED.last_contact,
           additional_info=EXCLUDED.additional_info,
           updated_at=NOW()`,
        [
          req.params.projectId,
          d.sesa_id, d.first_name, d.last_name, d.mail, d.manager_mail ?? null,
          d.function, d.role, d.description, d.recommended_training,
          d.complementary_names || [],
          d.tlg_group, d.tlg_addon || [],
          d.status || 'active', d.comments, d.last_contact || null,
          JSON.stringify(d.additional_info || {}),
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
  try {
    const infoKeys = await getInfoKeys(req.params.projectId);
    const body = { ...req.body };
    const additional_info = packAdditionalInfo(body, infoKeys);
    body.additional_info = { ...(body.additional_info || {}), ...additional_info };

    const filtered = Object.fromEntries(
      Object.entries(body).filter(([k]) => FIXED_FIELDS.includes(k) || k === 'additional_info')
    );
    if (!Object.keys(filtered).length) return res.status(400).json({ error: 'No valid fields' });

    const parsed = fixedSchema.partial().safeParse(filtered);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const data = parsed.data;
    const keys = Object.keys(data);
    if (!keys.length) return res.status(400).json({ error: 'No valid fields after parsing' });

    const sets = keys.map((k, i) =>
      k === 'additional_info' ? `additional_info=$${i + 1}` : `${k}=$${i + 1}`
    ).join(', ');
    const vals = keys.map(k =>
      k === 'additional_info' ? JSON.stringify(data[k] || {}) : data[k]
    );

    const result = await pool.query(
      `UPDATE project_users SET ${sets}, updated_at=NOW()
       WHERE id=$${vals.length + 1} AND project_id=$${vals.length + 2}
       RETURNING *`,
      [...vals, req.params.userId, req.params.projectId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(unpackRow(result.rows[0]));
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
    await pool.query(
      'DELETE FROM project_users WHERE id=$1 AND project_id=$2',
      [req.params.userId, req.params.projectId]
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[DELETE users/:userId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
