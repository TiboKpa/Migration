const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

// ── Rate limiter ───────────────────────────────────────────────────────────────

const genLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes === 0) return '0h';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function formatDateWithSuffix(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr || '';
  const day = d.getUTCDate();
  const months = ['January','February','March','April','May','June','July',
    'August','September','October','November','December'];
  let suffix = 'th';
  const mod100 = day % 100;
  if (mod100 < 11 || mod100 > 13) {
    const mod10 = day % 10;
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }
  return `${day}${suffix} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function buildConcatenate(fn, role, additionalInfo, infoKeys) {
  const parts = infoKeys.sort().map(k => `${k}:${additionalInfo[k] ? 'Yes' : 'No'}`);
  return `${fn}||${role}||${parts.join('|')}`;
}

function partitionModules(modules, k) {
  const n = modules.length;
  if (n === 0) return Array.from({ length: k }, () => []);
  if (n <= k) {
    const waves = Array.from({ length: k }, () => []);
    modules.forEach((m, i) => waves[i].push(m));
    return waves;
  }
  const total = modules.reduce((s, m) => s + m.duration_min, 0);
  const target = total / k;
  const memo = new Map();
  function solve(idx, wavesLeft) {
    const key = `${idx}:${wavesLeft}`;
    if (memo.has(key)) return memo.get(key);
    if (wavesLeft === 1) {
      const slice = modules.slice(idx);
      const cost = (slice.reduce((s, m) => s + m.duration_min, 0) - target) ** 2;
      return [cost, [slice]];
    }
    let bestCost = Infinity, bestParts = null, current = 0;
    for (let i = idx; i <= n - wavesLeft; i++) {
      current += modules[i].duration_min;
      const [costRem, partsRem] = solve(i + 1, wavesLeft - 1);
      const t = (current - target) ** 2 + costRem;
      if (t < bestCost) { bestCost = t; bestParts = [modules.slice(idx, i + 1), ...partsRem]; }
    }
    memo.set(key, [bestCost, bestParts]);
    return [bestCost, bestParts];
  }
  return solve(0, k)[1];
}

function buildDynamicRoadmap(currentWave, totalWaves) {
  if (totalWaves < 1) return '';
  const dotW = totalWaves === 1 ? 100 : Math.floor((100 - (totalWaves - 1) * 10) / totalWaves);
  const cols = [], labels = [], statuses = [];
  for (let i = 1; i <= totalWaves; i++) {
    const dotColor = i === currentWave ? '#009E4D' : i < currentWave ? '#148A4C' : '#777777';
    cols.push(`<td width="${dotW}%" align="center" valign="middle"><p style="margin:0;font-size:22px;line-height:22px;color:${dotColor};">&#9679;</p></td>`);
    if (i < totalWaves) cols.push(`<td width="10%" align="center" valign="middle"><p style="margin:0;font-size:18px;line-height:18px;color:#c8c8c8;">&mdash;&mdash;&mdash;</p></td>`);
    labels.push(`<td align="center" style="padding-top:4px;"><p style="font-size:12px;font-weight:bold;color:#222222;text-transform:uppercase;">Part ${i}</p></td>`);
    if (i < totalWaves) labels.push('<td>&nbsp;</td>');
    const stTxt = i === currentWave ? 'Current mail' : i < currentWave ? 'Completed' : 'Upcoming';
    const stCol = i === currentWave ? '#009E4D' : i < currentWave ? '#148A4C' : '#777777';
    statuses.push(`<td align="center" style="padding-top:1px;"><p style="font-size:12px;font-weight:bold;color:${stCol};">${stTxt}</p></td>`);
    if (i < totalWaves) statuses.push('<td>&nbsp;</td>');
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
  <tr>${cols.join('')}</tr>
  <tr>${labels.join('')}</tr>
  <tr>${statuses.join('')}</tr>
</table>`;
}

function buildModuleHtml(m, prefix, color, bold) {
  const fw = bold ? 'font-weight:bold;' : '';
  const nameHtml = m.link
    ? `<a href="${m.link}" target="_blank" style="color:${color};text-decoration:underline;">${m.title}</a>`
    : m.title;
  return `<tr><td style="font-size:15px;line-height:24px;color:${color};${fw}">${prefix} ${nameHtml} (${formatDuration(m.duration_min)})</td></tr>\n`;
}

function buildComplementaryHtml(title, link) {
  const body = link
    ? `<a href="${link}" target="_blank" style="color:#009E4D;text-decoration:underline;">${title}</a>`
    : `<span style="color:#222222;">${title}</span>`;
  return `<p style="margin:4px 0;font-size:14px;color:#222222;"><span style="font-size:16px;font-weight:bold;color:#009E4D;">&#43;</span> <b>Additional training:</b> ${body}</p>\n`;
}

const ROADMAP_RE = /<table[^>]*?table-layout:fixed[^>]*?>.*?(?:Part|Wave)\s*1.*?<\/table>/is;

function renderTemplate(html, replacements) {
  return Object.entries(replacements).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), v ?? ''),
    html
  );
}

// ── Core generation ────────────────────────────────────────────────────────────
//
// Groups users by their resolved primary playlist (via role_matrix recommended_training_id).
// Each distinct playlist becomes one communication series (set of waves).
// role_filter: optional Set<string> of role names to include (for preview).
// parts_override: optional Map<playlistId, { total_parts, parts_to_generate }>
//   when null, defaults from the roleParts map are used (keyed by role for compat).
//
// roleParts: Map<role, { total_parts, parts_to_generate }> -- used when provided
//   to filter which roles to generate AND set wave counts.

async function runGeneration(projectId, roleParts, appName, plantName, goLive, templateHtml) {
  const goLiveFormatted = formatDateWithSuffix(goLive);

  // info keys for this project (define which additional_info fields matter)
  const infoKeys = (await pool.query(
    `SELECT value FROM role_matrix_dimensions WHERE project_id=$1 AND type='info_key' ORDER BY value`,
    [projectId]
  )).rows.map(r => r.value);

  // load full role matrix
  const matrixRows = (await pool.query(
    'SELECT * FROM role_matrix WHERE project_id=$1',
    [projectId]
  )).rows;
  const matrixByConcatenate = new Map(matrixRows.map(r => [r.concatenate, r]));

  // load playlists and their modules
  const playlists = (await pool.query(
    'SELECT * FROM playlists WHERE project_id=$1', [projectId]
  )).rows;
  const playlistById = new Map(playlists.map(p => [p.id, p]));

  const playlistItems = playlists.length === 0 ? [] : (await pool.query(
    `SELECT pi.*,
            tc.title AS curriculum_title, tc.link AS curriculum_link,
            tm.title AS module_title,    tm.link AS module_link, tm.duration_min
     FROM playlist_items pi
     LEFT JOIN training_curricula tc ON tc.id = pi.curriculum_id
     LEFT JOIN training_modules   tm ON tm.id = pi.module_id
     WHERE pi.playlist_id = ANY($1::int[])
     ORDER BY pi.playlist_id, pi.sequence_order`,
    [playlists.map(p => p.id)]
  )).rows;

  const curriculumIds = [...new Set(
    playlistItems.filter(i => i.curriculum_id).map(i => i.curriculum_id)
  )];
  const curModules = curriculumIds.length === 0 ? [] : (await pool.query(
    `SELECT cmi.curriculum_id, tm.title, tm.link, tm.duration_min, cmi.sequence_order
     FROM curriculum_module_items cmi
     JOIN training_modules tm ON tm.id = cmi.module_id
     WHERE cmi.curriculum_id = ANY($1::int[])
     ORDER BY cmi.curriculum_id, cmi.sequence_order`,
    [curriculumIds]
  )).rows;

  // build resolved module list per playlist id
  const modulesByPlaylistId = new Map();
  for (const pl of playlists) {
    const items = playlistItems.filter(i => i.playlist_id === pl.id);
    const modules = [];
    for (const item of items) {
      if (item.curriculum_id) {
        modules.push(...curModules
          .filter(m => m.curriculum_id === item.curriculum_id)
          .map(m => ({ title: m.title, link: m.link || '', duration_min: m.duration_min || 0 })));
      } else if (item.module_id) {
        modules.push({ title: item.module_title, link: item.module_link || '', duration_min: item.duration_min || 0 });
      }
    }
    modulesByPlaylistId.set(pl.id, modules);
  }

  // load users
  const allUsers = (await pool.query(
    'SELECT * FROM project_users WHERE project_id=$1', [projectId]
  )).rows;

  const champions = [];
  const warnings  = [];

  // playlistGroup: Map<playlistId, {
  //   playlist, roles: Set<string>, emails: string[], managers: string[],
  //   complementaryIds: Set<number>, total_parts, parts_to_generate
  // }>
  const playlistGroups = new Map();

  for (const u of allUsers) {
    const info = parseJson(u.additional_info, {});

    // champions are collected separately
    if (info.champion === true) {
      const name  = [u.first_name, u.last_name].filter(Boolean).join(' ');
      const email = u.mail || '';
      champions.push(email ? `<a href="mailto:${email}">${name}</a>` : name);
      continue;
    }

    const role = (u.role || '').split('+')[0].trim();
    const fn   = (u.function || '').trim();
    if (!role || !u.mail) continue;

    // filter by roleParts if provided
    if (roleParts && !roleParts.has(role)) continue;

    // build filteredInfo using project infoKeys only
    const filteredInfo = {};
    for (const k of infoKeys) filteredInfo[k] = !!info[k];

    const concatenate = buildConcatenate(fn, role, filteredInfo, infoKeys);
    const matrixRow   = matrixByConcatenate.get(concatenate);

    if (!matrixRow) {
      warnings.push(`No role matrix row found for function="${fn}" role="${role}" (key: ${concatenate})`);
      continue;
    }
    if (matrixRow.na_training) continue; // user explicitly marked as no training needed

    const playlistId = matrixRow.recommended_training_id;
    if (!playlistId) {
      warnings.push(`No primary training assigned in role matrix for function="${fn}" role="${role}"`);
      continue;
    }
    if (!playlistById.has(playlistId)) {
      warnings.push(`Primary training playlist id=${playlistId} not found for role="${role}"`);
      continue;
    }

    // determine wave config: from roleParts (keyed by role) or default 4 parts
    const { total_parts, parts_to_generate } = roleParts
      ? roleParts.get(role)
      : { total_parts: 4, parts_to_generate: [1, 2, 3, 4] };

    // merge user into the playlist group
    if (!playlistGroups.has(playlistId)) {
      playlistGroups.set(playlistId, {
        playlist:         playlistById.get(playlistId),
        roles:            new Set(),
        emails:           [],
        managers:         [],
        complementaryIds: new Set(),
        total_parts,
        parts_to_generate,
      });
    }
    const group = playlistGroups.get(playlistId);
    group.roles.add(role);
    group.emails.push(u.mail);
    if (u.manager_mail) group.managers.push(u.manager_mail);

    // collect complementary playlist ids from the matrix row
    const compItems = parseJson(matrixRow.complementary_items, []);
    for (const item of compItems) {
      const cid = typeof item === 'object' ? (item.playlist_id || item.id) : item;
      if (cid && playlistById.has(cid)) group.complementaryIds.add(cid);
    }
  }

  const championsStr = champions.length
    ? champions.join(', ')
    : 'No champion assigned for this plant.';

  const results = [];

  for (const [playlistId, group] of playlistGroups) {
    const modules = modulesByPlaylistId.get(playlistId) || [];
    if (modules.length === 0) {
      warnings.push(`Playlist "${group.playlist.title}" has no modules`);
      continue;
    }

    const { total_parts, parts_to_generate } = group;
    const rolesLabel = [...group.roles].sort().join(', ');

    // build complementary html
    const complementaryHtml = [...group.complementaryIds]
      .map(cid => {
        const pl = playlistById.get(cid);
        return buildComplementaryHtml(pl.title, pl.link || '');
      })
      .join('');

    const waves = partitionModules(modules, total_parts);

    for (let wi = 0; wi < waves.length; wi++) {
      const waveNum    = wi + 1;
      if (!parts_to_generate.includes(waveNum)) continue;

      const waveModules = waves[wi];
      const pastModules = waves.slice(0, wi).flat();
      const waveMin     = waveModules.reduce((s, m) => s + m.duration_min, 0);
      const totalMin    = modules.reduce((s, m) => s + m.duration_min, 0);
      const pastHtml    = pastModules.map(m => buildModuleHtml(m, '&#8226;', '#a0a0a0', false)).join('');
      const newHtml     = waveModules.map(m => buildModuleHtml(m, '&#x1F195;', '#222222', true)).join('')
        || '<tr><td style="font-size:15px;line-height:24px;color:#a0a0a0;font-style:italic;">Training modules overview</td></tr>';

      const roadmap = buildDynamicRoadmap(waveNum, total_parts);
      let body = ROADMAP_RE.test(templateHtml)
        ? templateHtml.replace(ROADMAP_RE, roadmap)
        : templateHtml;

      if (complementaryHtml) {
        const btnRe = /(Click to open the full e-learning playlist<\/a>\s*<\/td>\s*<\/tr>\s*<\/table>\s*<\/td>\s*<\/tr>)/is;
        const container = `<tr><td style="padding:15px 36px 0 36px;"><div style="border-left:4px solid #009E4D;padding:5px 0 5px 15px;">${complementaryHtml}</div></td></tr>`;
        if (btnRe.test(body)) body = body.replace(btnRe, `$1${container}`);
      }

      body = renderTemplate(body, {
        PLANT_NAME:        plantName,
        APP_NAME:          appName,
        GO_LIVE_DATE:      goLiveFormatted,
        USER_ROLE:         rolesLabel,
        TOTAL_HOURS:       formatDuration(totalMin),
        WAVE_HOURS:        formatDuration(waveMin),
        WAVE_NUMBER:       String(waveNum),
        PAST_MODULES_LIST: pastHtml,
        NEW_MODULES_LIST:  newHtml,
        MAIN_PLAYLIST_LINK: group.playlist.link || '#',
        SUPPORT_CHAMPIONS: championsStr,
        W1_DOT_COLOR: '', W2_DOT_COLOR: '', W3_DOT_COLOR: '', W4_DOT_COLOR: '',
        W1_TEXT_COLOR: '', W2_TEXT_COLOR: '', W3_TEXT_COLOR: '', W4_TEXT_COLOR: '',
        W1_TEXT: '', W2_TEXT: '', W3_TEXT: '', W4_TEXT: '',
      });

      results.push({
        playlist_id:   playlistId,
        playlist_name: group.playlist.title,
        roles:         [...group.roles].sort(),
        wave:          waveNum,
        total_parts,
        subject:       `Action Required: ${appName} Training - Part ${waveNum}/${total_parts} - ${group.playlist.title}`,
        to:            [...new Set(group.emails)],
        cc:            [...new Set(group.managers)],
        html:          body,
        total_hours:   formatDuration(totalMin),
        wave_hours:    formatDuration(waveMin),
        module_count:  waveModules.length,
      });
    }
  }

  return { results, warnings, championsStr };
}

// ── GET /roles ─────────────────────────────────────────────────────────────────

router.get('/:projectId/generate/roles', authenticate, requireMember(), genLimiter, async (req, res) => {
  try {
    const rows = await pool.query(
      `SELECT role, COUNT(*) AS user_count
       FROM project_users
       WHERE project_id=$1 AND role IS NOT NULL AND role <> ''
       GROUP BY role ORDER BY role`,
      [req.params.projectId]
    );
    res.json(rows.rows);
  } catch (err) {
    console.error('[GET generate/roles]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /bulk ─────────────────────────────────────────────────────────────────
// Body: { campaign_id, template_id, role_configs }

const bulkSchema = z.object({
  campaign_id:  z.number().int().positive(),
  template_id:  z.number().int().positive(),
  role_configs: z.array(z.object({
    role:              z.string().min(1),
    total_parts:       z.number().int().min(1).max(6),
    parts_to_generate: z.array(z.number().int().min(1).max(6)).min(1),
  })).min(1),
});

router.post('/:projectId/generate/bulk', authenticate, requireMember(), genLimiter, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { campaign_id, template_id, role_configs } = parsed.data;

  try {
    const project = (await pool.query(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE p.id=$1 AND pm.user_id=$2`,
      [req.params.projectId, req.user.id]
    )).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const campaign = (await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND project_id=$2',
      [campaign_id, req.params.projectId]
    )).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const template = (await pool.query(
      'SELECT * FROM templates WHERE id=$1 AND project_id=$2',
      [template_id, req.params.projectId]
    )).rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const roleParts = new Map(role_configs.map(rc => [
      rc.role, { total_parts: rc.total_parts, parts_to_generate: rc.parts_to_generate },
    ]));

    const { results, warnings, championsStr } = await runGeneration(
      req.params.projectId, roleParts,
      project.application_name || '',
      project.plant_name       || '',
      project.go_live_date     || '',
      template.html_content
    );

    for (const r of results) {
      await pool.query(
        `INSERT INTO campaign_communications
           (campaign_id, role, wave, total_parts, subject, to_list, cc_list, html_body)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [campaign_id,
         r.playlist_name,   // store playlist name as the label
         r.wave, r.total_parts, r.subject,
         JSON.stringify(r.to), JSON.stringify(r.cc), r.html]
      );
    }

    const userCount = (await pool.query(
      'SELECT COUNT(DISTINCT mail) AS n FROM project_users WHERE project_id=$1 AND mail IS NOT NULL',
      [req.params.projectId]
    )).rows[0].n;

    const maxParts = role_configs.reduce((m, rc) => Math.max(m, rc.total_parts), 0);

    await pool.query(
      'UPDATE campaigns SET user_count=$1, part_count=$2 WHERE id=$3',
      [parseInt(userCount, 10), maxParts, campaign_id]
    );

    res.json({ results, warnings, champions: championsStr });
  } catch (err) {
    console.error('[POST generate/bulk]', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /preview ──────────────────────────────────────────────────────────────
// Body: { role, total_parts, parts_to_generate, template_id }

const previewSchema = z.object({
  role:              z.string().min(1),
  total_parts:       z.number().int().min(1).max(6),
  parts_to_generate: z.array(z.number().int().min(1).max(6)).min(1),
  template_id:       z.number().int().positive(),
});

router.post('/:projectId/generate/preview', authenticate, requireMember(), genLimiter, async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { role, total_parts, parts_to_generate, template_id } = parsed.data;

  try {
    const project = (await pool.query(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE p.id=$1 AND pm.user_id=$2`,
      [req.params.projectId, req.user.id]
    )).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const template = (await pool.query(
      'SELECT * FROM templates WHERE id=$1 AND project_id=$2',
      [template_id, req.params.projectId]
    )).rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const roleParts = new Map([[role, { total_parts, parts_to_generate }]]);

    const { results, warnings } = await runGeneration(
      req.params.projectId, roleParts,
      project.application_name || '',
      project.plant_name       || '',
      project.go_live_date     || '',
      template.html_content
    );

    res.json({ results, warnings });
  } catch (err) {
    console.error('[POST generate/preview]', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
