import { CHAPTERS, LEVELS, getLevelById } from './game/levels.js';
import { createArcadeTask, ARCADE_SNIPPETS } from './game/arcade.js';
import { GameSession } from './game/state.js';
import { sfx } from './game/audio.js';
import {
  loadProgress,
  recordLevelCompletion,
  recordArcadeScore,
  incrementMotionStats,
  updateSettings,
} from './game/storage.js';
import { EditorRenderer } from './ui/renderer.js';
import { HudController } from './ui/hud.js';
import { ModalController } from './ui/modals.js';

const SANDBOX_LEVEL = {
  id: 'sandbox',
  number: 0,
  chapter: 6,
  title: 'Free Playground',
  isBoss: false,
  filename: 'playground.js',
  teachKeys: ['h j k l', 'w b e', 'f t ;', 'gg G %', '/ * n', 'dw dd ci" u'],
  brief: 'Experiment freely with any Vim motion, search, operator, or text object. Press r/Restart anytime to reset the buffer.',
  proTip: 'Try %, ci", /, *, dd, u, and Ctrl+r on real code!',
  relativeNumbers: true,
  par: 999,
  start: { row: 0, col: 0 },
  lines: ARCADE_SNIPPETS[0].lines,
  gems: [],
  hazards: [],
  walls: [],
  editObjectives: [],
  hintSteps: ['Explore freely — there are no hazards or timers here!'],
};

class VimQuestApp {
  constructor() {
    this.viewMenu = document.getElementById('view-menu');
    this.viewArena = document.getElementById('view-arena');
    this.chaptersGrid = document.getElementById('chapters-grid');
    this.menuStarsTotal = document.getElementById('menu-stars-total');
    this.toggleUnlockAll = document.getElementById('toggle-unlock-all');
    this.btnContinue = document.getElementById('btn-continue-quest');
    this.btnMenuMute = document.getElementById('btn-menu-mute');
    this.btnArenaMute = document.getElementById('btn-arena-mute');
    this.editorBody = document.getElementById('editor-body');

    this.renderer = new EditorRenderer();
    this.hud = new HudController();
    this.modals = new ModalController();

    this.progress = loadProgress();
    sfx.setMuted(this.progress.settings.muted);

    this.session = null;
    this.activeHintIdx = 0;
    this.activeHintText = '';
    this.lastActiveKey = '';
    this.relativeOverride = null;
    this.timerInterval = null;
    this.bossTimeLeft = null;
    this.arcadeState = null;

    this.bindEvents();
    this.renderMenu();
  }

  bindEvents() {
    this.toggleUnlockAll.checked = Boolean(this.progress.settings.unlockAll);
    this.toggleUnlockAll.addEventListener('change', () => {
      this.progress = updateSettings({ unlockAll: this.toggleUnlockAll.checked });
      this.renderMenu();
    });

    const toggleMute = () => {
      const next = !this.progress.settings.muted;
      this.progress = updateSettings({ muted: next });
      sfx.setMuted(next);
      this.syncMuteButtons();
    };
    this.btnMenuMute.addEventListener('click', toggleMute);
    this.btnArenaMute.addEventListener('click', toggleMute);
    this.syncMuteButtons();

    this.btnContinue.addEventListener('click', () => {
      const nextLvl = this.findNextUnfinishedLevel();
      this.startCampaignLevel(nextLvl.id);
    });

    document.querySelectorAll('[data-arcade]').forEach((btn) => {
      btn.addEventListener('click', () => this.startArcade(btn.dataset.arcade));
    });

    document.getElementById('btn-open-sandbox').addEventListener('click', () => this.startSandbox());
    document.getElementById('btn-back-map').addEventListener('click', () => this.showMenu());
    document.getElementById('btn-restart').addEventListener('click', () => this.restartCurrent());
    document.getElementById('btn-hint').addEventListener('click', () => this.showNextHint());

    document.getElementById('btn-toggle-rel').addEventListener('click', () => {
      const current = this.isRelativeNumbers();
      this.relativeOverride = !current;
      this.renderArena();
    });

    const openCheatSheet = () => {
      this.progress = loadProgress();
      this.modals.showCheatSheet(this.progress.motionCounts, () => this.focusEditor());
    };
    document.getElementById('btn-menu-cheatsheet').addEventListener('click', openCheatSheet);
    document.getElementById('btn-arena-cheatsheet').addEventListener('click', openCheatSheet);

    this.editorBody.addEventListener('mousedown', (e) => {
      if (this.viewArena.classList.contains('active')) {
        e.preventDefault();
        this.editorBody.focus();
        this.hud.setToast('Keep your hands on the keyboard! Use Vim motions instead of clicking.');
        this.hud.update(this.session, this.getHudOptions());
      }
    });

    window.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));
  }

  syncMuteButtons() {
    const icon = this.progress.settings.muted ? '🔇' : '🔊';
    this.btnMenuMute.textContent = icon;
    this.btnArenaMute.textContent = icon;
  }

  findNextUnfinishedLevel() {
    for (const lvl of LEVELS) {
      if (!this.progress.levels[lvl.id]?.stars) return lvl;
    }
    return LEVELS[0];
  }

  isLevelUnlocked(level) {
    if (this.progress.settings.unlockAll) return true;
    if (level.number === 1) return true;
    const prev = LEVELS[level.number - 2];
    return Boolean(prev && this.progress.levels[prev.id]?.stars > 0);
  }

  renderMenu() {
    this.progress = loadProgress();
    const totalStars = Object.values(this.progress.levels).reduce((sum, l) => sum + (l.stars || 0), 0);
    this.menuStarsTotal.textContent = `${totalStars} / ${LEVELS.length * 3} ★`;

    const nextLvl = this.findNextUnfinishedLevel();
    this.btnContinue.textContent = totalStars === 0
      ? 'Start Campaign (L1)'
      : `Continue: L${nextLvl.number} — ${nextLvl.title}`;

    this.chaptersGrid.innerHTML = '';
    for (const ch of CHAPTERS) {
      const card = document.createElement('div');
      card.className = 'chapter-card';
      card.style.setProperty('--ch-accent', ch.accent);

      const chLevels = LEVELS.filter((l) => l.chapter === ch.id);
      const keysHtml = ch.keys.map((k) => `<span class="mini-key">${k}</span>`).join('');

      card.innerHTML = `
        <div class="chapter-head">
          <div>
            <h3 class="chapter-title"><span class="chapter-num">CH ${ch.id}</span> ${ch.name}</h3>
            <p class="chapter-sub">${ch.subtitle}</p>
          </div>
          <div class="chapter-keys">${keysHtml}</div>
        </div>
        <div class="levels-list"></div>
      `;

      const listEl = card.querySelector('.levels-list');
      for (const lvl of chLevels) {
        const unlocked = this.isLevelUnlocked(lvl);
        const rec = this.progress.levels[lvl.id];
        const stars = rec?.stars || 0;
        const starText = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (lvl.isBoss ? ' is-boss' : '');
        btn.disabled = !unlocked;
        btn.innerHTML = `
          <div class="level-btn-top">
            <span>${lvl.isBoss ? '👑 BOSS' : `L${lvl.number}`} • PAR ${lvl.par}</span>
            <span class="stars-inline ${stars === 0 ? 'dim' : ''}">${starText}</span>
          </div>
          <div class="level-btn-name">${unlocked ? lvl.title : '🔒 Locked'}</div>
        `;
        btn.addEventListener('click', () => this.startCampaignLevel(lvl.id));
        listEl.appendChild(btn);
      }

      this.chaptersGrid.appendChild(card);
    }
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  showMenu() {
    this.stopTimer();
    this.modals.close();
    this.viewArena.classList.remove('active');
    this.viewMenu.classList.add('active');
    this.renderMenu();
  }

  showArena() {
    this.viewMenu.classList.remove('active');
    this.viewArena.classList.add('active');
    this.focusEditor();
  }

  focusEditor() {
    requestAnimationFrame(() => this.editorBody.focus());
  }

  startCampaignLevel(levelId) {
    const level = getLevelById(levelId) || LEVELS[0];
    this.stopTimer();
    this.modals.close();
    this.session = new GameSession(level, { mode: 'campaign' });
    this.activeHintIdx = 0;
    this.activeHintText = '';
    this.lastActiveKey = '';
    this.relativeOverride = null;
    this.arcadeState = null;
    this.bossTimeLeft = level.isBoss && level.timeLimit ? level.timeLimit : null;
    this.hud.setToast('');

    this.showArena();
    this.renderArena();

    if (this.bossTimeLeft !== null) {
      this.startCountdown(() => {
        this.bossTimeLeft = Math.max(0, this.bossTimeLeft - 0.1);
        if (this.bossTimeLeft <= 0) {
          this.stopTimer();
          this.session.failed = true;
          sfx.playFail();
          this.modals.showGameOver({
            title: `💀 ${level.bossName} Escaped!`,
            reason: 'Time ran out before all objectives were cleared.',
            score: this.session.score,
            statsLine: `${this.session.keystrokes} Keys`,
            onReplay: () => this.startCampaignLevel(level.id),
            onMap: () => this.showMenu(),
          });
        } else {
          this.hud.update(this.session, this.getHudOptions());
        }
      });
    }
  }

  startArcade(difficulty = 'apprentice') {
    this.stopTimer();
    this.modals.close();
    const task = createArcadeTask(difficulty);
    this.session = new GameSession(task, { mode: 'arcade' });
    this.activeHintIdx = 0;
    this.activeHintText = '';
    this.lastActiveKey = '';
    this.relativeOverride = null;
    this.bossTimeLeft = null;
    this.arcadeState = { difficulty, wave: 1, cleared: 0, timeLeft: 60 };
    this.hud.setToast('Arcade Blitz! Clear targets fast to earn bonus seconds!');

    this.showArena();
    this.renderArena();

    this.startCountdown(() => {
      this.arcadeState.timeLeft = Math.max(0, this.arcadeState.timeLeft - 0.1);
      if (this.arcadeState.timeLeft <= 0) {
        this.stopTimer();
        this.session.failed = true;
        sfx.playVictory();
        recordArcadeScore(difficulty, this.session.score, this.arcadeState.cleared);
        this.modals.showGameOver({
          title: `⚡ Arcade Blitz Complete!`,
          reason: `Cleared ${this.arcadeState.cleared} waves on ${difficulty.toUpperCase()} mode.`,
          score: this.session.score,
          statsLine: `${this.arcadeState.cleared} Waves • ${this.session.maxCombo}x Max Combo`,
          onReplay: () => this.startArcade(difficulty),
          onMap: () => this.showMenu(),
        });
      } else {
        this.hud.update(this.session, this.getHudOptions());
      }
    });
  }

  startSandbox() {
    this.stopTimer();
    this.modals.close();
    this.session = new GameSession(SANDBOX_LEVEL, { mode: 'sandbox' });
    this.activeHintIdx = 0;
    this.activeHintText = '';
    this.lastActiveKey = '';
    this.relativeOverride = null;
    this.bossTimeLeft = null;
    this.arcadeState = null;
    this.hud.setToast('Sandbox ready — experiment with any Vim command!');
    this.showArena();
    this.renderArena();
  }

  restartCurrent() {
    if (!this.session) return;
    if (this.session.mode === 'arcade') {
      this.startArcade(this.arcadeState?.difficulty || 'apprentice');
    } else if (this.session.mode === 'sandbox') {
      this.startSandbox();
    } else {
      this.startCampaignLevel(this.session.level.id);
    }
  }

  startCountdown(onTick) {
    this.stopTimer();
    this.timerInterval = setInterval(onTick, 100);
  }

  showNextHint() {
    if (!this.session) return;
    const steps = this.session.level.hintSteps || [];
    if (steps.length === 0) return;
    this.activeHintText = steps[this.activeHintIdx % steps.length];
    this.activeHintIdx++;
    this.hud.update(this.session, this.getHudOptions());
    this.focusEditor();
  }

  isRelativeNumbers() {
    if (this.relativeOverride !== null) return this.relativeOverride;
    return Boolean(this.session?.level?.relativeNumbers);
  }

  getHudOptions() {
    return {
      timeRemaining: this.bossTimeLeft,
      arcadeState: this.arcadeState,
      hintText: this.activeHintText,
      activeKey: this.lastActiveKey,
    };
  }

  renderArena() {
    if (!this.session) return;
    this.renderer.render(this.session, { relativeNumbers: this.isRelativeNumbers() });
    this.hud.update(this.session, this.getHudOptions());
  }

  handleGlobalKeyDown(e) {
    // Allow browser DevTools / hard refresh
    if (e.key === 'F12' || e.key === 'F5' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
      return;
    }

    if (e.key === 'F1') {
      e.preventDefault();
      if (this.modals.isOpen() && this.modals.currentType === 'cheatsheet') {
        this.modals.close();
        this.focusEditor();
      } else {
        this.progress = loadProgress();
        this.modals.showCheatSheet(this.progress.motionCounts, () => this.focusEditor());
      }
      return;
    }

    // Modal shortcuts
    if (this.modals.isOpen()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.modals.currentType === 'cheatsheet') {
          this.modals.close();
          this.focusEditor();
        } else {
          this.showMenu();
        }
        return;
      }
      if (this.modals.currentType === 'victory') {
        if (e.key === 'Enter' && this.modals.handlers.onNext) {
          e.preventDefault();
          this.modals.handlers.onNext();
        } else if (e.key === 'r') {
          e.preventDefault();
          this.modals.handlers.onReplay?.();
        } else if (e.key === 'm') {
          e.preventDefault();
          this.modals.handlers.onMap?.();
        }
      } else if (this.modals.currentType === 'gameover') {
        if (e.key === 'r' || e.key === 'Enter') {
          e.preventDefault();
          this.modals.handlers.onReplay?.();
        } else if (e.key === 'm') {
          e.preventDefault();
          this.modals.handlers.onMap?.();
        }
      }
      return;
    }

    if (!this.viewArena.classList.contains('active') || !this.session) {
      return;
    }

    // Prevent browser Quick Find (/ or '), scroll (Space/Arrows), focus jump (Tab), page nav (Backspace), button click (Enter)
    const blockBrowserKeys = new Set([
      '/', '?', "'", ' ', 'Tab', 'Backspace', 'Enter',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
    if (blockBrowserKeys.has(e.key) || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
    }

    if (e.key === 'Tab') {
      this.showNextHint();
      return;
    }

    if (['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'].includes(e.key)) {
      const map = { ArrowLeft: 'h', ArrowDown: 'j', ArrowUp: 'k', ArrowRight: 'l' };
      this.renderer.triggerShake();
      sfx.playBump();
      this.hud.setToast(`Arrow keys disabled! Use "${map[e.key]}" instead.`);
      this.hud.update(this.session, this.getHudOptions());
      return;
    }

    const res = this.session.handleKey(e.key, {
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });

    if (!res || res.ignored || res.eventType === 'unhandled') {
      return;
    }

    this.lastActiveKey = e.key;

    if (res.coachTip) {
      this.hud.setToast(res.coachTip, 3500);
    } else if (res.message) {
      this.hud.setToast(res.message, 2000);
    }

    // Audio & FX feedback
    if (res.eventType === 'wall_bump') {
      sfx.playBump();
      this.renderer.triggerShake();
    } else if (res.eventType === 'hazard_zap') {
      sfx.playZap();
      this.renderer.triggerShake();
      if (res.zappedAt) {
        this.renderer.spawnFloatBadge(res.zappedAt.row, res.zappedAt.col, 'ZAP!', 'zap');
      }
    } else if (res.eventType === 'gem') {
      sfx.playGem(this.session.combo);
      this.renderer.spawnTrail(res.prevPos, res.newPos, res.warpBonus > 0);
      this.renderer.spawnFloatBadge(
        res.newPos.row,
        res.newPos.col,
        res.warpBonus > 0 ? `+${res.gemPoints + res.warpBonus} WARP!` : `+${res.gemPoints}`,
        'gem'
      );
    } else if (res.eventType === 'warp_over') {
      sfx.playWarp();
      this.renderer.spawnTrail(res.prevPos, res.newPos, true);
      this.renderer.spawnFloatBadge(res.newPos.row, res.newPos.col, `WARP +${res.warpBonus}!`, 'warp');
    } else if (res.eventType === 'warp') {
      sfx.playWarp();
      this.renderer.spawnTrail(res.prevPos, res.newPos, false);
    } else if (res.eventType === 'edit' || res.mutated) {
      sfx.playSlash();
    } else if (res.eventType === 'move') {
      sfx.playMove();
    }

    this.renderArena();

    if (res.eventType === 'victory') {
      this.onLevelVictory();
    }
  }

  onLevelVictory() {
    incrementMotionStats(this.session.motionStats);

    if (this.session.mode === 'arcade') {
      sfx.playVictory();
      this.arcadeState.wave++;
      this.arcadeState.cleared++;
      this.arcadeState.timeLeft = Math.min(75, this.arcadeState.timeLeft + 5);
      this.session.score += 150;
      const nextTask = createArcadeTask(this.arcadeState.difficulty);
      this.session.loadArcadeWave(nextTask);
      this.hud.setToast(`Wave cleared! +5s Bonus Time!`);
      this.renderArena();
      return;
    }

    this.stopTimer();
    sfx.playVictory();

    const lvl = this.session.level;
    const stars = this.session.getStarRating();
    this.progress = recordLevelCompletion(lvl.id, {
      stars,
      keystrokes: this.session.keystrokes,
      elapsedSec: this.session.elapsedSec,
      score: this.session.score,
    });

    const nextIdx = LEVELS.findIndex((l) => l.id === lvl.id) + 1;
    const nextLvl = nextIdx > 0 && nextIdx < LEVELS.length ? LEVELS[nextIdx] : null;

    this.modals.showVictory({
      level: lvl,
      session: this.session,
      hasNext: Boolean(nextLvl),
      onNext: nextLvl ? () => this.startCampaignLevel(nextLvl.id) : null,
      onReplay: () => this.startCampaignLevel(lvl.id),
      onMap: () => this.showMenu(),
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new VimQuestApp();
});
