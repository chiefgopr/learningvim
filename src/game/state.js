import { VimEngine } from '../vim/engine.js';

function posKey(row, col) {
  return `${row}:${col}`;
}

export class GameSession {
  constructor(level, { mode = 'campaign' } = {}) {
    this.mode = mode; // 'campaign' | 'arcade' | 'sandbox'
    this.level = level;
    this.engine = new VimEngine(level.lines, level.start?.row ?? 0, level.start?.col ?? 0);

    this.wallSet = new Set((level.walls || []).map((p) => posKey(p.row, p.col)));
    this.hazardSet = new Set((level.hazards || []).map((p) => posKey(p.row, p.col)));
    this.gemsRemaining = new Set((level.gems || []).map((p) => posKey(p.row, p.col)));
    this.totalGems = this.gemsRemaining.size;
    this.editObjectives = (level.editObjectives || []).map((obj) => ({ ...obj }));

    this.keystrokes = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.hazardsHit = 0;
    this.warpsOverHazards = 0;
    this.consecutiveHL = 0;
    this.coachNudgeShown = false;

    this.keyHistory = [];
    this.motionStats = {};
    this.completed = false;
    this.failed = false;
    this.elapsedSec = 0;
    this.startedAt = null;
    this.lastOutcome = null;

    // Collect any gem at starting position just in case
    this._collectGemAt(this.engine.row, this.engine.col);
  }

  loadArcadeWave(nextLevel) {
    this.level = nextLevel;
    this.engine.loadBuffer(nextLevel.lines, nextLevel.start?.row ?? 0, nextLevel.start?.col ?? 0);
    this.wallSet = new Set((nextLevel.walls || []).map((p) => posKey(p.row, p.col)));
    this.hazardSet = new Set((nextLevel.hazards || []).map((p) => posKey(p.row, p.col)));
    this.gemsRemaining = new Set((nextLevel.gems || []).map((p) => posKey(p.row, p.col)));
    this.totalGems = this.gemsRemaining.size;
    this.editObjectives = (nextLevel.editObjectives || []).map((obj) => ({ ...obj }));
    this.completed = false;
  }

  _collectGemAt(row, col) {
    const key = posKey(row, col);
    if (this.gemsRemaining.has(key)) {
      this.gemsRemaining.delete(key);
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      const points = 100 * Math.min(this.combo, 8);
      this.score += points;
      return { collected: true, points };
    }
    return { collected: false, points: 0 };
  }

  _didWarpOverHazard(prevPos, newPos) {
    if (prevPos.row === newPos.row && Math.abs(newPos.col - prevPos.col) > 1) {
      const minC = Math.min(prevPos.col, newPos.col) + 1;
      const maxC = Math.max(prevPos.col, newPos.col) - 1;
      for (let c = minC; c <= maxC; c++) {
        if (this.hazardSet.has(posKey(prevPos.row, c))) return true;
      }
    }
    if (Math.abs(newPos.row - prevPos.row) > 1) {
      const minR = Math.min(prevPos.row, newPos.row) + 1;
      const maxR = Math.max(prevPos.row, newPos.row) - 1;
      for (const hKey of this.hazardSet) {
        const [hr] = hKey.split(':').map(Number);
        if (hr >= minR && hr <= maxR) return true;
      }
    }
    return false;
  }

  _recordMotionStat(cmdText) {
    if (!cmdText) return;
    const stripped = cmdText.replace(/^\d+/, '');
    const base = stripped.startsWith('/') ? '/'
      : stripped.startsWith('?') ? '?'
      : stripped.startsWith('f') ? 'f'
      : stripped.startsWith('F') ? 'F'
      : stripped.startsWith('t') ? 't'
      : stripped.startsWith('T') ? 'T'
      : stripped.startsWith('r') && stripped.length === 2 ? 'r'
      : stripped || cmdText;
    this.motionStats[base] = (this.motionStats[base] || 0) + 1;
  }

  getObjectiveProgress() {
    const total = this.totalGems + this.editObjectives.length;
    const doneGems = this.totalGems - this.gemsRemaining.size;
    const doneEdits = this.editObjectives.filter((o) => o.check(this.engine.lines)).length;
    return {
      done: doneGems + doneEdits,
      total: Math.max(1, total),
      doneGems,
      totalGems: this.totalGems,
      doneEdits,
      totalEdits: this.editObjectives.length,
    };
  }

  handleKey(key, modifiers = {}) {
    if (this.completed || this.failed) {
      return { ignored: true };
    }

    if (this.startedAt === null && key !== 'Escape') {
      this.startedAt = Date.now();
    }

    const snapBefore = this.engine.snapshot();
    const res = this.engine.handleKey(key, modifiers);

    if (!res.handled) {
      return {
        ...res,
        eventType: 'unhandled',
      };
    }

    if (res.keystrokeCounted) {
      this.keystrokes++;
      const displayKey = key === 'Escape' ? 'Esc'
        : key === 'Enter' ? '⏎'
        : key === 'Backspace' ? '⌫'
        : key === ' ' ? 'Space'
        : key;
      this.keyHistory.push(displayKey);
      if (this.keyHistory.length > 8) this.keyHistory.shift();
    }

    if (res.action === 'motion' || res.action === 'delete' || res.action === 'change' || res.action === 'edit' || res.action === 'yank') {
      this._recordMotionStat(res.commandText);
    }

    // Coach anti-spam check for repetitive h/l in Chapter 2+
    let coachTip = '';
    if (this.level.chapter >= 2 && (res.commandText === 'h' || res.commandText === 'l')) {
      this.consecutiveHL++;
      if (this.consecutiveHL >= 5 && !this.coachNudgeShown) {
        this.coachNudgeShown = true;
        coachTip = 'Coach Tip: Try w/b, f<char>, or /search instead of tapping h/l!';
      }
    } else if (res.action === 'motion' || res.action === 'delete' || res.action === 'change') {
      this.consecutiveHL = 0;
    }

    const landedKey = posKey(this.engine.row, this.engine.col);

    // Wall collision (revert cursor position only)
    if (this.wallSet.has(landedKey)) {
      this.engine.row = snapBefore.row;
      this.engine.col = snapBefore.col;
      this.engine.desiredCol = snapBefore.desiredCol;
      this.lastOutcome = {
        ...res,
        eventType: 'wall_bump',
        blockedAt: { row: res.newPos.row, col: res.newPos.col },
        newPos: { row: snapBefore.row, col: snapBefore.col },
        moved: false,
        message: 'Blocked by firewall (#)',
        coachTip,
      };
      return this.lastOutcome;
    }

    // Hazard collision (zap + reset combo + revert position)
    if (this.hazardSet.has(landedKey)) {
      this.engine.row = snapBefore.row;
      this.engine.col = snapBefore.col;
      this.engine.desiredCol = snapBefore.desiredCol;
      this.hazardsHit++;
      this.combo = 0;
      this.lastOutcome = {
        ...res,
        eventType: 'hazard_zap',
        zappedAt: { row: res.newPos.row, col: res.newPos.col },
        newPos: { row: snapBefore.row, col: snapBefore.col },
        moved: false,
        message: 'Zapped by laser! Combo reset.',
        coachTip,
      };
      return this.lastOutcome;
    }

    // Check warp-over-hazard bonus
    let warpBonus = 0;
    if (res.jumped && this._didWarpOverHazard(res.prevPos, res.newPos)) {
      this.warpsOverHazards++;
      warpBonus = 50;
      this.score += warpBonus;
    }

    // Collect gem if standing on one
    const gemRes = this._collectGemAt(this.engine.row, this.engine.col);

    // Check completion: all gems collected AND all edit objectives satisfied AND in NORMAL mode
    const editsPass = this.editObjectives.every((obj) => obj.check(this.engine.lines));
    const readyToComplete =
      this.mode !== 'sandbox' &&
      this.gemsRemaining.size === 0 &&
      editsPass &&
      this.engine.mode === 'NORMAL' &&
      (this.totalGems > 0 || this.editObjectives.length > 0);

    if (readyToComplete) {
      this.completed = true;
      if (this.startedAt) {
        this.elapsedSec = Math.max(0.1, Number(((Date.now() - this.startedAt) / 1000).toFixed(1)));
      }
      // Par bonus
      if (this.keystrokes <= this.level.par) {
        this.score += 300;
      } else if (this.keystrokes <= Math.ceil(this.level.par * 1.45)) {
        this.score += 150;
      }
    }

    let eventType = 'ok';
    if (this.completed) eventType = 'victory';
    else if (gemRes.collected) eventType = 'gem';
    else if (res.mutated) eventType = 'edit';
    else if (warpBonus > 0) eventType = 'warp_over';
    else if (res.jumped) eventType = 'warp';
    else if (res.moved) eventType = 'move';

    this.lastOutcome = {
      ...res,
      eventType,
      gemCollected: gemRes.collected,
      gemPoints: gemRes.points,
      warpBonus,
      coachTip,
    };
    return this.lastOutcome;
  }

  getStarRating() {
    if (!this.completed) return 0;
    if (this.keystrokes <= this.level.par && this.hazardsHit === 0) return 3;
    if (this.keystrokes <= Math.ceil(this.level.par * 1.45) && this.hazardsHit <= 1) return 2;
    return 1;
  }

  getRank() {
    const stars = this.getStarRating();
    if (stars === 3) return 'S';
    if (stars === 2) return 'A';
    return 'B';
  }
}
