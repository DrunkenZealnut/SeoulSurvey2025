// scripts/lib/venue.js
// 장소(업소) 정규화 + alias 그룹핑.
// 자동 그룹핑은 보수적으로 수행하고, 의심 케이스는 별도 출력.

import { cleanText } from './normalize.js';

// 정규화 키: 공백/특수문자/괄호/영문 흔들림 제거
export function normalizeVenue(raw) {
  if (raw == null) return '';
  let s = cleanText(raw);
  // 영문 괄호의 반복 문자 흔들림 제거: "(b b q)" → "(bbq)"
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => `(${inner.replace(/\s+/g, '')})`);
  // 모든 공백 제거 (한국 상호명은 공백 흔들림이 잦음)
  const compact = s.replace(/\s+/g, '');
  // 흔한 접미/접두 변형은 보존하되, 비교 키만 따로 lower
  return compact;
}

export function displayName(raws) {
  // 가장 빈도 높은 raw 표기 채택
  const cnt = new Map();
  for (const r of raws) {
    const k = cleanText(r);
    if (!k) continue;
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, n] of cnt.entries()) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

// Levenshtein (작은 입력 가정)
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * 후보 정규화 키 배열을 받아 Union-Find로 fuzzy 그룹핑.
 * 같은 그룹: lev distance ≤ 1 AND 짧은 쪽 길이 ≥ 4 AND 길이차 ≤ 2.
 * 보수적으로 — 짧은 이름(3자 이하)는 동일 문자열만 같은 그룹.
 */
export function clusterKeys(keys) {
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  const parent = new Map();
  uniq.forEach((k) => parent.set(k, k));

  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i];
      const b = uniq[j];
      const minLen = Math.min(a.length, b.length);
      if (minLen < 4) continue;
      if (Math.abs(a.length - b.length) > 2) continue;
      // 짧은 쪽이 다른 쪽에 부분문자열 포함되면 같은 그룹 후보
      const subset = a.includes(b) || b.includes(a);
      const d = lev(a, b);
      if (d <= 1 || (subset && d <= 2)) {
        union(a, b);
      }
    }
  }

  const groups = new Map(); // root -> [keys]
  for (const k of uniq) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  }
  // canonical key는 그룹 내 빈도 최다 또는 가장 긴 것 선택
  // 외부 빈도 정보가 필요해 호출 측에서 결정하도록 그룹만 반환
  const out = new Map(); // key -> canonicalKey
  for (const [_root, members] of groups.entries()) {
    members.sort((x, y) => y.length - x.length || x.localeCompare(y));
    const canonical = members[0];
    for (const m of members) out.set(m, canonical);
  }
  return out; // Map<key, canonicalKey>
}
