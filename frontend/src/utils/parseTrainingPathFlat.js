/**
 * parseTrainingPathFlat
 *
 * Parses the "Training Path Flat" sheet from Trainings Path.xlsx.
 *
 * Sheet layout (0-indexed rows after the header block):
 *   Row 0  : group headers ("BOB Playlists", "ETO BOB Playlists", etc.)
 *   Row 1  : playlist titles starting at column L (index 11)
 *   Row 2  : descriptions
 *   Row 3  : MLL links
 *   Rows 4-9: metadata rows (training docs, duration labels, trainers, etc.) - skipped
 *   Row 10 : column headers (Playlist / Chapter / Brick order / Module Title / ...)
 *   Row 11+: data rows
 *
 * Data row columns (0-indexed):
 *   0  : Playlist group label (e.g. "Viewers", "Author", "MCAD")
 *   1  : row number
 *   2  : Chapter  (0 = this row is a curriculum header)
 *   3  : Brick order (0 = this row is a curriculum header)
 *   4  : Title
 *   5  : Family
 *   6  : Mandatory time (HH:MM:SS)
 *   7  : Optional time
 *   8  : Total time
 *   9  : Content ID
 *   10 : Content type
 *   11+: One column per playlist; value is a number = position in that playlist,
 *        empty or non-numeric = not in this playlist.
 *
 * A row is a CURRICULUM when Chapter == 0 AND Brick order == 0.
 * A row is a MODULE otherwise.
 * A module is MANDATORY when its mandatory time column (col 6) is non-empty.
 */

import * as XLSX from 'xlsx';

function hhmmssToMinutes(val) {
  if (!val) return 0;
  const s = String(val).trim();
  const parts = s.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function isNumeric(v) {
  if (v === null || v === undefined || v === '') return false;
  return !isNaN(Number(v));
}

export function parseTrainingPathFlat(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets['Training Path Flat'];
  if (!sheet) throw new Error('Sheet "Training Path Flat" not found in the workbook');

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Row index 1 (0-based) = playlist titles from column L (index 11) onward
  const titleRow = rows[1] || [];
  const descRow = rows[2] || [];
  const linkRow = rows[3] || [];

  // Collect playlist column indices and their metadata
  const playlistCols = [];
  for (let c = 11; c < titleRow.length; c++) {
    const title = String(titleRow[c] || '').trim();
    if (title) {
      playlistCols.push({
        colIndex: c,
        title,
        description: String(descRow[c] || '').trim(),
        link: String(linkRow[c] || '').trim(),
      });
    }
  }

  // Find the data start row: first row where col 2 is a number (Chapter field)
  // That is row index 10 (header) + 1 = row index 11, but we detect it dynamically.
  let dataStartIndex = -1;
  for (let r = 10; r < rows.length; r++) {
    const row = rows[r];
    const chapter = row[2];
    const title = String(row[4] || '').trim();
    if (title && (chapter === 0 || isNumeric(chapter))) {
      dataStartIndex = r;
      break;
    }
  }
  if (dataStartIndex === -1) throw new Error('Could not find data rows in Training Path Flat');

  // Build one playlist object per column
  const playlistMap = {};
  for (const pc of playlistCols) {
    playlistMap[pc.colIndex] = {
      title: pc.title,
      description: pc.description,
      link: pc.link,
      content_id: '',
      curricula: [],          // { title, content_id, requirement, sequence_order, modules[] }
      standalone_modules: [], // { title, content_id, duration_min, requirement, sequence_order }
      _lastCurriculumIndex: {}, // colIndex -> curriculum index in curricula array
    };
  }

  // Process data rows
  for (let r = dataStartIndex; r < rows.length; r++) {
    const row = rows[r];
    const title = String(row[4] || '').trim();
    if (!title) continue;

    const chapterRaw = row[2];
    const brickRaw = row[3];
    const chapter = isNumeric(chapterRaw) ? Number(chapterRaw) : null;
    const brick = isNumeric(brickRaw) ? Number(brickRaw) : null;
    const isCurriculum = chapter === 0 && brick === 0;

    const contentId = String(row[9] || '').trim();
    const mandatoryTime = row[6];
    const optionalTime = row[7];
    const duration_min = hhmmssToMinutes(mandatoryTime || optionalTime);
    const requirement = (mandatoryTime && String(mandatoryTime).trim()) ? 'mandatory' : 'optional';

    for (const pc of playlistCols) {
      const cellVal = row[pc.colIndex];
      if (!isNumeric(cellVal)) continue;
      const position = Number(cellVal);

      const pl = playlistMap[pc.colIndex];

      if (isCurriculum) {
        const idx = pl.curricula.length;
        pl.curricula.push({
          title,
          content_id: contentId,
          requirement: 'mandatory',
          sequence_order: position,
          modules: [],
        });
        pl._lastCurriculumIndex[pc.colIndex] = idx;
      } else {
        // Find the current open curriculum for this playlist column
        const lastCurIdx = pl._lastCurriculumIndex[pc.colIndex];
        const module = {
          title,
          content_id: contentId,
          duration_min,
          requirement,
          sequence_order: position,
        };
        if (lastCurIdx !== undefined && pl.curricula[lastCurIdx]) {
          pl.curricula[lastCurIdx].modules.push(module);
        } else {
          pl.standalone_modules.push(module);
        }
      }
    }
  }

  // Convert map to array, strip internal helpers
  return Object.values(playlistMap).map(({ _lastCurriculumIndex, ...rest }) => rest);
}
