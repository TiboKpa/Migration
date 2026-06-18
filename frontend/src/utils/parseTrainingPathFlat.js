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
 *   C(2)  : chapter number  (curriculum sequence within the file)
 *   D(3)  : brick number    (module sequence within its chapter)
 *   E(4)  : title
 *   F(5)  : family
 *   G(6)  : mandatory duration (HH:MM or HH:MM:SS)
 *   H(7)  : optional duration
 *   I(8)  : total duration
 *   J(9)  : content ID
 *   K(10) : content type
 *   L(11)+: one column per training
 *
 * Row classification (C and D are structural, not playlist-order):
 *   C==0, D==0  -> CURRICULUM header
 *   C==0, D!=0  -> STANDALONE MODULE (belongs to no curriculum)
 *   C!=0, D!=0  -> MODULE inside the curriculum whose header immediately precedes it in the file
 *
 * Playlist column cell values (all playlists are primary):
 *   numeric  -> sequence_order of this row inside that training
 *   empty    -> not in this training
 *
 * CURRICULUM rows can be added as curriculum items in a training.
 * STANDALONE_MODULE and MODULE rows (including curriculum-owned ones) can be
 * added as standalone module items in a training when their cell is filled.
 */

import * as XLSX from 'xlsx';

function hhmmssToMinutes(val) {
  if (!val && val !== 0) return 0;
  const s = String(val).trim();
  if (!s) return 0;
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

function toNum(v) {
  return Number(String(v).trim());
}

function cellStr(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

/**
 * Extract a URL from a cell, supporting both:
 *   - plain URL text  (cell value is "https://...")
 *   - embedded hyperlink  (display text is "LINK" but target is in cell.l.Target)
 *
 * sheet  : the XLSX worksheet object
 * rowIdx : 0-based row index used by sheet_to_json
 * colIdx : 0-based column index
 * rawVal : the value already read from the json row array (used as fallback)
 */
function getCellLink(sheet, rowIdx, colIdx, rawVal) {
  // Convert 0-based indices to XLSX cell address (e.g. row 3, col 11 -> "L4")
  const colLetter = XLSX.utils.encode_col(colIdx);
  // sheet_to_json with header:1 maps 0-based rowIdx directly — row 0 of the
  // json array corresponds to the first sheet row (row 1 in XLSX 1-based terms).
  const cellAddr = colLetter + String(rowIdx + 1);
  const cell = sheet[cellAddr];

  if (cell) {
    // Embedded hyperlink stored by XLSX under cell.l.Target
    if (cell.l && cell.l.Target) {
      const t = String(cell.l.Target).trim();
      if (t) return t;
    }
    // Some parsers expose the hyperlink on the value object
    if (cell.v && typeof cell.v === 'object' && cell.v.hyperlink) {
      const t = String(cell.v.hyperlink).trim();
      if (t) return t;
    }
  }

  // Fallback: the cell value itself may be a plain URL string
  const raw = cellStr(rawVal);
  if (/^(https?:\/\/|mailto:)/i.test(raw)) return raw;

  return '';
}

export function parseTrainingPathFlat(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellFormula: false, cellHTML: false });
  const sheet = workbook.Sheets['Training Path Flat'];
  if (!sheet) throw new Error('Sheet "Training Path Flat" not found in the workbook');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Playlist column metadata (rows 1-3 in the sheet = indices 1-3 in the json array)
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
      link:        getCellLink(sheet, 3, c, linkRow[c]),  // row index 3 = sheet row 4
    });
  }

  // Find data start row
  let dataStart = -1;
  for (let r = 10; r < rows.length; r++) {
    const row   = rows[r];
    const title = cellStr(row[4]);
    const c     = row[2];
    if (title && (c === 0 || isNumericCell(c))) { dataStart = r; break; }
  }
  if (dataStart === -1) throw new Error('Could not find data rows in Training Path Flat');

  // Classify every data row
  const classifiedRows = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row   = rows[r];
    const title = cellStr(row[4]);
    if (!title) continue;

    const cRaw = row[2];
    const dRaw = row[3];
    const cNum = isNumericCell(cRaw) ? toNum(cRaw) : null;
    const dNum = isNumericCell(dRaw) ? toNum(dRaw) : null;

    let type;
    if (cNum === 0 && dNum === 0) {
      type = 'curriculum';
    } else if (cNum === 0 && dNum !== 0) {
      type = 'standalone_module';
    } else {
      type = 'module';
    }

    // Column J (index 9) = content_id, column K (index 10) = content type
    // Column E (index 4) = title — check for embedded link on the title cell too
    const titleLink = getCellLink(sheet, r, 4, row[4]);
    const contentIdLink = getCellLink(sheet, r, 9, row[9]);
    // Use whichever is a real URL
    const rowLink = titleLink || contentIdLink || '';

    classifiedRows.push({
      rowIndex:    r,
      type,
      chapter:     cNum,
      brick:       dNum,
      title,
      content_id:  cellStr(row[9]),
      link:        rowLink,
      mandatoryMs: hhmmssToMinutes(row[6]),
      totalMs:     hhmmssToMinutes(row[8]),
      rawRow:      row,
    });
  }

  // Pass 1: unique modules
  const moduleMap = new Map();
  for (const cr of classifiedRows) {
    if (cr.type === 'curriculum') continue;
    const key = cr.title.toLowerCase();
    if (!moduleMap.has(key)) {
      moduleMap.set(key, {
        title:        cr.title,
        content_id:   cr.content_id,
        link:         cr.link,
        duration_min: cr.totalMs,
      });
    }
  }

  // Pass 2: build curricula and attach modules by file order.
  const curriculumMap = new Map();
  const curriculaOrder = [];

  let currentCurriculum = null;

  for (const cr of classifiedRows) {
    if (cr.type === 'curriculum') {
      const key = cr.title.toLowerCase();
      if (!curriculumMap.has(key)) {
        const cur = {
          title:      cr.title,
          content_id: cr.content_id,
          link:       cr.link,
          modules:    [],
        };
        curriculumMap.set(key, cur);
        curriculaOrder.push(cur);
      }
      currentCurriculum = curriculumMap.get(key);
      continue;
    }

    if (cr.type === 'module' && currentCurriculum) {
      const modKey = cr.title.toLowerCase();
      if (!moduleMap.has(modKey)) continue;
      const alreadyIn = currentCurriculum.modules.some(m => m.title.toLowerCase() === modKey);
      if (alreadyIn) continue;
      currentCurriculum.modules.push({
        title:          cr.title,
        requirement:    cr.mandatoryMs > 0 ? 'mandatory' : 'optional',
        sequence_order: cr.brick ?? (currentCurriculum.modules.length + 1),
      });
    }
  }

  for (const cur of curriculaOrder) {
    cur.modules.sort((a, b) => a.sequence_order - b.sequence_order);
  }

  // Pass 3: build playlists — all columns are primary trainings
  const primaryTrainings = [];

  for (const pc of playlistCols) {
    const items = [];
    for (const cr of classifiedRows) {
      const cellVal = cr.rawRow[pc.colIndex];
      if (!isNumericCell(cellVal)) continue;
      items.push({
        isCurriculum:   cr.type === 'curriculum',
        title:          cr.title,
        sequence_order: toNum(cellVal),
      });
    }
    items.sort((a, b) => a.sequence_order - b.sequence_order);

    const curricula          = [];
    const standalone_modules = [];
    for (const item of items) {
      if (item.isCurriculum) {
        const cur = curriculumMap.get(item.title.toLowerCase());
        if (cur) curricula.push({
          title:          cur.title,
          content_id:     cur.content_id,
          link:           cur.link,
          sequence_order: item.sequence_order,
          modules:        cur.modules.map(m => ({ ...m })),
        });
      } else {
        const mod = moduleMap.get(item.title.toLowerCase());
        if (mod) standalone_modules.push({
          title:          mod.title,
          content_id:     mod.content_id,
          link:           mod.link,
          duration_min:   mod.duration_min,
          sequence_order: item.sequence_order,
        });
      }
    }

    primaryTrainings.push({
      title:             pc.title,
      description:       pc.description,
      link:              pc.link,
      content_id:        '',
      curricula,
      standalone_modules,
    });
  }

  return {
    modules:           Array.from(moduleMap.values()),
    curricula:         curriculaOrder,
    primary_trainings: primaryTrainings,
  };
}
