import { findMatchingBracket, findAllMatches } from '../vim/motions.js';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'export', 'async', 'await',
  'if', 'else', 'for', 'in', 'def', 'pub', 'fn', 'class', 'private', 'func',
  'true', 'false', 'null', 'import', 'from',
]);

function classifyLineTokens(line) {
  const classes = new Array(line.length).fill('tok-id');
  const trimmed = line.trimStart();

  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    classes.fill('tok-com');
    return classes;
  }

  // Inline comment detection outside quotes
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      classes[i] = 'tok-str';
      if (ch === inQuote && line[i - 1] !== '\\') inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inQuote = ch;
      classes[i] = 'tok-str';
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') {
      for (let j = i; j < line.length; j++) classes[j] = 'tok-com';
      break;
    }
  }

  // Keywords & numbers outside strings/comments
  const wordRe = /\b([a-zA-Z_][a-zA-Z0-9_]*|\d+(?:\.\d+)?)\b/g;
  let m;
  while ((m = wordRe.exec(line)) !== null) {
    const start = m.index;
    const tok = m[0];
    if (classes[start] === 'tok-str' || classes[start] === 'tok-com') continue;
    if (/^\d/.test(tok)) {
      for (let i = start; i < start + tok.length; i++) classes[i] = 'tok-num';
    } else if (KEYWORDS.has(tok)) {
      for (let i = start; i < start + tok.length; i++) classes[i] = 'tok-kw';
    }
  }

  for (let i = 0; i < line.length; i++) {
    if (classes[i] === 'tok-str' || classes[i] === 'tok-com') continue;
    if ('=+-*/<>!&|:'.includes(line[i])) classes[i] = 'tok-op';
    else if ('()[]{},.;'.includes(line[i])) classes[i] = 'tok-punc';
  }

  return classes;
}

export class EditorRenderer {
  constructor() {
    this.gutterEl = document.getElementById('editor-gutter');
    this.gridEl = document.getElementById('code-grid');
    this.cursorEl = document.getElementById('cursor-knight');
    this.trailSvg = document.getElementById('trail-svg');
    this.floatLayer = document.getElementById('float-layer');
    this.editorWindow = document.getElementById('editor-window');
    this.codeStage = document.getElementById('code-stage');
    this.cellRefs = [];
  }

  render(session, { relativeNumbers = false } = {}) {
    const engine = session.engine;
    const lines = engine.lines;

    // Bracket portal highlight
    const bracketMatch = findMatchingBracket(lines, engine.row, engine.col);
    const bracketKeys = new Set();
    if (bracketMatch) {
      bracketKeys.add(`${bracketMatch.fromRow}:${bracketMatch.fromCol}`);
      bracketKeys.add(`${bracketMatch.row}:${bracketMatch.col}`);
    }

    // Search match highlight
    const searchQuery = engine.mode === 'SEARCH'
      ? engine.searchBuffer
      : (engine.lastSearch?.query || '');
    const searchWhole = engine.mode === 'SEARCH' ? false : Boolean(engine.lastSearch?.wholeWord);
    const searchMatches = searchQuery ? findAllMatches(lines, searchQuery, searchWhole) : [];
    const searchKeys = new Set();
    for (const sm of searchMatches) {
      for (let c = sm.startCol; c < sm.endCol; c++) {
        searchKeys.add(`${sm.row}:${c}`);
      }
    }

    // Active Chapter 6 glitch highlight spans
    const glitchKeys = new Set();
    for (const obj of session.editObjectives) {
      if (!obj.check(lines) && obj.highlightPattern) {
        for (let r = 0; r < lines.length; r++) {
          const idx = lines[r].indexOf(obj.highlightPattern);
          if (idx !== -1) {
            for (let c = idx; c < idx + obj.highlightPattern.length; c++) {
              glitchKeys.add(`${r}:${c}`);
            }
          }
        }
      }
    }

    // Gutter
    this.gutterEl.innerHTML = '';
    for (let r = 0; r < lines.length; r++) {
      const numEl = document.createElement('div');
      numEl.className = 'gutter-num' + (r === engine.row ? ' active-row' : '');
      if (relativeNumbers) {
        numEl.textContent = r === engine.row ? String(r + 1) : String(Math.abs(r - engine.row));
      } else {
        numEl.textContent = String(r + 1);
      }
      this.gutterEl.appendChild(numEl);
    }

    // Code Grid
    this.gridEl.innerHTML = '';
    this.cellRefs = [];

    for (let r = 0; r < lines.length; r++) {
      const line = lines[r];
      const lineEl = document.createElement('div');
      lineEl.className = 'code-line' + (r === engine.row ? ' active-line' : '');

      const tokClasses = classifyLineTokens(line);
      const rowCells = [];
      const renderLen = Math.max(1, line.length);

      for (let c = 0; c < renderLen; c++) {
        const ch = c < line.length ? line[c] : ' ';
        const cell = document.createElement('span');
        const key = `${r}:${c}`;
        const classes = ['cell', c < line.length ? tokClasses[c] : 'tok-id'];

        if (session.gemsRemaining.has(key)) classes.push('tile-gem');
        if (session.hazardSet.has(key)) classes.push('tile-hazard');
        if (session.wallSet.has(key)) classes.push('tile-wall');
        if (glitchKeys.has(key)) classes.push('tile-glitch');
        if (bracketKeys.has(key)) classes.push('tile-bracket');
        if (searchKeys.has(key)) classes.push('tile-search');

        cell.className = classes.join(' ');
        cell.textContent = ch;
        lineEl.appendChild(cell);
        rowCells.push(cell);
      }

      // Extra trailing phantom cell for Insert mode at EOL
      if (engine.mode === 'INSERT' && r === engine.row && engine.col >= line.length && line.length > 0) {
        const eolCell = document.createElement('span');
        eolCell.className = 'cell';
        eolCell.textContent = ' ';
        lineEl.appendChild(eolCell);
        rowCells.push(eolCell);
      }

      this.gridEl.appendChild(lineEl);
      this.cellRefs.push(rowCells);
    }

    this.updateCursor(engine);
  }

  getCellRect(row, col) {
    const rowCells = this.cellRefs[row];
    if (!rowCells || rowCells.length === 0) return null;
    const clampedCol = Math.max(0, Math.min(col, rowCells.length - 1));
    const cell = rowCells[clampedCol];
    return {
      left: cell.offsetLeft,
      top: cell.offsetTop,
      width: cell.offsetWidth || 10,
      height: cell.offsetHeight || 22,
    };
  }

  updateCursor(engine) {
    const rect = this.getCellRect(engine.row, engine.col);
    if (!rect) return;

    this.cursorEl.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    this.cursorEl.style.width = `${rect.width}px`;
    this.cursorEl.style.height = `${rect.height}px`;

    this.cursorEl.classList.remove('mode-normal', 'mode-insert', 'mode-pending', 'mode-search');
    if (engine.mode === 'INSERT') {
      this.cursorEl.classList.add('mode-insert');
    } else if (engine.mode === 'SEARCH') {
      this.cursorEl.classList.add('mode-search');
    } else if (engine.mode !== 'NORMAL') {
      this.cursorEl.classList.add('mode-pending');
    } else {
      this.cursorEl.classList.add('mode-normal');
    }
  }

  spawnTrail(prevPos, newPos, isWarpBonus = false) {
    if (!prevPos || !newPos) return;
    if (prevPos.row === newPos.row && prevPos.col === newPos.col) return;
    const r1 = this.getCellRect(prevPos.row, prevPos.col);
    const r2 = this.getCellRect(newPos.row, newPos.col);
    if (!r1 || !r2) return;

    const x1 = r1.left + r1.width / 2;
    const y1 = r1.top + r1.height / 2;
    const x2 = r2.left + r2.width / 2;
    const y2 = r2.top + r2.height / 2;

    const mx = (x1 + x2) / 2;
    const arcLift = Math.min(34, Math.max(10, Math.hypot(x2 - x1, y2 - y1) * 0.22));
    const my = Math.min(y1, y2) - arcLift;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
    path.setAttribute('class', 'trail-path' + (isWarpBonus ? ' warp-bonus' : ''));
    this.trailSvg.appendChild(path);

    setTimeout(() => {
      path.remove();
    }, 600);
  }

  spawnFloatBadge(row, col, text, kind = 'gem') {
    const rect = this.getCellRect(row, col);
    if (!rect) return;
    const badge = document.createElement('div');
    badge.className = `float-badge ${kind}`;
    badge.textContent = text;
    badge.style.left = `${rect.left + rect.width / 2}px`;
    badge.style.top = `${rect.top}px`;
    this.floatLayer.appendChild(badge);
    setTimeout(() => badge.remove(), 780);
  }

  triggerShake() {
    this.editorWindow.classList.remove('shake');
    void this.editorWindow.offsetWidth;
    this.editorWindow.classList.add('shake');
  }
}
