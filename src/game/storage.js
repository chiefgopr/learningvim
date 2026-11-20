const STORAGE_KEY = 'vimquest_progress_v1';

const DEFAULT_STATE = {
  levels: {}, // { [levelId]: { stars, bestKeys, bestTime, bestScore } }
  arcade: {
    apprentice: { bestScore: 0, bestTargets: 0 },
    adept: { bestScore: 0, bestTargets: 0 },
    master: { bestScore: 0, bestTargets: 0 },
  },
  motionCounts: {}, // { [motion]: number }
  settings: {
    muted: false,
    relativeNumbers: false,
    unlockAll: false,
    showKeyGuide: true,
  },
};

let memoryFallback = null;

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function getStorageBackend() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return null;
}

export function loadProgress() {
  const backend = getStorageBackend();
  if (!backend) {
    if (!memoryFallback) memoryFallback = cloneDefault();
    return JSON.parse(JSON.stringify(memoryFallback));
  }
  try {
    const raw = backend.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    const base = cloneDefault();
    return {
      levels: { ...base.levels, ...(parsed.levels || {}) },
      arcade: {
        apprentice: { ...base.arcade.apprentice, ...(parsed.arcade?.apprentice || {}) },
        adept: { ...base.arcade.adept, ...(parsed.arcade?.adept || {}) },
        master: { ...base.arcade.master, ...(parsed.arcade?.master || {}) },
      },
      motionCounts: { ...(parsed.motionCounts || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return cloneDefault();
  }
}

export function saveProgress(data) {
  const backend = getStorageBackend();
  if (!backend) {
    memoryFallback = JSON.parse(JSON.stringify(data));
    return;
  }
  try {
    backend.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

export function recordLevelCompletion(levelId, { stars, keystrokes, elapsedSec, score }) {
  const data = loadProgress();
  const prev = data.levels[levelId] || { stars: 0, bestKeys: Infinity, bestTime: Infinity, bestScore: 0 };
  data.levels[levelId] = {
    stars: Math.max(prev.stars, stars),
    bestKeys: Math.min(prev.bestKeys, keystrokes),
    bestTime: Math.min(prev.bestTime, elapsedSec),
    bestScore: Math.max(prev.bestScore, score),
  };
  saveProgress(data);
  return data;
}

export function recordArcadeScore(difficulty, score, targetsCleared) {
  const data = loadProgress();
  const prev = data.arcade[difficulty] || { bestScore: 0, bestTargets: 0 };
  data.arcade[difficulty] = {
    bestScore: Math.max(prev.bestScore, score),
    bestTargets: Math.max(prev.bestTargets, targetsCleared),
  };
  saveProgress(data);
  return data;
}

export function incrementMotionStats(motionCountsMap) {
  if (!motionCountsMap) return;
  const data = loadProgress();
  for (const [key, count] of Object.entries(motionCountsMap)) {
    data.motionCounts[key] = (data.motionCounts[key] || 0) + count;
  }
  saveProgress(data);
  return data;
}

export function updateSettings(partial) {
  const data = loadProgress();
  data.settings = { ...data.settings, ...partial };
  saveProgress(data);
  return data;
}

export function resetProgress() {
  const fresh = cloneDefault();
  saveProgress(fresh);
  return fresh;
}
