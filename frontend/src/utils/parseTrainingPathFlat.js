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
 * Playlist column cell values:
 *   Primary Training   (row-3 link non-empty):
 *     numeric  -> sequence_order of this row inside that training
 *     empty    -> not in this training
 *
 *   Complementary Training (row-3 link empty):
 *     numeric  -> included; numeric value is the display order
 *     letter   -> included; order is position of first occurrence
 *     empty    -> not in this training
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
 * Returns whether a cell value means "include in complementary training".
 * Accepts: any non-empty string or number that is not blank.
 * Numeric value  -> explicit order (used as sequence_order).
 * Letter/string  -> include; order is assigned by appearance.
 */
function complementaryCellOrder(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (isNumericCell(v)) return { explicit: true, order: toNum(v) };
  // Any non-empty, non-numeric value (letter, word) means include
  return { explicit: false, order: null };
}

export function parseTrainingPathFlat(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets['Training Path Flat'];
  if (!sheet) throw new Error('Sheet "Training Path Flat" not found in the workbook');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Playlist column metadata
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

    classifiedRows.push({
      rowIndex:    r,
      type,
      chapter:     cNum,
      brick:       dNum,
      title,
      content_id:  cellStr(row[9]),
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
        duration_min: cr.totalMs,
      });
    }
  }

  // Pass 2: build curricula and attach modules by file order.
  // A module row belongs to whichever curriculum header immediately precedes
  // it in the file — no chapter-number mapping is used.
  const curriculumMap = new Map(); // key: title.toLowerCase() -> curriculum object
  const curriculaOrder = [];       // preserves insertion order for the payload

  let currentCurriculum = null;

  for (const cr of classifiedRows) {
    if (cr.type === 'curriculum') {
      const key = cr.title.toLowerCase();
      if (!curriculumMap.has(key)) {
        const cur = {
          title:      cr.title,
          content_id: cr.content_id,
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

  // Pass 3: build playlists
  const primaryTrainings       = [];
  const complementaryTrainings = [];

  for (const pc of playlistCols) {
    const isPrimary = pc.link !== '';

    if (isPrimary) {
      const items = [];
      for (const cr of classifiedRows) {
        // Curriculum headers become curriculum items.
        // All module rows (standalone or curriculum-owned) become standalone module items
        // when their training cell is filled in.
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
            sequence_order: item.sequence_order,
            modules:        cur.modules.map(m => ({ ...m })),
          });
        } else {
          const mod = moduleMap.get(item.title.toLowerCase());
          if (mod) standalone_modules.push({
            title:          mod.title,
            content_id:     mod.content_id,
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

    } else {
      const explicitItems = [];
      const implicitItems = [];

      for (const cr of classifiedRows) {
        const result = complementaryCellOrder(cr.rawRow[pc.colIndex]);
        if (!result) continue;
        const entry = { title: cr.title, content_id: cr.content_id, link: '' };
        if (result.explicit) {
          explicitItems.push({ ...entry, sequence_order: result.order });
        } else {
          implicitItems.push(entry);
        }
      }

      const maxExplicit = explicitItems.reduce((m, i) => Math.max(m, i.sequence_order), 0);
      const references  = [
        ...explicitItems.sort((a, b) => a.sequence_order - b.sequence_order),
        ...implicitItems.map((item, idx) => ({ ...item, sequence_order: maxExplicit + idx + 1 })),
      ];

      complementaryTrainings.push({
        title:            pc.title,
        description:      pc.description,
        is_complementary: true,
        references,
        curricula:        [],
        standalone_modules: [],
      });
    }
  }

  return {
    modules:                 Array.from(moduleMap.values()),
    curricula:               curriculaOrder,
    primary_trainings:       primaryTrainings,
    complementary_trainings: complementaryTrainings,
  };
}
