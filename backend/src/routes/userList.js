const express = require('express');
const { z } = require('zod');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

// emailOrNull: accepts a valid email, empty string, null or undefined -- all stored as null.
const emailOrNull = z
  .union([z.string().email().max(254), z.literal(''), z.null(), z.undefined()])
  .transform(v => (v === '' || v == null) ? null : v)
  .optional()
  .nullable();

// Single source of truth for the project_users schema.
// ALLOWED_FIELDS is derived from this object so PUT filtering stays in sync automatically.
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
  additional_info:      z.record(z.boolean()).optional().default({}),
});

// Derive allowed column names directly from the schema -- no duplicate list to maintain.
const ALLOWED_FIELDS = new Set(Object.keys(fixedSchema.shape));

// Columns stored as jsonb -- must be serialized before passing to pg.
const JSON_FIELDS = new Set(['additional_info', 'complementary_names', 'tlg_addon']);

async function getInfoKeys(projectId) {
  const res = await pool.query(
    `SELECT value FROM role_matrix_dimensions WHERE project_id=$1 AND type='info_key' ORDER BY value`,
    [projectId]
  );
  return res.rows.map(r => r.value);
}

// Extracts infoKey booleans from a body copy into additional_info without mutating the original.
function packAdditionalInfo(body, infoKeys) {
  const additional_info = { ...(body.additional_info || {}) };
  for (const k of infoKeys) {
    if (k in body) additional_info[k] = !!body[k];
  }
  return additional_info;
}

// Spreads additional_info back to top-level fields on rows returned to the frontend.
function unpackRow(row) {
  if (!row) return row;
  const { additional_info, ...rest } = row;
  const info = (additional_info && typeof additional_info === 'object') ? additional_info : {};
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
    body.additional_info = packAdditionalInfo(body, infoKeys);
    // Remove infoKey flat fields so they do not confuse the schema
    for (const k of infoKeys) delete body[k];

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
        u.sesa_id, u.first_name, u.last_name,
        u.mail ?? null, u.manager_mail ?? null,
        u.function, u.role, u.description, u.recommended_training,
        JSON.stringify(u.complementary_names ?? []),
        u.tlg_group, JSON.stringify(u.tlg_addon ?? []),
        u.status ?? 'active', u.comments, u.last_contact ?? null,
        JSON.stringify(u.additional_info ?? {}),
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
  if (!Array.isArray(users) || users.length === 0)
    return res.status(400).json({ error: 'No users provided' });
  if (users.length > 5000)
    return res.status(400).json({ error: 'Maximum 5000 users per import' });

  const client = await pool.connect();
  try {
    const infoKeys = await getInfoKeys(req.params.projectId);
    await client.query('BEGIN');
    for (const rawUser of users) {
      const body = { ...rawUser };
      body.additional_info = packAdditionalInfo(body, infoKeys);
      for (const k of infoKeys) delete body[k];

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
          d.sesa_id, d.first_name, d.last_name,
          d.mail ?? null, d.manager_mail ?? null,
          d.function, d.role, d.description, d.recommended_training,
          JSON.stringify(d.complementary_names ?? []),
          d.tlg_group, JSON.stringify(d.tlg_addon ?? []),
          d.status ?? 'active', d.comments, d.last_contact ?? null,
          JSON.stringify(d.additional_info ?? {}),
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
    body.additional_info = packAdditionalInfo(body, infoKeys);
    for (const k of infoKeys) delete body[k];

    // Keep only fields that exist in the schema -- derived automatically, no hardcoded list.
    const filtered = Object.fromEntries(
      Object.entries(body).filter(([k]) => ALLOWED_FIELDS.has(k))
    );
    if (!Object.keys(filtered).length) return res.status(400).json({ error: 'No valid fields' });

    const parsed = fixedSchema.partial().safeParse(filtered);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const data = parsed.data;
    const keys = Object.keys(data);
    if (!keys.length) return res.status(400).json({ error: 'No valid fields after parsing' });

    const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    // Serialize jsonb fields (arrays and objects) -- pg cannot infer the type from a raw JS value.
    const vals = keys.map(k =>
      JSON_FIELDS.has(k) ? JSON.stringify(data[k] ?? (Array.isArray(data[k]) ? [] : {})) : data[k]
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
