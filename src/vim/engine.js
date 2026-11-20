import { computeMotion, clampCol, findFirstNonBlank } from './motions.js';
import { resolveTextObject } from './textObjects.js';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead']);
const SIMPLE_MOTIONS = new Set(['h', 'j', 'k', 'l', '^', '$', 'w', 'W', 'e', 'E', 'b', 'B', '{', '}', '%', ';', ',']);
const FIND_KEYS = new Set(['f', 'F', 't', 'T']);
const OPERATORS = new Set(['d', 'c', 'y']);

export class VimEngine {
  constructor(lines = [''], startRow = 0, startCol = 0) {
    this.loadBuffer(lines, startRow, startCol);
  }

  loadBuffer(lines, startRow = 0, startCol = 0) {
    this.lines = Array.isArray(lines) && lines.length > 0 ? [...lines] : [''];
    this.row = Math.max(0, Math.min(startRow, this.lines.length - 1));
    this.col = clampCol(this.lines[this.row], startCol);
    this.desiredCol = this.col;
    this.mode = 'NORMAL';
    this.countBuffer = '';
    this.pendingOperator = null;
    this.pendingOperatorCount = null;
    this.pendingFind = null;
    this.pendingTextObj = null;
    this.lastFind = null;
    this.lastSearch = null;
    this.searchBuffer = '';
    this.searchDir = 1;
    this.searchOrigin = null;
    this.register = { text: '', linewise: false };
    this.undoStack = [];
    this.redoStack = [];
    this.lastInsertUndoSaved = false;
  }

  snapshot() {
    return {
      lines: [...this.lines],
      row: this.row,
      col: this.col,
      desiredCol: this.desiredCol,
    };
  }

  restoreSnapshot(snap) {
    this.lines = [...snap.lines];
    this.row = Math.max(0, Math.min(snap.row, this.lines.length - 1));
    this.col = clampCol(this.lines[this.row], snap.col);
    this.desiredCol = snap.desiredCol;
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  resetPending() {
    this.countBuffer = '';
    this.pendingOperator = null;
    this.pendingOperatorCount = null;
    this.pendingFind = null;
    this.pendingTextObj = null;
    if (
      this.mode === 'OPERATOR_PENDING' ||
      this.mode === 'FIND_PENDING' ||
      this.mode === 'REPLACE_PENDING' ||
      this.mode === 'G_PENDING' ||
      this.mode === 'TEXTOBJ_PENDING'
    ) {
      this.mode = 'NORMAL';
    }
  }

  getPendingDisplay() {
    let str = '';
    if (this.pendingOperatorCount) str += String(this.pendingOperatorCount);
    if (this.pendingOperator) str += this.pendingOperator;
    if (this.countBuffer) str += this.countBuffer;
    if (this.pendingTextObj) str += this.pendingTextObj;
    if (this.pendingFind) str += this.pendingFind;
    if (this.mode === 'G_PENDING') str += 'g';
    if (this.mode === 'REPLACE_PENDING') str += 'r';
    return str;
  }

  getStatus() {
    return {
      mode: this.mode,
      row: this.row,
      col: this.col,
      pending: this.getPendingDisplay(),
      searchBuffer: this.searchBuffer,
      searchDir: this.searchDir,
      lastSearch: this.lastSearch,
    };
  }

  _consumeCombinedCount() {
    const c1 = this.pendingOperatorCount ? parseInt(this.pendingOperatorCount, 10) : 1;
    const c2 = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
    return { count: c1 * c2, hasCount: Boolean(this.pendingOperatorCount || this.countBuffer) };
  }

  _applyRangeOperator(op, startRow, startCol, endRow, endCol, linewise, emptyRange = false) {
    const prevMode = this.mode;
    if (op === 'y') {
      if (linewise) {
        const sliced = this.lines.slice(startRow, endRow + 1);
        this.register = { text: sliced.join('\n'), linewise: true };
        this.row = startRow;
        this.col = clampCol(this.lines[this.row], startCol);
      } else if (emptyRange) {
        this.register = { text: '', linewise: false };
      } else {
        const text = this._extractRange(startRow, startCol, endRow, endCol);
        this.register = { text, linewise: false };
        this.row = startRow;
        this.col = clampCol(this.lines[this.row], startCol);
      }
      this.desiredCol = this.col;
      this.resetPending();
      return {
        action: 'yank',
        mutated: false,
        modeChanged: prevMode !== this.mode,
        message: 'Yanked',
      };
    }

    this.pushUndo();

    if (linewise) {
      const deletedLines = this.lines.slice(startRow, endRow + 1);
      this.register = { text: deletedLines.join('\n'), linewise: true };

      if (op === 'c') {
        const indentMatch = (this.lines[startRow] || '').match(/^\s*/);
        const indent = indentMatch ? indentMatch[0] : '';
        this.lines.splice(startRow, endRow - startRow + 1, indent);
        this.row = startRow;
        this.col = indent.length;
        this.desiredCol = this.col;
        this.resetPending();
        this.mode = 'INSERT';
        this.lastInsertUndoSaved = true;
        return {
          action: 'change',
          mutated: true,
          modeChanged: true,
          message: 'Change line',
        };
      }

      this.lines.splice(startRow, endRow - startRow + 1);
      if (this.lines.length === 0) this.lines = [''];
      this.row = Math.min(startRow, this.lines.length - 1);
      this.col = findFirstNonBlank(this.lines[this.row]);
      this.desiredCol = this.col;
      this.resetPending();
      return {
        action: 'delete',
        mutated: true,
        modeChanged: prevMode !== this.mode,
        message: `Deleted ${deletedLines.length} line(s)`,
      };
    }

    // Characterwise deletion / change
    let yanked = '';
    if (!emptyRange) {
      yanked = this._extractRange(startRow, startCol, endRow, endCol);
      this._deleteCharRange(startRow, startCol, endRow, endCol);
    }
    this.register = { text: yanked, linewise: false };

    this.row = Math.max(0, Math.min(startRow, this.lines.length - 1));
    if (op === 'c') {
      this.col = Math.min(startCol, this.lines[this.row].length);
      this.desiredCol = this.col;
      this.resetPending();
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = true;
      return {
        action: 'change',
        mutated: true,
        modeChanged: true,
        message: 'Change text',
      };
    }

    this.col = clampCol(this.lines[this.row], startCol);
    this.desiredCol = this.col;
    this.resetPending();
    return {
      action: 'delete',
      mutated: !emptyRange,
      modeChanged: prevMode !== this.mode,
      message: 'Deleted',
    };
  }

  _extractRange(sRow, sCol, eRow, eCol) {
    if (sRow === eRow) {
      return this.lines[sRow].slice(sCol, eCol + 1);
    }
    const parts = [this.lines[sRow].slice(sCol)];
    for (let r = sRow + 1; r < eRow; r++) {
      parts.push(this.lines[r]);
    }
    parts.push(this.lines[eRow].slice(0, eCol + 1));
    return parts.join('\n');
  }

  _deleteCharRange(sRow, sCol, eRow, eCol) {
    if (sRow === eRow) {
      const line = this.lines[sRow];
      this.lines[sRow] = line.slice(0, sCol) + line.slice(eCol + 1);
      return;
    }
    const prefix = this.lines[sRow].slice(0, sCol);
    const suffix = this.lines[eRow].slice(eCol + 1);
    this.lines.splice(sRow, eRow - sRow + 1, prefix + suffix);
    if (this.lines.length === 0) this.lines = [''];
  }

  _applyOperatorWithMotion(op, motionType, opts = {}) {
    const origRow = this.row;
    const origCol = this.col;
    const res = computeMotion(this, motionType, { ...opts, forOperator: op });
    if (!res.found) {
      this.resetPending();
      return { action: 'none', mutated: false, modeChanged: true, message: 'Target not found' };
    }

    if (res.linewise) {
      const sRow = Math.min(origRow, res.row);
      const eRow = Math.max(origRow, res.row);
      return this._applyRangeOperator(op, sRow, 0, eRow, 0, true);
    }

    const forward = res.row > origRow || (res.row === origRow && res.col >= origCol);
    let sRow, sCol, eRow, eCol;

    if (forward) {
      sRow = origRow;
      sCol = origCol;
      if (res.inclusive) {
        eRow = res.row;
        eCol = Math.min(res.col, Math.max(0, this.lines[eRow].length - 1));
      } else {
        // Exclusive forward: up to col - 1
        if (res.col > 0) {
          eRow = res.row;
          eCol = res.col - 1;
        } else if (res.row > origRow) {
          eRow = res.row - 1;
          eCol = Math.max(0, this.lines[eRow].length - 1);
        } else {
          // Empty range
          return this._applyRangeOperator(op, sRow, sCol, sRow, sCol, false, true);
        }
      }
    } else {
      // Backward characterwise: target is inclusive, origin is exclusive
      sRow = res.row;
      sCol = res.col;
      if (origCol > 0) {
        eRow = origRow;
        eCol = origCol - 1;
      } else if (origRow > sRow) {
        eRow = origRow - 1;
        eCol = Math.max(0, this.lines[eRow].length - 1);
      } else {
        return this._applyRangeOperator(op, sRow, sCol, sRow, sCol, false, true);
      }
    }

    const emptyRange = sRow > eRow || (sRow === eRow && sCol > eCol);
    return this._applyRangeOperator(op, sRow, sCol, eRow, eCol, false, emptyRange);
  }

  _executeMotion(motionType, opts = {}) {
    const prevPos = { row: this.row, col: this.col };
    const res = computeMotion(this, motionType, opts);
    if (res.found) {
      this.row = res.row;
      this.col = clampCol(this.lines[this.row], res.col);
      this.desiredCol = res.desiredCol;
      if (res.searchMeta) {
        this.lastSearch = res.searchMeta;
      }
    }
    return { prevPos, res };
  }

  handleKey(key, modifiers = {}) {
    if (MODIFIER_KEYS.has(key)) {
      return {
        handled: false,
        keystrokeCounted: false,
        action: 'modifier',
        commandText: '',
        prevPos: { row: this.row, col: this.col },
        newPos: { row: this.row, col: this.col },
        moved: false,
        jumped: false,
        mutated: false,
        modeChanged: false,
        message: '',
      };
    }

    const prevPos = { row: this.row, col: this.col };
    const prevMode = this.mode;

    // 1. SEARCH MODE
    if (this.mode === 'SEARCH') {
      if (key === 'Escape') {
        if (this.searchOrigin) {
          this.row = this.searchOrigin.row;
          this.col = this.searchOrigin.col;
          this.desiredCol = this.searchOrigin.desiredCol;
        }
        this.searchBuffer = '';
        this.searchOrigin = null;
        this.mode = 'NORMAL';
        return this._result(true, true, 'search_cancel', 'Esc', prevPos, prevMode, { message: 'Search cancelled' });
      }
      if (key === 'Backspace') {
        this.searchBuffer = this.searchBuffer.slice(0, -1);
        return this._result(true, false, 'search_type', 'BS', prevPos, prevMode, { message: '' });
      }
      if (key === 'Enter') {
        const query = this.searchBuffer;
        const dir = this.searchDir;
        this.mode = 'NORMAL';
        this.searchOrigin = null;
        this.searchBuffer = '';
        if (!query) {
          return this._result(true, true, 'search_empty', 'Enter', prevPos, prevMode, { message: 'Empty search' });
        }
        const { res } = this._executeMotion('search_execute', { query, dir, wholeWord: false });
        return this._result(true, true, 'motion', res.motionLabel, prevPos, prevMode, {
          jumped: res.jumped,
          message: res.found ? `Found "${query}"` : `Pattern not found: ${query}`,
        });
      }
      if (key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey) {
        this.searchBuffer += key;
        return this._result(true, true, 'search_type', key, prevPos, prevMode, { message: '' });
      }
      return this._result(true, false, 'ignored', '', prevPos, prevMode);
    }

    // 2. INSERT MODE
    if (this.mode === 'INSERT') {
      if (key === 'Escape') {
        this.mode = 'NORMAL';
        this.col = clampCol(this.lines[this.row], Math.max(0, this.col - 1));
        this.desiredCol = this.col;
        this.lastInsertUndoSaved = false;
        return this._result(true, true, 'mode', 'Esc', prevPos, prevMode, { message: 'NORMAL mode' });
      }
      if (!this.lastInsertUndoSaved) {
        this.pushUndo();
        this.lastInsertUndoSaved = true;
      }
      if (key === 'Backspace') {
        if (this.col > 0) {
          const line = this.lines[this.row];
          this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col);
          this.col--;
          this.desiredCol = this.col;
          return this._result(true, true, 'edit', 'BS', prevPos, prevMode, { mutated: true });
        } else if (this.row > 0) {
          const prevLineLen = this.lines[this.row - 1].length;
          this.lines[this.row - 1] += this.lines[this.row];
          this.lines.splice(this.row, 1);
          this.row--;
          this.col = prevLineLen;
          this.desiredCol = this.col;
          return this._result(true, true, 'edit', 'BS', prevPos, prevMode, { mutated: true });
        }
        return this._result(true, true, 'edit', 'BS', prevPos, prevMode);
      }
      if (key === 'Enter') {
        const line = this.lines[this.row];
        const before = line.slice(0, this.col);
        const after = line.slice(this.col);
        this.lines.splice(this.row, 1, before, after);
        this.row++;
        this.col = 0;
        this.desiredCol = 0;
        return this._result(true, true, 'edit', 'Enter', prevPos, prevMode, { mutated: true });
      }
      if (key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey) {
        const line = this.lines[this.row];
        this.lines[this.row] = line.slice(0, this.col) + key + line.slice(this.col);
        this.col++;
        this.desiredCol = this.col;
        return this._result(true, true, 'edit', key, prevPos, prevMode, { mutated: true });
      }
      return this._result(false, false, 'ignored', '', prevPos, prevMode);
    }

    // Escape cancels any pending state in Normal-family modes
    if (key === 'Escape') {
      this.resetPending();
      return this._result(true, true, 'cancel', 'Esc', prevPos, prevMode, { message: 'Cleared' });
    }

    // 3. REPLACE PENDING (r<char>)
    if (this.mode === 'REPLACE_PENDING') {
      if (key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey) {
        const line = this.lines[this.row];
        if (line.length > 0 && this.col < line.length) {
          this.pushUndo();
          this.lines[this.row] = line.slice(0, this.col) + key + line.slice(this.col + 1);
          this.resetPending();
          return this._result(true, true, 'edit', `r${key}`, prevPos, prevMode, {
            mutated: true,
            message: `Replaced with '${key}'`,
          });
        }
      }
      this.resetPending();
      return this._result(true, true, 'cancel', key, prevPos, prevMode);
    }

    // 4. FIND PENDING (f/F/t/T + char)
    if (this.mode === 'FIND_PENDING') {
      const findType = this.pendingFind;
      if (key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey) {
        const { count } = this._consumeCombinedCount();
        this.lastFind = { type: findType, char: key };

        if (this.pendingOperator) {
          const op = this.pendingOperator;
          const cmd = `${this.getPendingDisplay()}${key}`;
          const opRes = this._applyOperatorWithMotion(op, findType, { char: key, count });
          return this._result(true, true, opRes.action, cmd, prevPos, prevMode, opRes);
        }

        const cmd = `${this.countBuffer}${findType}${key}`;
        this.resetPending();
        const { res } = this._executeMotion(findType, { char: key, count });
        return this._result(true, true, 'motion', cmd, prevPos, prevMode, {
          jumped: res.jumped,
          message: res.found ? `${findType}${key}` : `No '${key}' found`,
        });
      }
      this.resetPending();
      return this._result(true, true, 'cancel', key, prevPos, prevMode);
    }

    // 5. TEXT OBJECT PENDING (di", ci(, etc.)
    if (this.mode === 'TEXTOBJ_PENDING') {
      const inner = this.pendingTextObj === 'i';
      const op = this.pendingOperator;
      const prefix = `${op}${this.pendingTextObj}`;
      const range = resolveTextObject(this.lines, this.row, this.col, inner, key);
      if (!range) {
        this.resetPending();
        return this._result(true, true, 'none', `${prefix}${key}`, prevPos, prevMode, {
          message: `No text object '${this.pendingTextObj}${key}' found`,
        });
      }
      const opRes = this._applyRangeOperator(
        op,
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
        false,
        Boolean(range.empty)
      );
      return this._result(true, true, opRes.action, `${prefix}${key}`, prevPos, prevMode, opRes);
    }

    // 6. G PENDING (gg)
    if (this.mode === 'G_PENDING') {
      if (key === 'g') {
        const { count, hasCount } = this._consumeCombinedCount();
        const op = this.pendingOperator;
        const prefix = this.getPendingDisplay();
        if (op) {
          const opRes = this._applyOperatorWithMotion(op, 'gg', { count, hasCount });
          return this._result(true, true, opRes.action, `${prefix}g`, prevPos, prevMode, opRes);
        }
        this.resetPending();
        const { res } = this._executeMotion('gg', { count, hasCount });
        return this._result(true, true, 'motion', res.motionLabel, prevPos, prevMode, {
          jumped: res.jumped,
          message: `Line ${this.row + 1}`,
        });
      }
      this.resetPending();
      return this._result(true, true, 'cancel', key, prevPos, prevMode);
    }

    // Ctrl+r -> Redo
    if (modifiers.ctrlKey && (key === 'r' || key === 'R')) {
      this.resetPending();
      if (this.redoStack.length === 0) {
        return this._result(true, true, 'none', 'Ctrl+r', prevPos, prevMode, { message: 'Already at newest change' });
      }
      this.undoStack.push(this.snapshot());
      const next = this.redoStack.pop();
      this.restoreSnapshot(next);
      return this._result(true, true, 'redo', 'Ctrl+r', prevPos, prevMode, {
        mutated: true,
        message: 'Redo',
      });
    }

    // Ignore other Ctrl/Meta/Alt shortcuts so browser hotkeys still behave cleanly
    if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) {
      return this._result(false, false, 'ignored', '', prevPos, prevMode);
    }

    // 7. Count digits (1-9 always start/extend count; 0 extends count ONLY if countBuffer is non-empty)
    if (/^[1-9]$/.test(key) || (key === '0' && this.countBuffer !== '')) {
      this.countBuffer += key;
      return this._result(true, true, 'count', key, prevPos, prevMode, { message: '' });
    }

    // 8. OPERATOR PENDING (d, c, y)
    if (this.mode === 'OPERATOR_PENDING') {
      const op = this.pendingOperator;

      // Double operator: dd, cc, yy
      if (key === op) {
        const { count } = this._consumeCombinedCount();
        const sRow = this.row;
        const eRow = Math.min(this.lines.length - 1, this.row + count - 1);
        const cmd = `${this.getPendingDisplay()}${key}`;
        const opRes = this._applyRangeOperator(op, sRow, 0, eRow, 0, true);
        return this._result(true, true, opRes.action, cmd, prevPos, prevMode, opRes);
      }

      if (key === 'i' || key === 'a') {
        this.pendingTextObj = key;
        this.mode = 'TEXTOBJ_PENDING';
        return this._result(true, true, 'pending', key, prevPos, prevMode, { message: '' });
      }

      if (FIND_KEYS.has(key)) {
        this.pendingFind = key;
        this.mode = 'FIND_PENDING';
        return this._result(true, true, 'pending', key, prevPos, prevMode, { message: '' });
      }

      if (key === 'g') {
        this.mode = 'G_PENDING';
        return this._result(true, true, 'pending', 'g', prevPos, prevMode, { message: '' });
      }

      if (key === '0' || key === 'G' || SIMPLE_MOTIONS.has(key)) {
        const { count, hasCount } = this._consumeCombinedCount();
        const cmd = `${this.getPendingDisplay()}${key}`;
        const opRes = this._applyOperatorWithMotion(op, key, { count, hasCount });
        return this._result(true, true, opRes.action, cmd, prevPos, prevMode, opRes);
      }

      this.resetPending();
      return this._result(true, true, 'cancel', key, prevPos, prevMode, { message: 'Cancelled operator' });
    }

    // 9. NORMAL MODE
    if (key === '0') {
      this.resetPending();
      const { res } = this._executeMotion('0', { count: 1 });
      return this._result(true, true, 'motion', '0', prevPos, prevMode, { jumped: res.jumped });
    }

    if (SIMPLE_MOTIONS.has(key)) {
      const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
      const cmd = `${this.countBuffer}${key}`;
      this.resetPending();
      const { res } = this._executeMotion(key, { count, hasCount: cmd !== key });
      const msg = !res.found && (key === ';' || key === ',' || key === '%') ? 'No match' : '';
      return this._result(true, true, 'motion', cmd, prevPos, prevMode, {
        jumped: res.jumped,
        message: msg,
      });
    }

    if (key === 'G') {
      const hasCount = this.countBuffer !== '';
      const count = hasCount ? parseInt(this.countBuffer, 10) : 1;
      const cmd = `${this.countBuffer}G`;
      this.resetPending();
      const { res } = this._executeMotion('G', { count, hasCount });
      return this._result(true, true, 'motion', cmd, prevPos, prevMode, {
        jumped: res.jumped,
        message: `Line ${this.row + 1}`,
      });
    }

    if (key === 'g') {
      this.mode = 'G_PENDING';
      return this._result(true, true, 'pending', 'g', prevPos, prevMode, { message: '' });
    }

    if (FIND_KEYS.has(key)) {
      this.pendingFind = key;
      this.mode = 'FIND_PENDING';
      return this._result(true, true, 'pending', key, prevPos, prevMode, { message: '' });
    }

    if (OPERATORS.has(key)) {
      this.pendingOperator = key;
      this.pendingOperatorCount = this.countBuffer || null;
      this.countBuffer = '';
      this.mode = 'OPERATOR_PENDING';
      return this._result(true, true, 'pending', key, prevPos, prevMode, { message: '' });
    }

    // Search initiation
    if (key === '/' || key === '?') {
      this.resetPending();
      this.searchOrigin = this.snapshot();
      this.searchBuffer = '';
      this.searchDir = key === '/' ? 1 : -1;
      this.mode = 'SEARCH';
      return this._result(true, true, 'search_start', key, prevPos, prevMode, { message: '' });
    }

    if (key === 'n' || key === 'N') {
      const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
      this.resetPending();
      const motion = key === 'n' ? 'search_next' : 'search_prev';
      const { res } = this._executeMotion(motion, { count });
      return this._result(true, true, 'motion', key, prevPos, prevMode, {
        jumped: res.jumped,
        message: res.found ? '' : 'No search pattern / match',
      });
    }

    if (key === '*' || key === '#') {
      const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
      this.resetPending();
      const { res } = this._executeMotion(key === '*' ? 'star' : 'hash', { count });
      return this._result(true, true, 'motion', key, prevPos, prevMode, {
        jumped: res.jumped,
        message: res.found ? `Matched "${res.searchMeta?.query}"` : 'No word under cursor',
      });
    }

    // Single-key edits & mode switches
    if (key === 'x') {
      const count = this.countBuffer ? parseInt(this.countBuffer, 10) : 1;
      this.resetPending();
      const line = this.lines[this.row];
      if (line.length === 0) {
        return this._result(true, true, 'none', 'x', prevPos, prevMode);
      }
      this.pushUndo();
      const delEnd = Math.min(line.length, this.col + count);
      const deleted = line.slice(this.col, delEnd);
      this.register = { text: deleted, linewise: false };
      this.lines[this.row] = line.slice(0, this.col) + line.slice(delEnd);
      this.col = clampCol(this.lines[this.row], this.col);
      this.desiredCol = this.col;
      return this._result(true, true, 'delete', 'x', prevPos, prevMode, {
        mutated: true,
        message: `Zapped '${deleted}'`,
      });
    }

    if (key === 'r') {
      this.resetPending();
      this.mode = 'REPLACE_PENDING';
      return this._result(true, true, 'pending', 'r', prevPos, prevMode, { message: '' });
    }

    if (key === 'D' || key === 'C') {
      const op = key === 'D' ? 'd' : 'c';
      this.resetPending();
      const line = this.lines[this.row];
      if (line.length === 0) {
        if (op === 'c') {
          this.pushUndo();
          this.mode = 'INSERT';
          this.lastInsertUndoSaved = true;
          return this._result(true, true, 'change', key, prevPos, prevMode, { mutated: false });
        }
        return this._result(true, true, 'none', key, prevPos, prevMode);
      }
      const opRes = this._applyRangeOperator(op, this.row, this.col, this.row, line.length - 1, false);
      return this._result(true, true, opRes.action, key, prevPos, prevMode, opRes);
    }

    if (key === 'p' || key === 'P') {
      this.resetPending();
      if (!this.register.text) {
        return this._result(true, true, 'none', key, prevPos, prevMode, { message: 'Register empty' });
      }
      this.pushUndo();
      if (this.register.linewise) {
        const regLines = this.register.text.split('\n');
        const insertAt = key === 'p' ? this.row + 1 : this.row;
        this.lines.splice(insertAt, 0, ...regLines);
        this.row = insertAt;
        this.col = findFirstNonBlank(this.lines[this.row]);
        this.desiredCol = this.col;
      } else {
        const line = this.lines[this.row];
        const insertCol = key === 'p' ? Math.min(line.length, this.col + 1) : this.col;
        this.lines[this.row] = line.slice(0, insertCol) + this.register.text + line.slice(insertCol);
        this.col = clampCol(this.lines[this.row], insertCol + this.register.text.length - 1);
        this.desiredCol = this.col;
      }
      return this._result(true, true, 'paste', key, prevPos, prevMode, {
        mutated: true,
        message: 'Pasted',
      });
    }

    if (key === 'i') {
      this.resetPending();
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = false;
      return this._result(true, true, 'mode', 'i', prevPos, prevMode, { message: 'INSERT mode' });
    }
    if (key === 'a') {
      this.resetPending();
      if (this.lines[this.row].length > 0) {
        this.col = Math.min(this.lines[this.row].length, this.col + 1);
      }
      this.desiredCol = this.col;
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = false;
      return this._result(true, true, 'mode', 'a', prevPos, prevMode, { message: 'INSERT mode' });
    }
    if (key === 'I') {
      this.resetPending();
      this.col = findFirstNonBlank(this.lines[this.row]);
      this.desiredCol = this.col;
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = false;
      return this._result(true, true, 'mode', 'I', prevPos, prevMode, { message: 'INSERT mode' });
    }
    if (key === 'A') {
      this.resetPending();
      this.col = this.lines[this.row].length;
      this.desiredCol = this.col;
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = false;
      return this._result(true, true, 'mode', 'A', prevPos, prevMode, { message: 'INSERT mode' });
    }
    if (key === 'o' || key === 'O') {
      this.resetPending();
      this.pushUndo();
      const indentMatch = (this.lines[this.row] || '').match(/^\s*/);
      const indent = indentMatch ? indentMatch[0] : '';
      const insertRow = key === 'o' ? this.row + 1 : this.row;
      this.lines.splice(insertRow, 0, indent);
      this.row = insertRow;
      this.col = indent.length;
      this.desiredCol = this.col;
      this.mode = 'INSERT';
      this.lastInsertUndoSaved = true;
      return this._result(true, true, 'edit', key, prevPos, prevMode, {
        mutated: true,
        message: 'INSERT mode',
      });
    }

    if (key === 'u') {
      this.resetPending();
      if (this.undoStack.length === 0) {
        return this._result(true, true, 'none', 'u', prevPos, prevMode, { message: 'Already at oldest change' });
      }
      this.redoStack.push(this.snapshot());
      const prev = this.undoStack.pop();
      this.restoreSnapshot(prev);
      return this._result(true, true, 'undo', 'u', prevPos, prevMode, {
        mutated: true,
        message: 'Undo',
      });
    }

    return this._result(false, false, 'unhandled', key, prevPos, prevMode);
  }

  _result(handled, keystrokeCounted, action, commandText, prevPos, prevMode, extra = {}) {
    const newPos = { row: this.row, col: this.col };
    const moved = newPos.row !== prevPos.row || newPos.col !== prevPos.col;
    return {
      handled,
      keystrokeCounted,
      action,
      commandText,
      prevPos,
      newPos,
      moved,
      jumped: Boolean(extra.jumped && moved),
      mutated: Boolean(extra.mutated),
      modeChanged: extra.modeChanged ?? (this.mode !== prevMode),
      message: extra.message || '',
    };
  }
}
