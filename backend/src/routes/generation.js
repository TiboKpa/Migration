const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const requireMember = require('../middleware/requireMember');
const router = express.Router();

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

function buildConcatenate(fn, role, filteredInfo, infoKeys) {
  const parts = infoKeys.slice().sort().map(k => `${k}:${filteredInfo[k] ? 'Yes' : 'No'}`);
  return `${fn}||${role}||${parts.join('|')}`;
}

function buildGroupKey(primaryId, complementaryIds) {
  return `${primaryId}|${[...complementaryIds].sort((a, b) => a - b).join(',')}`;
}

function partitionUnits(units, k) {
  const n = units.length;
  if (n === 0) return Array.from({ length: k }, () => []);
  if (n <= k) {
    const waves = Array.from({ length: k }, () => []);
    units.forEach((u, i) => waves[i].push(u));
    return waves;
  }
  const total  = units.reduce((s, u) => s + u.duration_min, 0);
  const target = total / k;
  const memo   = new Map();
  function solve(idx, wavesLeft) {
    const key = `${idx}:${wavesLeft}`;
    if (memo.has(key)) return memo.get(key);
    if (wavesLeft === 1) {
      const slice = units.slice(idx);
      return [(slice.reduce((s, u) => s + u.duration_min, 0) - target) ** 2, [slice]];
    }
    let bestCost = Infinity, bestParts = null, current = 0;
    for (let i = idx; i <= n - wavesLeft; i++) {
      current += units[i].duration_min;
      const [cr, pr] = solve(i + 1, wavesLeft - 1);
      const t = (current - target) ** 2 + cr;
      if (t < bestCost) { bestCost = t; bestParts = [units.slice(idx, i + 1), ...pr]; }
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

// unit: { title, link, duration_min, isCurriculum }
// For curricula shown in past list: expand child modules inline (greyed out)
// For new modules list: show curriculum as single bold entry
function buildUnitHtml(unit, prefix, color, bold) {
  const fw = bold ? 'font-weight:bold;' : '';
  const nameHtml = unit.link
    ? `<a href="${unit.link}" target="_blank" style="color:${color};text-decoration:underline;">${unit.title}</a>`
    : unit.title;
  return `<tr><td style="font-size:15px;line-height:24px;color:${color};${fw}">${prefix} ${nameHtml} (${formatDuration(unit.duration_min)})</td></tr>\n`;
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

// ── buildUnitsForPlaylist ──────────────────────────────────────────────────────
// Returns an array of units for a given playlist.
// Each curriculum item becomes ONE unit (aggregate duration).
// Each standalone module item stays as ONE unit.
async function buildUnitsForPlaylist(playlistId, playlistItems, curModulesByIds) {
  const items = playlistItems.filter(i => i.playlist_id === playlistId);
  const units = [];
  for (const item of items) {
    if (item.curriculum_id) {
      const children = curModulesByIds.get(item.curriculum_id) || [];
      const totalMin = children.reduce((s, m) => s + (m.duration_min || 0), 0);
      // Use the curriculum title stored on the playlist_item row (item.curriculum_title),
      // falling back to a generic label.
      units.push({
        title:        item.curriculum_title || `Curriculum #${item.curriculum_id}`,
        link:         item.curriculum_link  || '',
        duration_min: totalMin,
        isCurriculum: true,
        curriculum_id: item.curriculum_id,
        // Keep child modules for possible inline expansion later
        children,
      });
    } else if (item.module_id) {
      units.push({
        title:        item.module_title,
        link:         item.module_link || '',
        duration_min: item.duration_min || 0,
        isCurriculum: false,
      });
    }
  }
  return units;
}

// ── resolveGroups ──────────────────────────────────────────────────────────────
// Returns Map<groupKey, { groupKey, primaryPlaylist, complementaryItems,
//   roles: Set, emails: Set }>
// complementaryItems: array of { title, link } resolved directly from the
// role_matrix complementary_items JSON (no playlist-table lookup required).
async function resolveGroups(projectId) {
  const infoKeys = (await pool.query(
    `SELECT value FROM role_matrix_dimensions WHERE project_id=$1 AND type='info_key' ORDER BY value`,
    [projectId]
  )).rows.map(r => r.value);

  const matrixByConcatenate = new Map(
    (await pool.query('SELECT * FROM role_matrix WHERE project_id=$1', [projectId]))
      .rows.map(r => [r.concatenate, r])
  );

  const playlists    = (await pool.query('SELECT * FROM playlists WHERE project_id=$1', [projectId])).rows;
  const playlistById = new Map(playlists.map(p => [p.id, p]));

  const allUsers = (await pool.query('SELECT * FROM project_users WHERE project_id=$1', [projectId])).rows;

  const groups   = new Map();
  const warnings = [];

  for (const u of allUsers) {
    const info = parseJson(u.additional_info, {});
    if (info.champion === true) continue;

    const role = (u.role || '').split('+')[0].trim();
    const fn   = (u.function || '').trim();
    if (!role || !u.mail) continue;

    const filteredInfo = {};
    for (const k of infoKeys) filteredInfo[k] = !!info[k];

    const concatenate = buildConcatenate(fn, role, filteredInfo, infoKeys);
    const matrixRow   = matrixByConcatenate.get(concatenate);

    if (!matrixRow) { warnings.push(`No matrix row: fn="${fn}" role="${role}"`); continue; }
    if (matrixRow.na_training) continue;

    const primaryId = matrixRow.recommended_training_id;
    if (!primaryId || !playlistById.has(primaryId)) {
      warnings.push(`No primary training for fn="${fn}" role="${role}"`);
      continue;
    }

    // Resolve complementary items directly from the stored JSON.
    // Each item may be: { title, link } | { playlist_id, title, link } | number (legacy).
    // We do NOT require the item to exist in playlistById - the title/link are used as-is.
    const compRaw = parseJson(matrixRow.complementary_items, []);
    const complementaryItems = compRaw
      .map(item => {
        if (typeof item === 'object' && item !== null) {
          return {
            title: item.title || '',
            link:  item.link  || '',
            // keep playlist_id if present for group-key deduplication
            playlist_id: item.playlist_id || item.id || null,
          };
        }
        // Legacy: bare numeric id - try to resolve from playlistById
        if (typeof item === 'number' && playlistById.has(item)) {
          const pl = playlistById.get(item);
          return { title: pl.title, link: pl.link || '', playlist_id: pl.id };
        }
        return null;
      })
      .filter(item => item !== null && item.title);

    // Build a stable group key using playlist_ids where available, else title hash
    const compKeys = complementaryItems
      .map(item => item.playlist_id != null ? `p${item.playlist_id}` : `t${item.title}`)
      .sort()
      .join(',');
    const groupKey = `${primaryId}|${compKeys}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        primaryPlaylist:   playlistById.get(primaryId),
        complementaryItems,
        roles:  new Set(),
        emails: new Set(),
      });
    }
    const g = groups.get(groupKey);
    g.roles.add(role);
    g.emails.add(u.mail);
  }

  return { groups, warnings };
}

// ── Core generation ────────────────────────────────────────────────────────────
async function runGeneration(projectId, groupConfigs, appName, plantName, goLive, templateHtml) {
  const goLiveFormatted = formatDateWithSuffix(goLive);

  const playlists    = (await pool.query('SELECT * FROM playlists WHERE project_id=$1', [projectId])).rows;
  const playlistById = new Map(playlists.map(p => [p.id, p]));

  // Fetch playlist_items, also pulling curriculum title/link from the curricula table
  const playlistItems = playlists.length === 0 ? [] : (await pool.query(
    `SELECT pi.*,
            tc.title   AS curriculum_title, tc.link AS curriculum_link,
            tm.title   AS module_title,     tm.link AS module_link, tm.duration_min
     FROM playlist_items pi
     LEFT JOIN training_curricula tc ON tc.id = pi.curriculum_id
     LEFT JOIN training_modules   tm ON tm.id = pi.module_id
     WHERE pi.playlist_id = ANY($1::int[])
     ORDER BY pi.playlist_id, pi.sequence_order`,
    [playlists.map(p => p.id)]
  )).rows;

  const curriculumIds = [...new Set(playlistItems.filter(i => i.curriculum_id).map(i => i.curriculum_id))];
  const curModulesFlat = curriculumIds.length === 0 ? [] : (await pool.query(
    `SELECT cmi.curriculum_id, tm.title, tm.link, tm.duration_min
     FROM curriculum_module_items cmi
     JOIN training_modules tm ON tm.id = cmi.module_id
     WHERE cmi.curriculum_id = ANY($1::int[])
     ORDER BY cmi.curriculum_id, cmi.sequence_order`,
    [curriculumIds]
  )).rows;

  // Map curriculum_id -> child modules
  const curModulesByIds = new Map();
  for (const m of curModulesFlat) {
    if (!curModulesByIds.has(m.curriculum_id)) curModulesByIds.set(m.curriculum_id, []);
    curModulesByIds.get(m.curriculum_id).push(m);
  }

  // Build units per playlist (curricula = single unit, modules = single unit)
  const unitsByPlaylistId = new Map();
  for (const pl of playlists) {
    unitsByPlaylistId.set(pl.id, await buildUnitsForPlaylist(pl.id, playlistItems, curModulesByIds));
  }

  const { groups, warnings } = await resolveGroups(projectId);

  // Champions
  const champRows = (await pool.query(
    `SELECT first_name, last_name, mail, additional_info FROM project_users WHERE project_id=$1`,
    [projectId]
  )).rows.filter(u => parseJson(u.additional_info, {}).champion === true);
  const championsStr = champRows.length
    ? champRows.map(u => {
        const name  = [u.first_name, u.last_name].filter(Boolean).join(' ');
        return u.mail ? `<a href="mailto:${u.mail}">${name}</a>` : name;
      }).join(', ')
    : 'No champion assigned for this plant.';

  const results = [];

  for (const [groupKey, group] of groups) {
    if (groupConfigs && !groupConfigs.has(groupKey)) continue;

    const { total_parts, parts_to_generate } = groupConfigs
      ? groupConfigs.get(groupKey)
      : { total_parts: 4, parts_to_generate: [1, 2, 3, 4] };

    const units = unitsByPlaylistId.get(group.primaryPlaylist.id) || [];
    if (units.length === 0) {
      warnings.push(`Playlist "${group.primaryPlaylist.title}" has no modules`);
      continue;
    }

    const rolesLabel        = [...group.roles].sort().join(', ');
    const complementaryHtml = group.complementaryItems
      .map(item => buildComplementaryHtml(item.title, item.link))
      .join('');

    const waves    = partitionUnits(units, total_parts);
    const totalMin = units.reduce((s, u) => s + u.duration_min, 0);

    for (let wi = 0; wi < waves.length; wi++) {
      const waveNum   = wi + 1;
      if (!parts_to_generate.includes(waveNum)) continue;

      const waveUnits = waves[wi];
      const pastUnits = waves.slice(0, wi).flat();
      const waveMin   = waveUnits.reduce((s, u) => s + u.duration_min, 0);
      const pastHtml  = pastUnits.map(u => buildUnitHtml(u, '&#8226;', '#a0a0a0', false)).join('');
      const newHtml   = waveUnits.map(u => buildUnitHtml(u, '&#x1F195;', '#222222', true)).join('')
        || '<tr><td style="font-size:15px;line-height:24px;color:#a0a0a0;font-style:italic;">Training modules overview</td></tr>';

      const roadmap = buildDynamicRoadmap(waveNum, total_parts);
      let body = ROADMAP_RE.test(templateHtml)
        ? templateHtml.replace(ROADMAP_RE, roadmap)
        : templateHtml;

      if (complementaryHtml) {
        const btnRe     = /(Click to open the full e-learning playlist<\/a>\s*<\/td>\s*<\/tr>\s*<\/table>\s*<\/td>\s*<\/tr>)/is;
        const container = `<tr><td style="padding:15px 36px 0 36px;"><div style="border-left:4px solid #009E4D;padding:5px 0 5px 15px;">${complementaryHtml}</div></td></tr>`;
        if (btnRe.test(body)) body = body.replace(btnRe, `$1${container}`);
      }

      body = renderTemplate(body, {
        PLANT_NAME:         plantName,
        APP_NAME:           appName,
        GO_LIVE_DATE:       goLiveFormatted,
        USER_ROLE:          rolesLabel,
        TOTAL_HOURS:        formatDuration(totalMin),
        WAVE_HOURS:         formatDuration(waveMin),
        WAVE_NUMBER:        String(waveNum),
        PAST_MODULES_LIST:  pastHtml,
        NEW_MODULES_LIST:   newHtml,
        MAIN_PLAYLIST_LINK: group.primaryPlaylist.link || '#',
        SUPPORT_CHAMPIONS:  championsStr,
        W1_DOT_COLOR: '', W2_DOT_COLOR: '', W3_DOT_COLOR: '', W4_DOT_COLOR: '',
        W1_TEXT_COLOR: '', W2_TEXT_COLOR: '', W3_TEXT_COLOR: '', W4_TEXT_COLOR: '',
        W1_TEXT: '', W2_TEXT: '', W3_TEXT: '', W4_TEXT: '',
      });

      results.push({
        group_key:     groupKey,
        playlist_id:   group.primaryPlaylist.id,
        playlist_name: group.primaryPlaylist.title,
        complementary: group.complementaryItems.map(item => ({ title: item.title, link: item.link })),
        roles:         [...group.roles].sort(),
        wave:          waveNum,
        total_parts,
        subject:       `Action Required: ${appName} Training - Part ${waveNum}/${total_parts} - ${group.primaryPlaylist.title}`,
        to:            [...group.emails],
        cc:            [...new Set(
          (await pool.query('SELECT manager_mail FROM project_users WHERE project_id=$1 AND mail = ANY($2::text[])',
            [projectId, [...group.emails]])).rows.map(r => r.manager_mail).filter(Boolean)
        )],
        html:          body,
        total_hours:   formatDuration(totalMin),
        wave_hours:    formatDuration(waveMin),
        unit_count:    waveUnits.length,
      });
    }
  }

  return { results, warnings, championsStr };
}

// ── GET /groups ────────────────────────────────────────────────────────────────

router.get('/:projectId/generate/groups', authenticate, requireMember(), genLimiter, async (req, res) => {
  try {
    const { groups, warnings } = await resolveGroups(req.params.projectId);
    const payload = [...groups.values()].map(g => ({
      group_key:              g.groupKey,
      primary_playlist_id:    g.primaryPlaylist.id,
      primary_playlist_name:  g.primaryPlaylist.title,
      complementary_playlists: g.complementaryItems.map(item => ({
        title: item.title,
        link:  item.link,
      })),
      roles:      [...g.roles].sort(),
      user_count: g.emails.size,
    }));
    res.json({ groups: payload, warnings });
  } catch (err) {
    console.error('[GET generate/groups]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /bulk ─────────────────────────────────────────────────────────────────

const bulkSchema = z.object({
  campaign_id:   z.number().int().positive(),
  template_id:   z.number().int().positive(),
  group_configs: z.array(z.object({
    group_key:         z.string().min(1),
    total_parts:       z.number().int().min(1).max(6),
    parts_to_generate: z.array(z.number().int().min(1).max(6)).min(1),
  })).min(1),
});

router.post('/:projectId/generate/bulk', authenticate, requireMember(), genLimiter, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { campaign_id, template_id, group_configs } = parsed.data;

  try {
    const project = (await pool.query(
      `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE p.id=$1 AND pm.user_id=$2`,
      [req.params.projectId, req.user.id]
    )).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const campaign = (await pool.query(
      'SELECT * FROM campaigns WHERE id=$1 AND project_id=$2', [campaign_id, req.params.projectId]
    )).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const template = (await pool.query(
      'SELECT * FROM templates WHERE id=$1 AND project_id=$2', [template_id, req.params.projectId]
    )).rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const groupConfigsMap = new Map(group_configs.map(gc => [
      gc.group_key, { total_parts: gc.total_parts, parts_to_generate: gc.parts_to_generate },
    ]));

    const { results, warnings, championsStr } = await runGeneration(
      req.params.projectId, groupConfigsMap,
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
        [campaign_id, r.playlist_name, r.wave, r.total_parts, r.subject,
         JSON.stringify(r.to), JSON.stringify(r.cc), r.html]
      );
    }

    const userCount = (await pool.query(
      'SELECT COUNT(DISTINCT mail) AS n FROM project_users WHERE project_id=$1 AND mail IS NOT NULL',
      [req.params.projectId]
    )).rows[0].n;

    const maxParts = group_configs.reduce((m, gc) => Math.max(m, gc.total_parts), 0);
    await pool.query('UPDATE campaigns SET user_count=$1, part_count=$2 WHERE id=$3',
      [parseInt(userCount, 10), maxParts, campaign_id]);

    res.json({ results, warnings, champions: championsStr });
  } catch (err) {
    console.error('[POST generate/bulk]', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ── POST /preview ──────────────────────────────────────────────────────────────

const previewSchema = z.object({
  group_key:         z.string().min(1),
  total_parts:       z.number().int().min(1).max(6),
  parts_to_generate: z.array(z.number().int().min(1).max(6)).min(1),
  template_id:       z.number().int().positive(),
});

router.post('/:projectId/generate/preview', authenticate, requireMember(), genLimiter, async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
  const { group_key, total_parts, parts_to_generate, template_id } = parsed.data;

  try {
    const project = (await pool.query(
      `SELECT p.* FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE p.id=$1 AND pm.user_id=$2`,
      [req.params.projectId, req.user.id]
    )).rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const template = (await pool.query(
      'SELECT * FROM templates WHERE id=$1 AND project_id=$2', [template_id, req.params.projectId]
    )).rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const groupConfigsMap = new Map([[group_key, { total_parts, parts_to_generate }]]);

    const { results, warnings } = await runGeneration(
      req.params.projectId, groupConfigsMap,
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
