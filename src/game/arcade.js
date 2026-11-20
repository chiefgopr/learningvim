export const ARCADE_SNIPPETS = [
  {
    filename: 'router.js',
    lines: [
      'export async function handleRequest(req, res) {',
      '  const token = req.headers["x-auth-token"] || "guest";',
      '  const route = matchPath(req.url, ["/api/v1", "/health"]);',
      '  if (!route) {',
      '    return res.status(404).json({ error: "NotFound", code: 404 });',
      '  }',
      '  const payload = await route.exec(token, req.body);',
      '  return res.status(200).json({ ok: true, data: payload });',
      '}',
    ],
  },
  {
    filename: 'shader.rs',
    lines: [
      'pub fn render_frame(buf: &mut [u32], width: usize) {',
      '    let stride = width * 4;',
      '    for y in 0..16 {',
      '        let row_offset = y * stride;',
      '        buf[row_offset] = blend_pixel(0xFF00AA, 0.75);',
      '    }',
      '    emit_telemetry("frame_complete", stride);',
      '}',
    ],
  },
  {
    filename: 'pipeline.py',
    lines: [
      'def normalize_batch(records, scale=1.0):',
      '    cleaned = []',
      '    for item in records:',
      '        score = round(item["raw"] * scale, 3)',
      '        cleaned.append({"id": item["id"], "score": score})',
      '    return {"count": len(cleaned), "items": cleaned}',
    ],
  },
  {
    filename: 'config.json',
    lines: [
      '{',
      '  "service": "vimquest-core",',
      '  "replicas": 4,',
      '  "endpoints": ["us-east", "eu-west", "ap-south"],',
      '  "retry": { "maxAttempts": 5, "backoffMs": 250 },',
      '  "featureFlags": { "warpTrail": true, "soundSynth": true }',
      '}',
    ],
  },
  {
    filename: 'worker.ts',
    lines: [
      'class TaskQueue {',
      '  private pending: string[] = ["alpha", "beta", "gamma"];',
      '  enqueue(jobId: string): number {',
      '    this.pending.push(jobId);',
      '    return this.pending.length;',
      '  }',
      '  drainAll(): string[] {',
      '    return this.pending.splice(0, this.pending.length);',
      '  }',
      '}',
    ],
  },
  {
    filename: 'matrix.go',
    lines: [
      'func MultiplyScale(grid [][]int, factor int) int {',
      '    total := 0',
      '    for r := 0; r < len(grid); r++ {',
      '        for c := 0; c < len(grid[r]); c++ {',
      '            total += grid[r][c] * factor',
      '        }',
      '    }',
      '    return total',
      '}',
    ],
  },
];

function collectCandidates(lines) {
  const candidates = [];
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      if (/\S/.test(line[c])) {
        candidates.push({ row: r, col: c });
      }
    }
  }
  return candidates;
}

function pickRandom(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function buildEditBounty(lines, rng) {
  const copy = [...lines];
  const strategies = ['zap_char', 'delete_word', 'clear_quotes'];
  const strategy = pickRandom(strategies, rng);

  if (strategy === 'clear_quotes') {
    const quoteRows = [];
    for (let r = 0; r < copy.length; r++) {
      const m = copy[r].match(/"([^"]{2,20})"/);
      if (m) quoteRows.push({ row: r, match: m[0], inner: m[1] });
    }
    if (quoteRows.length > 0) {
      const chosen = pickRandom(quoteRows, rng);
      const expected = copy[chosen.row].replace(chosen.match, '""');
      const targetToken = chosen.inner;
      return {
        lines: copy,
        gems: [],
        hazards: [],
        start: { row: 0, col: 0 },
        editObjectives: [
          {
            id: 'arcade-diq',
            label: `Clear "${targetToken}" inside quotes (di")`,
            highlightPattern: targetToken,
            check: (ls) => ls.includes(expected),
          },
        ],
      };
    }
  }

  if (strategy === 'delete_word') {
    const r = Math.floor(rng() * copy.length);
    const line = copy[r];
    const injectIdx = Math.max(0, line.search(/\S/));
    const injected = line.slice(0, injectIdx) + 'BUGGY ' + line.slice(injectIdx);
    const original = copy[r];
    copy[r] = injected;
    return {
      lines: copy,
      gems: [],
      hazards: [],
      start: { row: 0, col: 0 },
      editObjectives: [
        {
          id: 'arcade-dw',
          label: 'Delete "BUGGY " (use dw)',
          highlightPattern: 'BUGGY ',
          check: (ls) => ls.includes(original),
        },
      ],
    };
  }

  // Fallback / zap_char: inject a lone 'X' or '@' bug character to zap with x
  const nonEmptyRows = copy.map((l, idx) => ({ l, idx })).filter((o) => o.l.trim().length > 4);
  const chosenRow = nonEmptyRows.length > 0 ? pickRandom(nonEmptyRows, rng).idx : 0;
  const line = copy[chosenRow];
  const pos = Math.max(1, Math.min(line.length - 1, Math.floor(line.length / 2)));
  const original = line;
  copy[chosenRow] = line.slice(0, pos) + '¤' + line.slice(pos);
  return {
    lines: copy,
    gems: [],
    hazards: [],
    start: { row: 0, col: 0 },
    editObjectives: [
      {
        id: 'arcade-x',
        label: 'Zap the "¤" glitch character (use x)',
        highlightPattern: '¤',
        check: (ls) => ls.includes(original),
      },
    ],
  };
}

/**
 * Generates an Arcade Blitz round for the requested difficulty ('apprentice' | 'adept' | 'master').
 */
export function createArcadeTask(difficulty = 'apprentice', snippetIdx = null, rng = Math.random) {
  const idx = snippetIdx !== null
    ? Math.abs(snippetIdx) % ARCADE_SNIPPETS.length
    : Math.floor(rng() * ARCADE_SNIPPETS.length);
  const snippet = ARCADE_SNIPPETS[idx];

  if (difficulty === 'master' && rng() < 0.45) {
    const bounty = buildEditBounty(snippet.lines, rng);
    return {
      id: `arcade-${Date.now()}-${Math.floor(rng() * 1000)}`,
      number: 0,
      chapter: 6,
      title: 'Arcade Bounty',
      isBoss: false,
      isArcade: true,
      difficulty,
      filename: snippet.filename,
      teachKeys: ['/', 'f', 'dw', 'di"', 'x'],
      brief: bounty.editObjectives[0].label,
      proTip: 'Blitz Bonus: Clear targets fast to keep the combo clock ticking!',
      relativeNumbers: true,
      par: 8,
      start: bounty.start,
      lines: bounty.lines,
      gems: bounty.gems,
      hazards: bounty.hazards,
      walls: [],
      editObjectives: bounty.editObjectives,
      hintSteps: [bounty.editObjectives[0].label],
    };
  }

  const lines = [...snippet.lines];
  const candidates = collectCandidates(lines);
  const gemCount = difficulty === 'apprentice' ? 3 : difficulty === 'adept' ? 4 : 5;
  const hazardCount = difficulty === 'apprentice' ? 0 : difficulty === 'adept' ? 4 : 7;

  const picked = [];
  const used = new Set();

  // Start cursor at first non-blank on row 0
  const startCol = Math.max(0, lines[0].search(/\S/));
  const start = { row: 0, col: startCol };
  used.add(`${start.row}:${start.col}`);

  let attempts = 0;
  while (picked.length < gemCount && attempts < 200) {
    attempts++;
    const cand = pickRandom(candidates, rng);
    const key = `${cand.row}:${cand.col}`;
    if (used.has(key)) continue;
    used.add(key);
    picked.push(cand);
  }

  const hazards = [];
  attempts = 0;
  while (hazards.length < hazardCount && attempts < 200) {
    attempts++;
    const cand = pickRandom(candidates, rng);
    const key = `${cand.row}:${cand.col}`;
    if (used.has(key)) continue;
    // Keep neighbors of start open
    if (cand.row === start.row && Math.abs(cand.col - start.col) <= 1) continue;
    used.add(key);
    hazards.push(cand);
  }

  return {
    id: `arcade-${Date.now()}-${Math.floor(rng() * 1000)}`,
    number: 0,
    chapter: difficulty === 'apprentice' ? 3 : difficulty === 'adept' ? 5 : 6,
    title: `Arcade Blitz (${difficulty})`,
    isBoss: false,
    isArcade: true,
    difficulty,
    filename: snippet.filename,
    teachKeys: difficulty === 'apprentice'
      ? ['w', 'b', 'f', '$', 'j', 'k']
      : ['w', 'W', 'f', 't', '/', '*', '%'],
    brief: `Collect ${picked.length} gems across ${snippet.filename}${hazards.length ? ' while leaping lasers!' : '!'}`,
    proTip: 'Use /search, f<char>, w, and {count}j/k to blaze through Arcade targets.',
    relativeNumbers: difficulty !== 'apprentice',
    par: picked.length * 3,
    start,
    lines,
    gems: picked,
    hazards,
    walls: [],
    editObjectives: [],
    hintSteps: ['Use w, f<char>, or /pattern to reach each highlighted gem rapidly.'],
  };
}
