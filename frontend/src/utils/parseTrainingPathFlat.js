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
 *            number  -> position of this row inside that Primary Training
 *            "X"/"x" -> this row is a Complementary reference
 *            empty   -> not in this training
 *
 * Row classification (C and D are structural, not playlist-order):
 *
 *   C==0, D==0  -> CURRICULUM header
 *   C==0, D!=0  -> STANDALONE MODULE (belongs to no curriculum)
 *   C!=0, D!=0  -> MODULE inside the curriculum whose chapter == C
 *
 * Within a curriculum the module's position is col D.
 * A module's requirement inside a curriculum:
 *   col G > 0  => mandatory
 *   col H > 0  => optional
 *
 * Global module duration comes from col I (total).
 * Modules are deduplicated by title; first occurrence wins for metadata.
 *
 * Playlist column rules:
 *   Primary Training     = col L+ where row-3 link is non-empty.
 *   Complementary        = col L+ where row-3 link is empty.
 *   Numeric cell value   = sequence_order of this row inside that Primary Training.
 *   X cell value         = this row is a complementary reference for that training.
 *
 * IMPORTANT: the numeric value in a playlist column is the ORDER of the
 * curriculum / standalone-module inside that specific training. It has no
 * relation to C or D.
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

function isXCell(v) {
  if (v === null || v === undefined || v === '') return false;
  return String(v).trim().toUpperCase() === 'X';
}

function toNum(v) {
  return Number(String(v).trim());
}

function cellStr(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

export function parseTrainingPathFlat(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets['Training Path Flat'];
  if (!sheet) throw new Error('Sheet "Training Path Flat" not found in the workbook');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // ── Playlist column metadata ──────────────────────────────────────────────────
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
    const row   = rows[r];
    const title = cellStr(row[4]);
    const c     = row[2];
    if (title && (c === 0 || isNumericCell(c))) { dataStart = r; break; }
  }
  if (dataStart === -1) throw new Error('Could not find data rows in Training Path Flat');

  // ── Classify every data row ────────────────────────────────────────────────
  //
  //  type: 'curriculum' | 'standalone_module' | 'module'
  //  chapter:   numeric value of col C  (curriculum sequence)
  //  brick:     numeric value of col D  (module sequence within chapter)
  //
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
      type = 'module'; // belongs to a curriculum (chapter = cNum)
    }

    classifiedRows.push({
      rowIndex:    r,
      type,
      chapter:     cNum,  // curriculum's sequence number in the file
      brick:       dNum,  // module's sequence number within that chapter
      title,
      content_id:  cellStr(row[9]),
      mandatoryMs: hhmmssToMinutes(row[6]),
      optionalMs:  hhmmssToMinutes(row[7]),
      totalMs:     hhmmssToMinutes(row[8]),
      rawRow:      row,
    });
  }

  // ── Pass 1: unique modules ──────────────────────────────────────────────────
  // Both 'module' and 'standalone_module' rows are global modules.
  // Deduped by title (lower-case). Duration from col I (total).

  const moduleMap = new Map(); // title_lower -> { title, content_id, duration_min }

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

  // ── Pass 2: build curricula ──────────────────────────────────────────────────
  // Group 'module' rows by chapter number, then attach to the curriculum
  // whose chapter number matches.
  // Module sequence inside the curriculum = col D (brick).
  // Requirement = mandatory if col G > 0, optional if col H > 0.

  const curriculumMap = new Map(); // title_lower -> curriculum object

  // First, register all curriculum rows
  for (const cr of classifiedRows) {
    if (cr.type !== 'curriculum') continue;
    const key = cr.title.toLowerCase();
    if (!curriculumMap.has(key)) {
      curriculumMap.set(key, {
        title:      cr.title,
        content_id: cr.content_id,
        chapter:    cr.chapter, // file-level sequence (used to match modules)
        modules:    [],
      });
    }
  }

  // Build a lookup: chapter number -> curriculum
  // (chapter 0 means "standalone", no curriculum)
  const chapterToCurriculum = new Map();
  for (const cur of curriculumMap.values()) {
    // chapter on a curriculum row is always 0 (C==0 D==0).
    // We need to track which chapter number the FOLLOWING module rows use.
    // The file lists curricula in order; the modules immediately after share
    // that curriculum's chapter number (col C = curriculum index in sequence).
    // We reconstruct this by scanning classifiedRows in order.
  }

  // Reconstruct chapter -> curriculum by scanning in file order
  let lastCurriculum = null;
  let lastChapterNum = null;

  for (const cr of classifiedRows) {
    if (cr.type === 'curriculum') {
      lastCurriculum = curriculumMap.get(cr.title.toLowerCase());
      // The chapter number used by its child module rows is the next distinct
      // non-zero value of col C we encounter. We track it dynamically below.
      lastChapterNum = null; // will be set when we see the first child row
    } else if (cr.type === 'module') {
      if (cr.chapter !== null) {
        if (lastChapterNum === null) {
          // First module under this curriculum -- record its chapter number
          lastChapterNum = cr.chapter;
          if (lastCurriculum) chapterToCurriculum.set(cr.chapter, lastCurriculum);
        } else if (cr.chapter !== lastChapterNum) {
          // New chapter number => new curriculum group started
          lastChapterNum = cr.chapter;
          if (lastCurriculum) chapterToCurriculum.set(cr.chapter, lastCurriculum);
        }
      }
    }
  }

  // Attach modules to their curriculum using chapter number
  for (const cr of classifiedRows) {
    if (cr.type !== 'module') continue;
    const cur = chapterToCurriculum.get(cr.chapter);
    if (!cur) continue;

    const modKey = cr.title.toLowerCase();
    if (!moduleMap.has(modKey)) continue;

    const alreadyIn = cur.modules.some(m => m.title.toLowerCase() === modKey);
    if (alreadyIn) continue;

    cur.modules.push({
      title:          cr.title,
      requirement:    cr.mandatoryMs > 0 ? 'mandatory' : 'optional',
      sequence_order: cr.brick ?? (cur.modules.length + 1), // col D
    });
  }

  // Sort modules within each curriculum by their col-D sequence
  for (const cur of curriculumMap.values()) {
    cur.modules.sort((a, b) => a.sequence_order - b.sequence_order);
  }

  // ── Pass 3: build playlists ──────────────────────────────────────────────────
  // The numeric value in a playlist column (L+) is the ORDER of that row
  // inside that specific training. It is completely independent of C and D.
  //
  // Only curriculum rows and standalone_module rows appear in playlists.
  // A 'module' row (C!=0, D!=0) is part of its curriculum and never appears
  // directly in a playlist column.

  const primaryTrainings      = [];
  const complementaryTrainings = [];

  for (const pc of playlistCols) {
    const isPrimary = pc.link !== '';

    if (isPrimary) {
      const items = [];

      for (const cr of classifiedRows) {
        // Only curriculum headers and standalone modules can be playlist items
        if (cr.type === 'module') continue;

        const cellVal = cr.rawRow[pc.colIndex];
        if (!isNumericCell(cellVal)) continue;

        items.push({
          isCurriculum:   cr.type === 'curriculum',
          title:          cr.title,
          sequence_order: toNum(cellVal), // ORDER within THIS training
        });
      }

      items.sort((a, b) => a.sequence_order - b.sequence_order);

      const curricula          = [];
      const standalone_modules = [];

      for (const item of items) {
        if (item.isCurriculum) {
          const cur = curriculumMap.get(item.title.toLowerCase());
          if (cur) {
            curricula.push({
              title:          cur.title,
              content_id:     cur.content_id,
              sequence_order: item.sequence_order, // position in THIS training
              modules:        cur.modules.map(m => ({ ...m })), // col-D order intact
            });
          }
        } else {
          const mod = moduleMap.get(item.title.toLowerCase());
          if (mod) {
            standalone_modules.push({
              title:          mod.title,
              content_id:     mod.content_id,
              duration_min:   mod.duration_min,
              sequence_order: item.sequence_order, // position in THIS training
            });
          }
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
      // Complementary training: X cells
      const references = [];

      for (const cr of classifiedRows) {
        const cellVal = cr.rawRow[pc.colIndex];
        if (!isXCell(cellVal)) continue;
        references.push({
          title:      cr.title,
          content_id: cr.content_id,
          link:       '',
        });
      }

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
    curricula:               Array.from(curriculumMap.values()),
    primary_trainings:       primaryTrainings,
    complementary_trainings: complementaryTrainings,
  };
}
