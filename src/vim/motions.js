const OPEN_TO_CLOSE = { '(': ')', '[': ']', '{': '}' };
const CLOSE_TO_OPEN = { ')': '(', ']': '[', '}': '{' };

/**
 * Classify a character for Vim word/WORD boundaries.
 * 0 = whitespace, 1 = keyword (or any non-whitespace when bigWord=true), 2 = punctuation.
 */
export function charClass(ch, bigWord = false) {
  if (ch === undefined || ch === null) return -1;
  if (/\s/.test(ch)) return 0;
  if (bigWord) return 1;
  if (/[a-zA-Z0-9_]/.test(ch)) return 1;
  return 2;
}

export function clampCol(line, col) {
  if (!line || line.length === 0) return 0;
  if (col === Infinity) return line.length - 1;
  return Math.max(0, Math.min(col, line.length - 1));
}

export function findFirstNonBlank(line) {
  if (!line || line.length === 0) return 0;
  const idx = line.search(/\S/);
  return idx === -1 ? 0 : idx;
}

export function isBlankLine(line) {
  return !line || /^\s*$/.test(line);
}

/**
 * Find the matching bracket for the bracket at (row, col), or the first bracket
 * forward on the current line if the cursor is not directly on a bracket.
 */
export function findMatchingBracket(lines, row, col) {
  if (!lines || row < 0 || row >= lines.length) return null;
  const curLine = lines[row] || '';
  let startRow = row;
  let startCol = clampCol(curLine, col);
  let ch = curLine[startCol];

  if (!OPEN_TO_CLOSE[ch] && !CLOSE_TO_OPEN[ch]) {
    let foundIdx = -1;
    for (let c = startCol + 1; c < curLine.length; c++) {
      if (OPEN_TO_CLOSE[curLine[c]] || CLOSE_TO_OPEN[curLine[c]]) {
        foundIdx = c;
        break;
      }
    }
    if (foundIdx === -1) return null;
    startCol = foundIdx;
    ch = curLine[startCol];
  }

  if (OPEN_TO_CLOSE[ch]) {
    const closeCh = OPEN_TO_CLOSE[ch];
    let depth = 0;
    for (let r = startRow; r < lines.length; r++) {
      const line = lines[r];
      const cStart = r === startRow ? startCol : 0;
      for (let c = cStart; c < line.length; c++) {
        if (line[c] === ch) depth++;
        else if (line[c] === closeCh) {
          depth--;
          if (depth === 0) return { row: r, col: c, fromRow: startRow, fromCol: startCol };
        }
      }
    }
    return null;
  }

  if (CLOSE_TO_OPEN[ch]) {
    const openCh = CLOSE_TO_OPEN[ch];
    let depth = 0;
    for (let r = startRow; r >= 0; r--) {
      const line = lines[r];
      const cStart = r === startRow ? startCol : line.length - 1;
      for (let c = cStart; c >= 0; c--) {
        if (line[c] === ch) depth++;
        else if (line[c] === openCh) {
          depth--;
          if (depth === 0) return { row: r, col: c, fromRow: startRow, fromCol: startCol };
        }
      }
    }
    return null;
  }

  return null;
}

/**
 * Find all occurrences of query across lines. Supports optional whole-word boundary matching.
 */
export function findAllMatches(lines, query, wholeWord = false) {
  if (!query || !lines || lines.length === 0) return [];
  const matches = [];
  const isWordChar = (ch) => Boolean(ch && /[a-zA-Z0-9_]/.test(ch));

  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    let idx = 0;
    while (idx <= line.length - query.length) {
      const found = line.indexOf(query, idx);
      if (found === -1) break;
      const endCol = found + query.length;
      if (wholeWord) {
        const beforeOk = found === 0 || !isWordChar(line[found - 1]);
        const afterOk = endCol >= line.length || !isWordChar(line[endCol]);
        if (beforeOk && afterOk) {
          matches.push({ row: r, startCol: found, endCol });
        }
      } else {
        matches.push({ row: r, startCol: found, endCol });
      }
      idx = found + 1;
    }
  }
  return matches;
}

function getWordUnderOrAfter(line, col) {
  if (!line || line.length === 0) return '';
  let c = clampCol(line, col);
  const isWord = (ch) => Boolean(ch && /[a-zA-Z0-9_]/.test(ch));

  if (!isWord(line[c])) {
    let forward = -1;
    for (let i = c + 1; i < line.length; i++) {
      if (isWord(line[i])) {
        forward = i;
        break;
      }
    }
    if (forward === -1) return '';
    c = forward;
  }

  let start = c;
  while (start > 0 && isWord(line[start - 1])) start--;
  let end = c;
  while (end + 1 < line.length && isWord(line[end + 1])) end++;
  return line.slice(start, end + 1);
}

function stepWordForward(lines, r, c, bigWord, stopAtSameLineEnd) {
  const line = lines[r] || '';
  const startRow = r;

  if (line.length > 0 && c < line.length) {
    const cls = charClass(line[c], bigWord);
    if (cls !== 0) {
      while (c < line.length && charClass(line[c], bigWord) === cls) {
        c++;
      }
    }
  }

  while (true) {
    const curLine = lines[r] || '';
    while (c < curLine.length && charClass(curLine[c], bigWord) === 0) {
      c++;
    }
    if (c < curLine.length) {
      return { row: r, col: c, hitLineEnd: false };
    }
    if (stopAtSameLineEnd && r === startRow) {
      return { row: r, col: curLine.length, hitLineEnd: true };
    }
    if (r >= lines.length - 1) {
      return { row: r, col: curLine.length, hitLineEnd: true };
    }
    r++;
    c = 0;
    if (lines[r].length === 0) {
      return { row: r, col: 0, hitLineEnd: false };
    }
  }
}

function stepWordEnd(lines, r, c, bigWord) {
  const cur = lines[r] || '';
  if (cur.length === 0 || c + 1 >= cur.length) {
    if (r >= lines.length - 1) {
      return { row: r, col: Math.max(0, cur.length - 1), hitEnd: true };
    }
    r++;
    c = 0;
  } else {
    c++;
  }

  while (r < lines.length) {
    const line = lines[r];
    while (c < line.length && charClass(line[c], bigWord) === 0) {
      c++;
    }
    if (c < line.length) {
      const cls = charClass(line[c], bigWord);
      while (c + 1 < line.length && charClass(line[c + 1], bigWord) === cls) {
        c++;
      }
      return { row: r, col: c, hitEnd: false };
    }
    if (r >= lines.length - 1) {
      return { row: r, col: Math.max(0, line.length - 1), hitEnd: true };
    }
    r++;
    c = 0;
  }
  return { row: r, col: 0, hitEnd: true };
}

function stepWordBackward(lines, r, c, bigWord) {
  if (c > 0) {
    c--;
  } else if (r > 0) {
    r--;
    if (lines[r].length === 0) return { row: r, col: 0 };
    c = lines[r].length - 1;
  } else {
    return { row: 0, col: 0 };
  }

  while (lines[r].length === 0 || charClass(lines[r][c], bigWord) === 0) {
    if (c > 0) {
      c--;
    } else if (r > 0) {
      r--;
      if (lines[r].length === 0) return { row: r, col: 0 };
      c = lines[r].length - 1;
    } else {
      return { row: 0, col: 0 };
    }
  }

  const cls = charClass(lines[r][c], bigWord);
  while (c > 0 && charClass(lines[r][c - 1], bigWord) === cls) {
    c--;
  }
  return { row: r, col: c };
}

function findNextMatch(lines, row, col, query, dir, wholeWord, count = 1) {
  const matches = findAllMatches(lines, query, wholeWord);
  if (matches.length === 0) return null;

  let ordered;
  if (dir >= 0) {
    const after = matches.filter((m) => m.row > row || (m.row === row && m.startCol > col));
    const before = matches.filter((m) => !(m.row > row || (m.row === row && m.startCol > col)));
    ordered = [...after, ...before];
  } else {
    const before = matches.filter((m) => m.row < row || (m.row === row && m.startCol < col)).reverse();
    const after = matches.filter((m) => !(m.row < row || (m.row === row && m.startCol < col))).reverse();
    ordered = [...before, ...after];
  }

  const idx = (count - 1) % ordered.length;
  return ordered[idx];
}

/**
 * Pure deterministic Vim motion evaluator.
 * Returns { row, col, desiredCol, inclusive, linewise, moved, found, motionLabel, jumped, searchMeta }.
 */
export function computeMotion(state, motionType, opts = {}) {
  const lines = state.lines && state.lines.length > 0 ? state.lines : [''];
  const origRow = Math.max(0, Math.min(state.row, lines.length - 1));
  const origCol = clampCol(lines[origRow], state.col);
  const count = Math.max(1, opts.count ?? 1);
  const hasCount = Boolean(opts.hasCount);
  const forOperator = opts.forOperator || null;

  let row = origRow;
  let col = origCol;
  let desiredCol = state.desiredCol ?? origCol;
  let inclusive = false;
  let linewise = false;
  let found = true;
  let jumped = false;
  let motionLabel = motionType;
  let searchMeta = null;

  switch (motionType) {
    case 'h': {
      col = Math.max(0, origCol - count);
      desiredCol = col;
      break;
    }
    case 'l': {
      const lineLen = lines[row].length;
      if (forOperator) {
        col = Math.min(lineLen, origCol + count);
      } else {
        col = Math.min(Math.max(0, lineLen - 1), origCol + count);
      }
      desiredCol = col;
      break;
    }
    case 'j': {
      row = Math.min(lines.length - 1, origRow + count);
      col = clampCol(lines[row], desiredCol);
      linewise = Boolean(forOperator);
      jumped = count > 1;
      motionLabel = count > 1 ? `${count}j` : 'j';
      break;
    }
    case 'k': {
      row = Math.max(0, origRow - count);
      col = clampCol(lines[row], desiredCol);
      linewise = Boolean(forOperator);
      jumped = count > 1;
      motionLabel = count > 1 ? `${count}k` : 'k';
      break;
    }
    case '0': {
      col = 0;
      desiredCol = 0;
      jumped = origCol > 1;
      break;
    }
    case '^': {
      col = findFirstNonBlank(lines[row]);
      desiredCol = col;
      jumped = Math.abs(col - origCol) > 1;
      break;
    }
    case '$': {
      if (count > 1) {
        row = Math.min(lines.length - 1, origRow + count - 1);
      }
      col = Math.max(0, lines[row].length - 1);
      desiredCol = Infinity;
      inclusive = true;
      jumped = Math.abs(col - origCol) > 1 || row !== origRow;
      break;
    }
    case 'w':
    case 'W': {
      const bigWord = motionType === 'W';
      // Authentic Vim special case: cw/cW on non-whitespace acts like end-of-current-word inclusive
      if (forOperator === 'c' && lines[row].length > 0 && charClass(lines[row][col], bigWord) !== 0) {
        let r = row;
        let c = col;
        for (let step = 0; step < count; step++) {
          const line = lines[r];
          if (step === 0) {
            const cls = charClass(line[c], bigWord);
            while (c + 1 < line.length && charClass(line[c + 1], bigWord) === cls) {
              c++;
            }
          } else {
            const next = stepWordEnd(lines, r, c, bigWord);
            r = next.row;
            c = next.col;
          }
        }
        row = r;
        col = c;
        desiredCol = col;
        inclusive = true;
        jumped = true;
        break;
      }

      let r = row;
      let c = col;
      let hitEolForOp = false;
      for (let step = 0; step < count; step++) {
        const stopSameLine = forOperator === 'd' && step === count - 1;
        const res = stepWordForward(lines, r, c, bigWord, stopSameLine);
        r = res.row;
        c = res.col;
        if (res.hitLineEnd) {
          hitEolForOp = true;
          break;
        }
      }
      row = r;
      if (forOperator && hitEolForOp) {
        col = lines[row].length;
      } else {
        col = clampCol(lines[row], c);
      }
      desiredCol = col;
      jumped = true;
      break;
    }
    case 'e':
    case 'E': {
      const bigWord = motionType === 'E';
      let r = row;
      let c = col;
      for (let step = 0; step < count; step++) {
        const res = stepWordEnd(lines, r, c, bigWord);
        r = res.row;
        c = res.col;
      }
      row = r;
      col = clampCol(lines[row], c);
      desiredCol = col;
      inclusive = true;
      jumped = true;
      break;
    }
    case 'b':
    case 'B': {
      const bigWord = motionType === 'B';
      let r = row;
      let c = col;
      for (let step = 0; step < count; step++) {
        const res = stepWordBackward(lines, r, c, bigWord);
        r = res.row;
        c = res.col;
      }
      row = r;
      col = clampCol(lines[row], c);
      desiredCol = col;
      jumped = true;
      break;
    }
    case 'f':
    case 'F':
    case 't':
    case 'T': {
      const targetChar = opts.char;
      if (!targetChar) {
        found = false;
        break;
      }
      const line = lines[row];
      const forward = motionType === 'f' || motionType === 't';
      const till = motionType === 't' || motionType === 'T';
      const isRepeat = Boolean(opts.isRepeat);
      let remaining = count;
      let matchIdx = -1;

      if (forward) {
        let startIdx = origCol + 1;
        if (isRepeat && till && line[origCol + 1] === targetChar) {
          startIdx = origCol + 2;
        }
        for (let i = startIdx; i < line.length; i++) {
          if (line[i] === targetChar) {
            remaining--;
            if (remaining === 0) {
              matchIdx = i;
              break;
            }
          }
        }
      } else {
        let startIdx = origCol - 1;
        if (isRepeat && till && line[origCol - 1] === targetChar) {
          startIdx = origCol - 2;
        }
        for (let i = startIdx; i >= 0; i--) {
          if (line[i] === targetChar) {
            remaining--;
            if (remaining === 0) {
              matchIdx = i;
              break;
            }
          }
        }
      }

      if (matchIdx === -1) {
        found = false;
      } else {
        col = till ? (forward ? matchIdx - 1 : matchIdx + 1) : matchIdx;
        desiredCol = col;
        inclusive = forward;
        jumped = Math.abs(col - origCol) > 1 || (col !== origCol);
      }
      motionLabel = `${motionType}${targetChar}`;
      break;
    }
    case ';':
    case ',': {
      const lf = state.lastFind;
      if (!lf || !lf.char) {
        found = false;
        break;
      }
      const reverseMap = { f: 'F', F: 'f', t: 'T', T: 't' };
      const effectiveType = motionType === ',' ? reverseMap[lf.type] : lf.type;
      const res = computeMotion(state, effectiveType, {
        char: lf.char,
        count,
        forOperator,
        isRepeat: true,
      });
      res.motionLabel = motionType;
      return res;
    }
    case 'gg': {
      const targetLine = hasCount ? Math.max(0, Math.min(lines.length - 1, count - 1)) : 0;
      row = targetLine;
      col = findFirstNonBlank(lines[row]);
      desiredCol = col;
      linewise = true;
      jumped = true;
      motionLabel = hasCount ? `${count}gg` : 'gg';
      break;
    }
    case 'G': {
      const targetLine = hasCount
        ? Math.max(0, Math.min(lines.length - 1, count - 1))
        : lines.length - 1;
      row = targetLine;
      col = findFirstNonBlank(lines[row]);
      desiredCol = col;
      linewise = true;
      jumped = true;
      motionLabel = hasCount ? `${count}G` : 'G';
      break;
    }
    case '{': {
      let r = origRow;
      for (let step = 0; step < count; step++) {
        while (r > 0 && isBlankLine(lines[r])) r--;
        while (r > 0 && !isBlankLine(lines[r])) r--;
      }
      row = r;
      col = findFirstNonBlank(lines[row]);
      desiredCol = col;
      linewise = true;
      jumped = true;
      break;
    }
    case '}': {
      let r = origRow;
      const last = lines.length - 1;
      for (let step = 0; step < count; step++) {
        while (r < last && isBlankLine(lines[r])) r++;
        while (r < last && !isBlankLine(lines[r])) r++;
      }
      row = r;
      col = findFirstNonBlank(lines[row]);
      desiredCol = col;
      linewise = true;
      jumped = true;
      break;
    }
    case '%': {
      const match = findMatchingBracket(lines, origRow, origCol);
      if (!match) {
        found = false;
      } else {
        row = match.row;
        col = match.col;
        desiredCol = col;
        inclusive = true;
        jumped = true;
      }
      break;
    }
    case 'search_execute': {
      const query = opts.query || '';
      const dir = opts.dir ?? 1;
      const wholeWord = Boolean(opts.wholeWord);
      if (!query) {
        found = false;
        break;
      }
      const match = findNextMatch(lines, origRow, origCol, query, dir, wholeWord, count);
      if (!match) {
        found = false;
      } else {
        row = match.row;
        col = match.startCol;
        desiredCol = col;
        jumped = true;
        searchMeta = { query, dir, wholeWord };
      }
      motionLabel = dir >= 0 ? `/${query}` : `?${query}`;
      break;
    }
    case 'search_next':
    case 'search_prev': {
      const ls = state.lastSearch;
      if (!ls || !ls.query) {
        found = false;
        break;
      }
      const dir = motionType === 'search_next' ? ls.dir : -ls.dir;
      const match = findNextMatch(lines, origRow, origCol, ls.query, dir, ls.wholeWord, count);
      if (!match) {
        found = false;
      } else {
        row = match.row;
        col = match.startCol;
        desiredCol = col;
        jumped = true;
      }
      motionLabel = motionType === 'search_next' ? 'n' : 'N';
      break;
    }
    case 'star':
    case 'hash': {
      const word = getWordUnderOrAfter(lines[origRow], origCol);
      if (!word) {
        found = false;
        break;
      }
      const dir = motionType === 'star' ? 1 : -1;
      const match = findNextMatch(lines, origRow, origCol, word, dir, true, count);
      if (!match) {
        found = false;
      } else {
        row = match.row;
        col = match.startCol;
        desiredCol = col;
        jumped = true;
        searchMeta = { query: word, dir, wholeWord: true };
      }
      motionLabel = motionType === 'star' ? '*' : '#';
      break;
    }
    default:
      found = false;
  }

  const moved = row !== origRow || col !== origCol;
  return {
    row,
    col,
    desiredCol,
    inclusive,
    linewise,
    moved,
    found,
    jumped: jumped && moved,
    motionLabel,
    searchMeta,
  };
}
