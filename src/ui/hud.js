const GUIDE_ITEMS = [
  { key: 'h', desc: 'left', chapter: 1 },
  { key: 'j', desc: 'down', chapter: 1 },
  { key: 'k', desc: 'up', chapter: 1 },
  { key: 'l', desc: 'right', chapter: 1 },
  { key: 'w', desc: 'word→', chapter: 2 },
  { key: 'b', desc: '←word', chapter: 2 },
  { key: 'e', desc: 'end→', chapter: 2 },
  { key: 'W', desc: 'WORD→', chapter: 2 },
  { key: '0', desc: 'col0', chapter: 3 },
  { key: '^', desc: 'indent', chapter: 3 },
  { key: '$', desc: 'EOL', chapter: 3 },
  { key: 'f', desc: 'find→', chapter: 3 },
  { key: 't', desc: 'till→', chapter: 3 },
  { key: ';', desc: 'rep', chapter: 3 },
  { key: 'gg', desc: 'top', chapter: 4 },
  { key: 'G', desc: 'bot', chapter: 4 },
  { key: '%', desc: 'match', chapter: 4 },
  { key: '{', desc: '↑para', chapter: 4 },
  { key: '}', desc: '↓para', chapter: 4 },
  { key: '/', desc: 'search', chapter: 5 },
  { key: 'n', desc: 'next', chapter: 5 },
  { key: '*', desc: '*word', chapter: 5 },
  { key: 'x', desc: 'del', chapter: 6 },
  { key: 'r', desc: 'rep', chapter: 6 },
  { key: 'd', desc: 'cut', chapter: 6 },
  { key: 'c', desc: 'chg', chapter: 6 },
  { key: 'u', desc: 'undo', chapter: 6 },
];

export class HudController {
  constructor() {
    this.levelBadge = document.getElementById('hud-level-badge');
    this.levelTitle = document.getElementById('hud-level-title');
    this.bossHud = document.getElementById('hud-boss-hud');
    this.bossName = document.getElementById('hud-boss-name');
    this.bossHp = document.getElementById('hud-boss-hp');
    this.timerEl = document.getElementById('hud-timer');
    this.arcadeHud = document.getElementById('hud-arcade-hud');
    this.arcadeWave = document.getElementById('hud-arcade-wave');
    this.arcadeCleared = document.getElementById('hud-arcade-cleared');
    this.arcadeTimer = document.getElementById('hud-arcade-timer');

    this.keysEl = document.getElementById('hud-keys');
    this.comboEl = document.getElementById('hud-combo');
    this.scoreEl = document.getElementById('hud-score');
    this.briefEl = document.getElementById('mission-brief');
    this.teachKeysEl = document.getElementById('mission-keys');
    this.objectivesEl = document.getElementById('mission-objectives');
    this.hintEl = document.getElementById('mission-hint');

    this.chromeFilename = document.getElementById('chrome-filename');
    this.chromeProgress = document.getElementById('chrome-progress');

    this.statusMode = document.getElementById('status-mode');
    this.statusFile = document.getElementById('status-file');
    this.statusCenter = document.getElementById('status-center');
    this.statusPending = document.getElementById('status-pending');
    this.statusTape = document.getElementById('status-tape');
    this.statusPos = document.getElementById('status-pos');
    this.keyGuideBar = document.getElementById('key-guide-bar');

    this.toastText = '';
    this.toastTimer = null;
  }

  setToast(text, durationMs = 2400) {
    this.toastText = text;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (text) {
      this.toastTimer = setTimeout(() => {
        this.toastText = '';
        if (!this.statusCenter.classList.contains('search-active')) {
          this.statusCenter.textContent = '';
        }
      }, durationMs);
    }
  }

  renderKeyGuide(chapterNum, activeKey = '') {
    this.keyGuideBar.innerHTML = '';
    for (const item of GUIDE_ITEMS) {
      const el = document.createElement('div');
      const unlocked = item.chapter <= (chapterNum || 6);
      const isPressed = activeKey && (item.key === activeKey || item.key === activeKey.slice(-1));
      el.className = 'guide-key' + (unlocked ? ' unlocked' : '') + (isPressed ? ' active-press' : '');
      el.innerHTML = `<span>${item.key}</span><small>${item.desc}</small>`;
      this.keyGuideBar.appendChild(el);
    }
  }

  update(session, { timeRemaining = null, arcadeState = null, hintText = '', activeKey = '' } = {}) {
    const level = session.level;
    const engine = session.engine;

    if (session.mode === 'arcade') {
      this.levelBadge.textContent = `ARCADE • ${level.difficulty?.toUpperCase() || 'BLITZ'}`;
      this.levelTitle.textContent = level.title;
    } else if (session.mode === 'sandbox') {
      this.levelBadge.textContent = 'SANDBOX';
      this.levelTitle.textContent = 'Free Playground';
    } else {
      this.levelBadge.textContent = `Ch ${level.chapter} • L${level.number}`;
      this.levelTitle.textContent = level.title;
    }

    // Boss HUD
    if (level.isBoss && session.mode === 'campaign') {
      this.bossHud.classList.remove('hidden');
      this.bossName.textContent = level.bossName || 'BOSS';
      const prog = session.getObjectiveProgress();
      const hpPct = Math.max(0, Math.round(((prog.total - prog.done) / prog.total) * 100));
      this.bossHp.style.width = `${hpPct}%`;
      if (timeRemaining !== null) {
        this.timerEl.textContent = `${Math.max(0, timeRemaining).toFixed(1)}s`;
        this.timerEl.classList.toggle('urgent', timeRemaining <= 10);
      }
    } else {
      this.bossHud.classList.add('hidden');
    }

    // Arcade HUD
    if (session.mode === 'arcade' && arcadeState) {
      this.arcadeHud.classList.remove('hidden');
      this.arcadeWave.textContent = `WAVE ${arcadeState.wave}`;
      this.arcadeCleared.textContent = `${arcadeState.cleared} Cleared`;
      this.arcadeTimer.textContent = `${Math.max(0, arcadeState.timeLeft).toFixed(1)}s`;
      this.arcadeTimer.classList.toggle('urgent', arcadeState.timeLeft <= 10);
    } else {
      this.arcadeHud.classList.add('hidden');
    }

    this.keysEl.textContent = session.mode === 'sandbox'
      ? String(session.keystrokes)
      : `${session.keystrokes} / ${level.par}`;
    this.comboEl.textContent = `${session.combo}x`;
    this.scoreEl.textContent = String(session.score);

    this.briefEl.textContent = level.brief;
    this.teachKeysEl.innerHTML = '';
    for (const tk of level.teachKeys || []) {
      const span = document.createElement('span');
      span.className = 'teach-pill';
      span.textContent = tk;
      this.teachKeysEl.appendChild(span);
    }

    if (session.editObjectives.length > 0) {
      this.objectivesEl.classList.remove('hidden');
      this.objectivesEl.innerHTML = '';
      for (const obj of session.editObjectives) {
        const done = obj.check(engine.lines);
        const pill = document.createElement('div');
        pill.className = 'obj-pill' + (done ? ' done' : '');
        pill.textContent = `${done ? '✓' : '○'} ${obj.label}`;
        this.objectivesEl.appendChild(pill);
      }
    } else {
      this.objectivesEl.classList.add('hidden');
    }

    if (hintText) {
      this.hintEl.classList.remove('hidden');
      this.hintEl.textContent = `💡 Hint: ${hintText}`;
    } else {
      this.hintEl.classList.add('hidden');
    }

    this.chromeFilename.textContent = level.filename || 'buffer.txt';
    const prog = session.getObjectiveProgress();
    if (session.mode === 'sandbox') {
      this.chromeProgress.textContent = 'Practice Mode';
    } else if (session.editObjectives.length > 0) {
      this.chromeProgress.textContent = `${prog.doneEdits} / ${prog.totalEdits} Edits`;
    } else {
      this.chromeProgress.textContent = `${prog.doneGems} / ${prog.totalGems} Gems`;
    }

    // Statusline
    const modeLabel = engine.mode === 'INSERT' ? 'INSERT'
      : engine.mode === 'SEARCH' ? 'SEARCH'
      : engine.mode === 'NORMAL' ? 'NORMAL'
      : 'PENDING';
    this.statusMode.textContent = modeLabel;
    this.statusMode.className = 'mode-badge ' + (
      engine.mode === 'INSERT' ? 'mode-insert'
      : engine.mode === 'SEARCH' ? 'mode-search'
      : engine.mode === 'NORMAL' ? 'mode-normal'
      : 'mode-pending'
    );
    this.statusFile.textContent = level.filename || 'buffer.txt';

    if (engine.mode === 'SEARCH') {
      const prefix = engine.searchDir >= 0 ? '/' : '?';
      this.statusCenter.textContent = `${prefix}${engine.searchBuffer}▌`;
      this.statusCenter.classList.add('search-active');
    } else {
      this.statusCenter.classList.remove('search-active');
      this.statusCenter.textContent = this.toastText || '';
    }

    this.statusPending.textContent = engine.getPendingDisplay();

    this.statusTape.innerHTML = '';
    for (const k of session.keyHistory) {
      const span = document.createElement('span');
      span.className = 'tape-key';
      span.textContent = k;
      this.statusTape.appendChild(span);
    }

    this.statusPos.textContent = `Ln ${engine.row + 1}, Col ${engine.col + 1}`;
    this.renderKeyGuide(level.chapter, activeKey);
  }
}
