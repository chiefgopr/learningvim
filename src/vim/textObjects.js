import { charClass, clampCol } from './motions.js';

const QUOTE_CHARS = new Set(['"', "'", '`']);
const BRACKET_PAIRS = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
};

function resolveWordObject(line, row, col, inner, bigWord) {
  if (!line || line.length === 0) return null;
  const c = clampCol(line, col);
  const cls = charClass(line[c], bigWord);

  let start = c;
  while (start > 0 && charClass(line[start - 1], bigWord) === cls) {
    start--;
  }
  let end = c;
  while (end + 1 < line.length && charClass(line[end + 1], bigWord) === cls) {
    end++;
  }

  if (!inner) {
    if (cls === 0) {
      // On whitespace, 'aw' expands forward across following word
      if (end + 1 < line.length) {
        const nextCls = charClass(line[end + 1], bigWord);
        end++;
        while (end + 1 < line.length && charClass(line[end + 1], bigWord) === nextCls) {
          end++;
        }
      }
    } else {
      // Trailing spaces included; if none, leading spaces included
      let trail = end;
      while (trail + 1 < line.length && charClass(line[trail + 1], bigWord) === 0) {
        trail++;
      }
      if (trail > end) {
        end = trail;
      } else {
        while (start > 0 && charClass(line[start - 1], bigWord) === 0) {
          start--;
        }
      }
    }
  }

  return {
    startRow: row,
    startCol: start,
    endRow: row,
    endCol: end,
  };
}

function resolveQuoteObject(line, row, col, inner, quoteChar) {
  if (!line || line.length === 0) return null;
  const indices = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quoteChar && (i === 0 || line[i - 1] !== '\\')) {
      indices.push(i);
    }
  }
  if (indices.length < 2) return null;

  // Pair quotes left-to-right on the line
  const pairs = [];
  for (let i = 0; i + 1 < indices.length; i += 2) {
    pairs.push([indices[i], indices[i + 1]]);
  }

  const c = clampCol(line, col);
  let chosen = pairs.find(([open, close]) => c >= open && c <= close);
  if (!chosen) {
    chosen = pairs.find(([open]) => open > c);
  }
  if (!chosen) return null;

  const [openIdx, closeIdx] = chosen;
  if (inner) {
    if (openIdx + 1 > closeIdx - 1) {
      // Empty quotes "" -> return empty interior marker
      return {
        startRow: row,
        startCol: openIdx + 1,
        endRow: row,
        endCol: openIdx,
        empty: true,
      };
    }
    return {
      startRow: row,
      startCol: openIdx + 1,
      endRow: row,
      endCol: closeIdx - 1,
    };
  }

  return {
    startRow: row,
    startCol: openIdx,
    endRow: row,
    endCol: closeIdx,
  };
}

function resolveBracketObject(lines, row, col, inner, openCh, closeCh) {
  const curLine = lines[row] || '';
  const c = clampCol(curLine, col);

  // Collect matching pairs across the buffer
  const stack = [];
  const pairs = [];
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === openCh) {
        stack.push({ row: r, col: i });
      } else if (line[i] === closeCh && stack.length > 0) {
        const openPos = stack.pop();
        pairs.push({ open: openPos, close: { row: r, col: i } });
      }
    }
  }

  const posCmp = (aRow, aCol, bRow, bCol) =>
    aRow !== bRow ? aRow - bRow : aCol - bCol;

  // Find innermost enclosing pair
  const enclosing = pairs.filter(
    (p) =>
      posCmp(p.open.row, p.open.col, row, c) <= 0 &&
      posCmp(row, c, p.close.row, p.close.col) <= 0
  );

  let chosen = null;
  if (enclosing.length > 0) {
    enclosing.sort((a, b) => posCmp(b.open.row, b.open.col, a.open.row, a.open.col));
    chosen = enclosing[0];
  } else {
    // Otherwise look forward on current line for an opener
    const forward = pairs
      .filter((p) => p.open.row === row && p.open.col > c)
      .sort((a, b) => a.open.col - b.open.col);
    if (forward.length > 0) chosen = forward[0];
  }

  if (!chosen) return null;

  if (!inner) {
    return {
      startRow: chosen.open.row,
      startCol: chosen.open.col,
      endRow: chosen.close.row,
      endCol: chosen.close.col,
    };
  }

  // Compute inner bounds (one char after open, one char before close)
  let sRow = chosen.open.row;
  let sCol = chosen.open.col + 1;
  if (sCol > lines[sRow].length) {
    sRow++;
    sCol = 0;
  }

  let eRow = chosen.close.row;
  let eCol = chosen.close.col - 1;
  if (eCol < 0) {
    eRow--;
    eCol = Math.max(0, lines[eRow].length - 1);
  }

  if (posCmp(sRow, sCol, eRow, eCol) > 0) {
    return {
      startRow: chosen.open.row,
      startCol: chosen.open.col + 1,
      endRow: chosen.open.row,
      endCol: chosen.open.col,
      empty: true,
    };
  }

  return {
    startRow: sRow,
    startCol: sCol,
    endRow: eRow,
    endCol: eCol,
  };
}

/**
 * Resolve a Vim text object (iw, aw, iW, aW, i", a", i', a', i`, a`, i(, a(, i[, a[, i{, a{, ib, ab, iB, aB).
 * Returns inclusive bounds { startRow, startCol, endRow, endCol, empty? } or null.
 */
export function resolveTextObject(lines, row, col, inner, objChar) {
  if (!lines || row < 0 || row >= lines.length) return null;
  if (objChar === 'w' || objChar === 'W') {
    return resolveWordObject(lines[row], row, col, inner, objChar === 'W');
  }
  if (QUOTE_CHARS.has(objChar)) {
    return resolveQuoteObject(lines[row], row, col, inner, objChar);
  }
  if (BRACKET_PAIRS[objChar]) {
    const [openCh, closeCh] = BRACKET_PAIRS[objChar];
    return resolveBracketObject(lines, row, col, inner, openCh, closeCh);
  }
  return null;
}
