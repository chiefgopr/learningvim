import test from 'node:test';
import assert from 'node:assert/strict';

import { VimEngine } from '../src/vim/engine.js';
import { findMatchingBracket, findAllMatches } from '../src/vim/motions.js';
import { resolveTextObject } from '../src/vim/textObjects.js';
import { LEVELS, CHAPTERS } from '../src/game/levels.js';
import { GameSession } from '../src/game/state.js';
import { createArcadeTask } from '../src/game/arcade.js';
import { createServer } from '../server.js';

function pressKeys(engine, keys) {
  for (const k of keys) {
    if (k === 'Ctrl+r') {
      engine.handleKey('r', { ctrlKey: true });
    } else {
      engine.handleKey(k, {});
    }
  }
}

test('Basic h j k l motions with counts and desiredCol preservation', () => {
  const eng = new VimEngine([
    'const longVariableName = 12345;',
    'short',
    'const anotherLongLine = 67890;',
  ], 0, 0);

  pressKeys(eng, ['1', '0', 'l']);
  assert.equal(eng.row, 0);
  assert.equal(eng.col, 10);

  // Move down to short line -> col clamps to 4, but desiredCol stays 10
  pressKeys(eng, ['j']);
  assert.equal(eng.row, 1);
  assert.equal(eng.col, 4);

  // Move down to long line -> col restores to 10
  pressKeys(eng, ['j']);
  assert.equal(eng.row, 2);
  assert.equal(eng.col, 10);

  pressKeys(eng, ['2', 'k', '3', 'h']);
  assert.equal(eng.row, 0);
  assert.equal(eng.col, 7);
});

test('Word and WORD motions (w, W, b, B, e, E) and multi-line wrapping', () => {
  const eng = new VimEngine([
    'foo.bar   baz-qux',
    'nextLine()',
  ], 0, 0);

  pressKeys(eng, ['w']); // '.'
  assert.equal(eng.col, 3);
  pressKeys(eng, ['w']); // 'bar'
  assert.equal(eng.col, 4);
  pressKeys(eng, ['e']); // 'r'
  assert.equal(eng.col, 6);
  pressKeys(eng, ['W']); // 'baz-qux'
  assert.equal(eng.col, 10);
  pressKeys(eng, ['E']); // 'x'
  assert.equal(eng.col, 16);
  pressKeys(eng, ['w']); // wraps to row 1 col 0
  assert.equal(eng.row, 1);
  assert.equal(eng.col, 0);
  pressKeys(eng, ['B']); // back to 'baz-qux'
  assert.equal(eng.row, 0);
  assert.equal(eng.col, 10);
  pressKeys(eng, ['b']); // back to 'bar'
  assert.equal(eng.col, 4);
});

test('Line anchors (0, ^, $) and 0 inside numeric count (10j)', () => {
  const lines = Array.from({ length: 15 }, (_, i) => `    line_${i} = ${i};`);
  const eng = new VimEngine(lines, 0, 8);

  pressKeys(eng, ['^']);
  assert.equal(eng.col, 4);
  pressKeys(eng, ['0']);
  assert.equal(eng.col, 0);
  pressKeys(eng, ['$']);
  assert.equal(eng.col, lines[0].length - 1);

  // Move down preserves sticky $
  pressKeys(eng, ['1', '0', 'j']);
  assert.equal(eng.row, 10);
  assert.equal(eng.col, lines[10].length - 1);
});

test('Find/Till motions (f, F, t, T, ;, ,) including repeated t without getting stuck', () => {
  const eng = new VimEngine(['a1, b2, c3, d4;'], 0, 0);

  pressKeys(eng, ['t', ',']);
  assert.equal(eng.col, 1); // '1'
  pressKeys(eng, [';']);
  assert.equal(eng.col, 5); // '2'
  pressKeys(eng, [';']);
  assert.equal(eng.col, 9); // '3'
  pressKeys(eng, [',']);
  assert.equal(eng.col, 7); // ' ' right after second ','

  pressKeys(eng, ['0', '2', 'f', ',']);
  assert.equal(eng.col, 6);
  pressKeys(eng, ['F', '1']);
  assert.equal(eng.col, 1);
});

test('Vertical & structural jumps (gg, G, {count}G, {, }, %)', () => {
  const eng = new VimEngine([
    'function test() {',
    '  const a = [1, 2];',
    '',
    '  return (a[0] + 1);',
    '}',
  ], 2, 0);

  pressKeys(eng, ['g', 'g']);
  assert.deepEqual([eng.row, eng.col], [0, 0]);

  pressKeys(eng, ['%']); // scans forward to '(' at col 13, jumps to ')' at col 14
  assert.deepEqual([eng.row, eng.col], [0, 14]);

  pressKeys(eng, ['$', '%']); // '{' -> '}'
  assert.deepEqual([eng.row, eng.col], [4, 0]);

  pressKeys(eng, ['{']); // blank line at row 2
  assert.equal(eng.row, 2);

  pressKeys(eng, ['}']); // last line row 4
  assert.equal(eng.row, 4);

  pressKeys(eng, ['2', 'G']);
  assert.deepEqual([eng.row, eng.col], [1, 2]);
});

test('Search (/ ? n N * #) with wrap-around and Escape restore', () => {
  const eng = new VimEngine([
    'let foo = 1; // foo_bar',
    'let bar = 2;',
    'let foo = 3;',
    'let baz = foo;',
  ], 0, 4);

  // * matches whole word 'foo', skipping 'foo_bar'
  pressKeys(eng, ['*']);
  assert.deepEqual([eng.row, eng.col], [2, 4]);
  pressKeys(eng, ['n']);
  assert.deepEqual([eng.row, eng.col], [3, 10]);
  pressKeys(eng, ['N']);
  assert.deepEqual([eng.row, eng.col], [2, 4]);
  pressKeys(eng, ['#']);
  assert.deepEqual([eng.row, eng.col], [0, 4]);

  // Escape cancels search and restores origin
  pressKeys(eng, ['/', 'b', 'a', 'z', 'Escape']);
  assert.equal(eng.mode, 'NORMAL');
  assert.deepEqual([eng.row, eng.col], [0, 4]);

  // Forward search submit
  pressKeys(eng, ['/', 'b', 'a', 'z', 'Enter']);
  assert.deepEqual([eng.row, eng.col], [3, 4]);

  // Backward search submit
  pressKeys(eng, ['?', 'b', 'a', 'r', 'Enter']);
  assert.deepEqual([eng.row, eng.col], [1, 4]);
});

test('Operators, edits, text objects, undo and redo', () => {
  const eng = new VimEngine([
    'const msg = "hello world";',
    'delete me line',
    'call(arg1, arg2);',
    'const obj = { a: 1, b: 2 };',
  ], 0, 0);

  // ci"
  pressKeys(eng, ['c', 'i', '"', 'v', 'i', 'm', 'Escape']);
  assert.equal(eng.mode, 'NORMAL');
  assert.equal(eng.lines[0], 'const msg = "vim";');

  // Undo & Redo
  pressKeys(eng, ['u']);
  assert.equal(eng.lines[0], 'const msg = "hello world";');
  pressKeys(eng, ['Ctrl+r']);
  assert.equal(eng.lines[0], 'const msg = "vim";');

  // dd + p
  pressKeys(eng, ['j', 'd', 'd']);
  assert.equal(eng.lines.length, 3);
  assert.equal(eng.lines[1], 'call(arg1, arg2);');

  // di(
  pressKeys(eng, ['d', 'i', '(']);
  assert.equal(eng.lines[1], 'call();');

  // di{
  pressKeys(eng, ['j', 'd', 'i', '{']);
  assert.equal(eng.lines[2], 'const obj = {};');

  // dw + D + x + r
  const eng2 = new VimEngine(['one two three', 'abcd'], 0, 0);
  pressKeys(eng2, ['d', 'w']);
  assert.equal(eng2.lines[0], 'two three');
  pressKeys(eng2, ['w', 'D']);
  assert.equal(eng2.lines[0], 'two ');
  pressKeys(eng2, ['j', '0', 'x', 'r', 'Z']);
  assert.equal(eng2.lines[1], 'Zcd');
});

test('Helper utilities findMatchingBracket, findAllMatches, and resolveTextObject', () => {
  const match = findMatchingBracket(['fn(a, [b, c])'], 0, 0);
  assert.deepEqual(match, { row: 0, col: 12, fromRow: 0, fromCol: 2 });

  const matches = findAllMatches(['foo foo_bar (foo)'], 'foo', true);
  assert.equal(matches.length, 2);

  const innerQuote = resolveTextObject(['say "hi"'], 0, 0, true, '"');
  assert.deepEqual(innerQuote, { startRow: 0, startCol: 5, endRow: 0, endCol: 6 });

  const outerParen = resolveTextObject(['fn(x, y)'], 0, 5, false, ')');
  assert.deepEqual(outerParen, { startRow: 0, startCol: 2, endRow: 0, endCol: 7 });
});

test('Bare modifier keys are never counted as keystrokes', () => {
  const session = new GameSession(LEVELS[0]);
  const res = session.handleKey('Shift', { shiftKey: true });
  assert.equal(res.handled, false);
  assert.equal(session.keystrokes, 0);
});

test('Campaign structure and ALL 24 levels are valid, in-bounds, solvable, and pass at or below PAR', () => {
  assert.equal(CHAPTERS.length, 6);
  assert.equal(LEVELS.length, 24);

  for (const level of LEVELS) {
    assert.ok(Array.isArray(level.lines) && level.lines.length > 0, `${level.id} must have lines`);
    assert.ok(Array.isArray(level.solutionKeys) && level.solutionKeys.length > 0, `${level.id} must have solutionKeys`);

    const inBounds = (p) =>
      p.row >= 0 &&
      p.row < level.lines.length &&
      p.col >= 0 &&
      p.col <= Math.max(0, level.lines[p.row].length - 1);

    assert.ok(inBounds(level.start), `${level.id} start out of bounds`);

    const hazardKeys = new Set((level.hazards || []).map((h) => `${h.row}:${h.col}`));
    const wallKeys = new Set((level.walls || []).map((w) => `${w.row}:${w.col}`));
    assert.ok(!hazardKeys.has(`${level.start.row}:${level.start.col}`), `${level.id} start overlaps hazard`);
    assert.ok(!wallKeys.has(`${level.start.row}:${level.start.col}`), `${level.id} start overlaps wall`);

    for (const g of level.gems || []) {
      assert.ok(inBounds(g), `${level.id} gem (${g.row},${g.col}) out of bounds`);
      assert.ok(!hazardKeys.has(`${g.row}:${g.col}`), `${level.id} gem overlaps hazard`);
      assert.ok(!wallKeys.has(`${g.row}:${g.col}`), `${level.id} gem overlaps wall`);
    }

    const session = new GameSession(level);
    for (const key of level.solutionKeys) {
      session.handleKey(key, {});
    }

    assert.equal(session.completed, true, `${level.id} (${level.title}) failed to complete with solutionKeys`);
    assert.equal(session.hazardsHit, 0, `${level.id} hit a hazard during solutionKeys`);
    assert.ok(
      session.keystrokes <= level.par,
      `${level.id} took ${session.keystrokes} keystrokes > par ${level.par}`
    );
    assert.equal(session.getStarRating(), 3, `${level.id} did not achieve 3 stars`);
  }
});

test('Arcade Blitz generator produces valid tasks across all 3 difficulties', () => {
  for (const diff of ['apprentice', 'adept', 'master']) {
    for (let i = 0; i < 6; i++) {
      const task = createArcadeTask(diff, i, () => 0.25);
      assert.ok(task.lines.length > 0);
      const hasObjective = (task.gems?.length || 0) > 0 || (task.editObjectives?.length || 0) > 0;
      assert.ok(hasObjective, `Arcade ${diff} wave ${i} missing objective`);
      const session = new GameSession(task, { mode: 'arcade' });
      assert.equal(session.completed, false);
    }
  }
});

test('Static HTTP server serves index.html, blocks path traversal, and returns 404 for missing paths', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;

    const rHtml = await fetch(`${base}/`);
    assert.equal(rHtml.status, 200);
    assert.match(rHtml.headers.get('content-type') || '', /text\/html/);

    const rCss = await fetch(`${base}/styles.css`);
    assert.equal(rCss.status, 200);
    assert.match(rCss.headers.get('content-type') || '', /text\/css/);

    const r1 = await fetch(`${base}/src/vim/engine.js`);
    assert.equal(r1.status, 200);
    assert.match(r1.headers.get('content-type') || '', /javascript/);

    const r2 = await fetch(`${base}/../etc/passwd`);
    assert.ok(r2.status === 403 || r2.status === 404);

    const r3 = await fetch(`${base}/does-not-exist.xyz`);
    assert.equal(r3.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
