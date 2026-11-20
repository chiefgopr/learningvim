const CHEATSHEET_GROUPS = [
  {
    title: 'Home Row & Counts',
    items: [
      { key: 'h / j / k / l', desc: 'Move Left / Down / Up / Right', statKeys: ['h', 'j', 'k', 'l'] },
      { key: '5j / 4k', desc: 'Jump N lines down or up', statKeys: ['j', 'k'] },
    ],
  },
  {
    title: 'Word Warping',
    items: [
      { key: 'w / W', desc: 'Next word / WORD start', statKeys: ['w', 'W'] },
      { key: 'b / B', desc: 'Prev word / WORD start', statKeys: ['b', 'B'] },
      { key: 'e / E', desc: 'End of word / WORD', statKeys: ['e', 'E'] },
    ],
  },
  {
    title: 'Line & Sniper Find',
    items: [
      { key: '0 / ^ / $', desc: 'Col 0 / First non-blank / End of line', statKeys: ['0', '^', '$'] },
      { key: 'f<c> / F<c>', desc: 'Jump ONTO char forward / backward', statKeys: ['f', 'F'] },
      { key: 't<c> / T<c>', desc: 'Jump TILL before char fwd / bwd', statKeys: ['t', 'T'] },
      { key: '; / ,', desc: 'Repeat last find same / reverse dir', statKeys: [';', ','] },
    ],
  },
  {
    title: 'Vertical & Portals',
    items: [
      { key: 'gg / G', desc: 'Top of file / Bottom (or {n}G)', statKeys: ['gg', 'G'] },
      { key: '{ / }', desc: 'Jump prev / next blank paragraph', statKeys: ['{', '}'] },
      { key: '%', desc: 'Jump to matching (), [], {} bracket', statKeys: ['%'] },
    ],
  },
  {
    title: 'Search & Lock',
    items: [
      { key: '/ / ?', desc: 'Search forward / backward + Enter', statKeys: ['/', '?'] },
      { key: 'n / N', desc: 'Next / Previous search match', statKeys: ['n', 'N'] },
      { key: '* / #', desc: 'Search whole word under cursor fwd / bwd', statKeys: ['*', '#'] },
    ],
  },
  {
    title: 'Operators & Text Objects',
    items: [
      { key: 'x / r<c>', desc: 'Delete char / Replace char', statKeys: ['x', 'r'] },
      { key: 'dw / dd / D', desc: 'Delete word / line / to EOL', statKeys: ['dw', 'dd', 'D'] },
      { key: 'di" / ci"', desc: 'Delete / Change inside quotes', statKeys: ['di"', 'ci"'] },
      { key: 'di( / di{', desc: 'Clear inside parens / braces', statKeys: ['di(', 'di{'] },
      { key: 'u / Ctrl+r', desc: 'Undo / Redo', statKeys: ['u', 'Ctrl+r'] },
    ],
  },
];

export class ModalController {
  constructor() {
    this.overlay = document.getElementById('modal-overlay');
    this.card = document.getElementById('modal-card');
    this.currentType = null;
    this.handlers = {};
  }

  isOpen() {
    return !this.overlay.classList.contains('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
    this.card.innerHTML = '';
    this.currentType = null;
    this.handlers = {};
  }

  showVictory({ level, session, hasNext, onNext, onReplay, onMap }) {
    this.currentType = 'victory';
    this.handlers = { onNext, onReplay, onMap };
    const stars = session.getStarRating();
    const starGlyphs = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    const rank = session.getRank();

    this.card.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${level.isBoss ? `🏆 Boss Defeated: ${level.bossName}!` : `✨ Level ${level.number} Complete!`}</h2>
        <span class="level-badge">RANK ${rank}</span>
      </div>
      <div class="victory-stars">${starGlyphs}</div>
      <div class="victory-stats">
        <div class="vstat">
          <div class="vstat-label">Keystrokes</div>
          <div class="vstat-val">${session.keystrokes} / ${level.par}</div>
        </div>
        <div class="vstat">
          <div class="vstat-label">Max Combo</div>
          <div class="vstat-val">${session.maxCombo}x</div>
        </div>
        <div class="vstat">
          <div class="vstat-label">Time</div>
          <div class="vstat-val">${session.elapsedSec.toFixed(1)}s</div>
        </div>
        <div class="vstat">
          <div class="vstat-label">Score</div>
          <div class="vstat-val">${session.score}</div>
        </div>
      </div>
      <div class="pro-tip-box">
        <strong>Vim Pro Tip:</strong> ${level.proTip}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="m-btn-map">Map <kbd>m</kbd></button>
        <button type="button" class="btn btn-amber" id="m-btn-replay">Replay <kbd>r</kbd></button>
        ${hasNext ? '<button type="button" class="btn btn-primary" id="m-btn-next">Next Level <kbd>Enter</kbd></button>' : ''}
      </div>
    `;

    this.overlay.classList.remove('hidden');
    this.card.querySelector('#m-btn-map')?.addEventListener('click', () => onMap?.());
    this.card.querySelector('#m-btn-replay')?.addEventListener('click', () => onReplay?.());
    this.card.querySelector('#m-btn-next')?.addEventListener('click', () => onNext?.());
  }

  showGameOver({ title, reason, score, statsLine, onReplay, onMap }) {
    this.currentType = 'gameover';
    this.handlers = { onReplay, onMap };
    this.card.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">${title}</h2>
      </div>
      <p style="margin:0;color:var(--text-muted);">${reason}</p>
      <div class="victory-stats" style="grid-template-columns:1fr 1fr;">
        <div class="vstat">
          <div class="vstat-label">Final Score</div>
          <div class="vstat-val">${score}</div>
        </div>
        <div class="vstat">
          <div class="vstat-label">Summary</div>
          <div class="vstat-val" style="font-size:0.95rem;">${statsLine}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="m-btn-map">World Map <kbd>m</kbd></button>
        <button type="button" class="btn btn-primary" id="m-btn-replay">Play Again <kbd>r</kbd></button>
      </div>
    `;
    this.overlay.classList.remove('hidden');
    this.card.querySelector('#m-btn-map')?.addEventListener('click', () => onMap?.());
    this.card.querySelector('#m-btn-replay')?.addEventListener('click', () => onReplay?.());
  }

  showCheatSheet(motionCounts = {}, onClose) {
    this.currentType = 'cheatsheet';
    this.handlers = { onClose };

    const groupsHtml = CHEATSHEET_GROUPS.map((g) => {
      const rows = g.items.map((item) => {
        const count = item.statKeys.reduce((acc, k) => acc + (motionCounts[k] || 0), 0);
        return `
          <div class="cs-row">
            <span class="cs-key">${item.key}</span>
            <span class="cs-desc">${item.desc}</span>
            <span class="cs-count">${count}×</span>
          </div>
        `;
      }).join('');
      return `<div class="cs-group"><h4>${g.title}</h4>${rows}</div>`;
    }).join('');

    this.card.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">⌨️ Vim Reference &amp; Motion Mastery</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="m-btn-close">Close <kbd>Esc</kbd></button>
      </div>
      <div class="cheatsheet-grid">${groupsHtml}</div>
    `;

    this.overlay.classList.remove('hidden');
    this.card.querySelector('#m-btn-close')?.addEventListener('click', () => {
      this.close();
      onClose?.();
    });
  }
}
