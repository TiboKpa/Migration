/**
 * parseTrainingPathFlat
 *
 * Sheet layout (0-indexed rows):
 *   Row 1  : playlist titles from col L (index 11) onward
 *   Row 2  : descriptions
 *   Row 3  : links
 *   Row 11+: data rows
 *
 * Data row columns (0-indexed):
 *   A(0)  : group label
 *   B(1)  : row number
 *   C(2)  : chapter/curriculum order  -- 0 means this row IS a curriculum header
 *   D(3)  : brick/module order        -- 0 means this row IS a curriculum header
 *   E(4)  : title
 *   F(5)  : family
 *   G(6)  : mandatory duration (HH:MM or HH:MM:SS)
 *   H(7)  : optional duration
 *   I(8)  : total duration
 *   J(9)  : content ID
 *   K(10) : content type
 *   L(11)+: one column per playlist
 *            number  -> position of this row in that Primary Training
 *            "X"/"x" -> row is linked as a Complementary Training reference
 *            empty   -> not in that training
 *
 * Rules:
 *   - A row is a CURRICULUM when C==0 AND D==0.
 *   - A row is a MODULE otherwise (C != 0 OR D != 0).
 *   - MODULE requirement inside a curriculum:
 *       mandatory if col G has a non-zero duration, optional if col H has it.
 *   - Global module duration comes from col I (total).
 *   - Modules are deduplicated by title (first occurrence wins for metadata).
 *   - Primary Training   = playlist column where row 3 (link) is non-empty.
 *   - Complementary Training = playlist column where row 3 is empty.
 *   - In a Primary Training the numeric value in a data column = sequence_order.
 *   - In a Complementary Training an "X" cell means: add the link of that
 *     module/curriculum as a complementary reference.
 */

import * as XLSX from 'xlsx';

function hhmmssToMinutes(val) {
  if (!val && val !== 0) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  // Excel may give a decimal fraction-of-day for time cells
  if (!isNaN(Number(s)) && s.indexOf(':') === -1) {
    return Math.round(Number(s) * 24 * 60);
  }
  const parts = s.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function isNumericCell(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return true;
  return !isNaN(Number(String(v).trim()));
}

function isXCell(v) {
  if (v === null || v === undefined || v === '') return false;
  return String(v).trim().toUpperCase() === 'X';
}

function cellStr(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

export function parseTrainingPathFlat(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets['Training Path Flat'];
  if (!sheet) throw new Error('Sheet "Training Path Flat" not found in the workbook');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // ── Playlist column metadata (row indices 1-3, 0-based) ──────────────────
  const titleRow = rows[1] || [];
  const descRow  = rows[2] || [];
  const linkRow  = rows[3] || [];

  const playlistCols = [];
  for (let c = 11; c < titleRow.length; c++) {
    const title = cellStr(titleRow[c]);
    if (!title) continue;
    playlistCols.push({
      colIndex:    c,
      title,
      description: cellStr(descRow[c]),
      link:        cellStr(linkRow[c]),
    });
  }

  // ── Find data start row ──────────────────────────────────────────────────
  let dataStart = -1;
  for (let r = 10; r < rows.length; r++) {
    const row = rows[r];
    const title = cellStr(row[4]);
    const c = row[2];
    if (title && (c === 0 || isNumericCell(c))) { dataStart = r; break; }
  }
  if (dataStart === -1) throw new Error('Could not find data rows in Training Path Flat');

  // ── Pass 1: collect all unique modules ───────────────────────────────────
  // Key: title (trimmed, lower). Value: { title, content_id, duration_min }
  const moduleMap = new Map(); // title_lower -> module object

  for (let r = dataStart; r < rows.length; r++) {
    const row   = rows[r];
    const title = cellStr(row[4]);
    if (!title) continue;

    const cVal = row[2];
    const dVal = row[3];
    const isCurriculum = (cVal === 0 || cellStr(cVal) === '0') &&
                         (dVal === 0 || cellStr(dVal) === '0');
    if (isCurriculum) continue; // curricula are not modules

    const key = title.toLowerCase();
    if (!moduleMap.has(key)) {
      const totalDuration = hhmmssToMinutes(row[8]);
      moduleMap.set(key, {
        title,
        content_id:   cellStr(row[9]),
        duration_min: totalDuration,
      });
    }
  }

  // ── Pass 2: build curricula with ordered module references ───────────────
  // Key: curriculum title_lower -> curriculum object
  // A curriculum row is detected by C==0 D==0.
  // The modules that belong to it are the subsequent non-curriculum rows
  // until the next curriculum row (or end of data).
  // Requirement per module inside the curriculum: col G > 0 => mandatory, else optional.

  const curriculumMap = new Map(); // title_lower -> curriculum object
  let currentCurriculum = null;

  for (let r = dataStart; r < rows.length; r++) {
    const row   = rows[r];
    const title = cellStr(row[4]);
    if (!title) continue;

    const cVal = row[2];
    const dVal = row[3];
    const isCurriculum = (cVal === 0 || cellStr(cVal) === '0') &&
                         (dVal === 0 || cellStr(dVal) === '0');

    if (isCurriculum) {
      const key = title.toLowerCase();
      if (!curriculumMap.has(key)) {
        const cur = {
          title,
          content_id: cellStr(row[9]),
          requirement: 'mandatory',
          modules: [], // { title, requirement, sequence_order }
        };
        curriculumMap.set(key, cur);
      }
      currentCurriculum = curriculumMap.get(key);
    } else {
      if (!currentCurriculum) continue;
      const modTitle = title;
      const modKey   = modTitle.toLowerCase();
      if (!moduleMap.has(modKey)) continue; // safety

      // Avoid adding the same module twice to the same curriculum
      const alreadyIn = currentCurriculum.modules.some(
        m => m.title.toLowerCase() === modKey
      );
      if (alreadyIn) continue;

      const mandatoryDuration = hhmmssToMinutes(row[6]);
      const requirement = mandatoryDuration > 0 ? 'mandatory' : 'optional';

      // sequence_order: use col D (brick order) if available
      const seqRaw = row[3];
      const sequence_order = isNumericCell(seqRaw) ? Number(seqRaw) : currentCurriculum.modules.length + 1;

      currentCurriculum.modules.push({ title: modTitle, requirement, sequence_order });
    }
  }

  // Sort modules inside each curriculum by sequence_order
  for (const cur of curriculumMap.values()) {
    cur.modules.sort((a, b) => a.sequence_order - b.sequence_order);
  }

  // ── Pass 3: build playlists ───────────────────────────────────────────────
  // For each playlist column, scan data rows:
  //   numeric cell -> sequence_order in Primary Training
  //   X cell       -> complementary reference link from that row

  const primaryTrainings     = [];
  const complementaryTrainings = [];

  for (const pc of playlistCols) {
    const isPrimary = pc.link !== '';

    if (isPrimary) {
      const items = []; // { isCurriculum, title, sequence_order }

      for (let r = dataStart; r < rows.length; r++) {
        const row   = rows[r];
        const title = cellStr(row[4]);
        if (!title) continue;

        const cellVal = row[pc.colIndex];
        if (!isNumericCell(cellVal)) continue;
        const position = Number(cellVal);

        const cVal = row[2];
        const dVal = row[3];
        const isCur = (cVal === 0 || cellStr(cVal) === '0') &&
                      (dVal === 0 || cellStr(dVal) === '0');

        items.push({ isCurriculum: isCur, title, sequence_order: position });
      }

      items.sort((a, b) => a.sequence_order - b.sequence_order);

      // Separate into curricula list and standalone modules list
      const curricula          = [];
      const standalone_modules = [];

      for (const item of items) {
        if (item.isCurriculum) {
          const cur = curriculumMap.get(item.title.toLowerCase());
          if (cur) {
            curricula.push({
              title:          cur.title,
              content_id:     cur.content_id,
              requirement:    cur.requirement,
              sequence_order: item.sequence_order,
              modules:        cur.modules.map(m => ({ ...m })),
            });
          }
        } else {
          const mod = moduleMap.get(item.title.toLowerCase());
          if (mod) {
            standalone_modules.push({
              title:          mod.title,
              content_id:     mod.content_id,
              duration_min:   mod.duration_min,
              requirement:    'mandatory',
              sequence_order: item.sequence_order,
            });
          }
        }
      }

      primaryTrainings.push({
        title:       pc.title,
        description: pc.description,
        link:        pc.link,
        content_id:  '',
        curricula,
        standalone_modules,
      });

    } else {
      // Complementary training: collect rows with X cell
      const links = [];

      for (let r = dataStart; r < rows.length; r++) {
        const row   = rows[r];
        const title = cellStr(row[4]);
        if (!title) continue;

        const cellVal = row[pc.colIndex];
        if (!isXCell(cellVal)) continue;

        // Use the link from the row itself (col L onwards may carry per-row links)
        // Per the spec the link of the module/curriculum is what matters.
        // We store the content_id and title so the backend can resolve it.
        const contentId = cellStr(row[9]);
        const rowLink   = cellStr(row[10]); // col K may carry a URL -- adjust if needed

        links.push({ title, content_id: contentId, link: rowLink });
      }

      complementaryTrainings.push({
        title:       pc.title,
        description: pc.description,
        link:        '',
        content_id:  '',
        is_complementary: true,
        references:  links, // list of { title, content_id, link }
        curricula:   [],
        standalone_modules: [],
      });
    }
  }

  return {
    modules:                  Array.from(moduleMap.values()),
    curricula:                Array.from(curriculumMap.values()),
    primary_trainings:        primaryTrainings,
    complementary_trainings:  complementaryTrainings,
  };
}
