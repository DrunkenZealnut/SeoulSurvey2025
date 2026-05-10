#!/usr/bin/env node
// scripts/aggregate_council_homepage.js
// 홈페이지 자료(의장단 의회운영업무추진비) 집계.
// 사용자(의원 직책) 중심 분석.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeVenue, displayName, clusterKeys } from './lib/venue.js';
import { classifyPurpose } from './lib/purpose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
}
function save(name, obj) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 2));
}
function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return columns.join(',') + '\n' + rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n') + '\n';
}

function topByKey(rows, keyFn, limit = 10) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const e = m.get(k) || { key: k, count: 0, amount: 0 };
    e.count++;
    e.amount += r.amount;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

function main() {
  const raw = load('ddm_homepage.raw.json');
  const rows = raw.rows;

  // 1) venue_norm + purpose category
  for (const r of rows) {
    r.venue_norm = normalizeVenue(r.venue_raw);
    const cls = classifyPurpose(r.purpose);
    r.purpose_cat = cls.cat;
    r.purpose_short = cls.short;
  }

  // 2) fuzzy 그룹핑
  const cluster = clusterKeys(rows.map((r) => r.venue_norm));
  for (const r of rows) {
    if (cluster.has(r.venue_norm)) r.venue_norm = cluster.get(r.venue_norm);
  }

  // 3) 의원(사용자)별 분석 — 핵심
  const memberMap = new Map();
  for (const r of rows) {
    const u = r.user_raw || '(빈값)';
    if (!memberMap.has(u)) {
      memberMap.set(u, { user: u, rows: [], venues: new Map(), ymStats: new Map() });
    }
    const m = memberMap.get(u);
    m.rows.push(r);
    const ucnt = m.venues.get(r.venue_norm) || { venue_norm: r.venue_norm, count: 0, amount: 0 };
    ucnt.count++;
    ucnt.amount += r.amount;
    m.venues.set(r.venue_norm, ucnt);
    const ym = r.year_month;
    const yms = m.ymStats.get(ym) || { ym, count: 0, amount: 0 };
    yms.count++;
    yms.amount += r.amount;
    m.ymStats.set(ym, yms);
  }

  // venue display_name lookup
  const venueDisplay = new Map();
  const venueAliases = new Map();
  for (const r of rows) {
    if (!venueAliases.has(r.venue_norm)) venueAliases.set(r.venue_norm, new Set());
    venueAliases.get(r.venue_norm).add(r.venue_raw);
  }
  for (const [k, set] of venueAliases.entries()) {
    venueDisplay.set(k, displayName([...set]));
  }

  const members = [...memberMap.values()].map((m) => {
    const total_amount = m.rows.reduce((s, x) => s + x.amount, 0);
    const total_count = m.rows.length;
    const headcounts = m.rows.filter((x) => x.headcount && x.headcount > 0);
    const avg_headcount = headcounts.length
      ? headcounts.reduce((s, x) => s + x.headcount, 0) / headcounts.length
      : null;
    const avg_per_event = total_amount / total_count;
    const top_venues = [...m.venues.values()]
      .map((v) => ({ ...v, display_name: venueDisplay.get(v.venue_norm) || v.venue_norm }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
    const by_year_month = [...m.ymStats.values()].sort((a, b) => a.ym.localeCompare(b.ym));
    const purpose_breakdown = topByKey(m.rows, (r) => r.purpose_short, 10);

    // 시간대
    const timeBuckets = { '점심(11-14)': 0, '오후(14-18)': 0, '저녁(18-22)': 0, '심야(22-06)': 0, '오전(06-11)': 0, '미상': 0 };
    for (const r of m.rows) {
      if (r.hour == null) timeBuckets['미상']++;
      else if (r.hour >= 22 || r.hour < 6) timeBuckets['심야(22-06)']++;
      else if (r.hour < 11) timeBuckets['오전(06-11)']++;
      else if (r.hour < 14) timeBuckets['점심(11-14)']++;
      else if (r.hour < 18) timeBuckets['오후(14-18)']++;
      else timeBuckets['저녁(18-22)']++;
    }

    const samples = m.rows
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((r) => ({
        date: r.date,
        time: r.time,
        venue_raw: r.venue_raw,
        purpose: r.purpose,
        amount: r.amount,
        headcount: r.headcount,
      }));

    return {
      user: m.user,
      total_count,
      total_amount,
      avg_per_event,
      avg_headcount,
      top_venues,
      by_year_month,
      purpose_breakdown,
      time_buckets: timeBuckets,
      samples,
    };
  }).sort((a, b) => b.total_amount - a.total_amount);

  // 4) venue 전체 집계
  const venueMap = new Map();
  for (const r of rows) {
    if (!venueMap.has(r.venue_norm)) {
      venueMap.set(r.venue_norm, { venue_norm: r.venue_norm, rows: [], users: new Map(), ymStats: new Map() });
    }
    const v = venueMap.get(r.venue_norm);
    v.rows.push(r);
    const u = v.users.get(r.user_raw) || { user: r.user_raw, count: 0, amount: 0 };
    u.count++;
    u.amount += r.amount;
    v.users.set(r.user_raw, u);
  }
  const venues = [...venueMap.values()].map((v) => {
    const total_amount = v.rows.reduce((s, x) => s + x.amount, 0);
    return {
      venue_norm: v.venue_norm,
      display_name: venueDisplay.get(v.venue_norm) || v.venue_norm,
      total_count: v.rows.length,
      total_amount,
      avg_amount: total_amount / v.rows.length,
      first_used: v.rows.reduce((m, x) => (m && m < x.date ? m : x.date), v.rows[0].date),
      last_used: v.rows.reduce((m, x) => (m && m > x.date ? m : x.date), v.rows[0].date),
      top_users: [...v.users.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    };
  }).sort((a, b) => b.total_amount - a.total_amount);
  venues.forEach((v, i) => (v.rank_by_amount = i + 1));

  // 5) summary
  const ymMap = new Map();
  for (const r of rows) {
    if (!ymMap.has(r.year_month))
      ymMap.set(r.year_month, { ym: r.year_month, count: 0, amount: 0 });
    const e = ymMap.get(r.year_month);
    e.count++;
    e.amount += r.amount;
  }
  const coverage = [...ymMap.values()].sort((a, b) => a.ym.localeCompare(b.ym));

  // 의원별 월별 stacked
  const memberCoverage = [...ymMap.values()].map((c) => ({ ym: c.ym }));
  for (const m of members) {
    for (const e of m.by_year_month) {
      const target = memberCoverage.find((x) => x.ym === e.ym);
      if (target) {
        target[m.user] = e.count;
        target[m.user + '_amount'] = e.amount;
      }
    }
  }

  // 사용자별 식당 overlap (어떤 의원이 같은 식당을 가는가)
  const venueByUserMatrix = [];
  for (const v of venues.slice(0, 15)) {
    const row = { venue_norm: v.venue_norm, display_name: v.display_name };
    for (const u of v.top_users) row[u.user] = u.count;
    row.total_count = v.total_count;
    row.total_amount = v.total_amount;
    venueByUserMatrix.push(row);
  }

  const totals = {
    total_amount: rows.reduce((s, x) => s + x.amount, 0),
    total_count: rows.length,
    distinct_venues: venues.length,
    distinct_users: members.length,
    coverage_months: coverage.length,
    date_min: coverage[0]?.ym,
    date_max: coverage[coverage.length - 1]?.ym,
  };

  const summary = {
    generated_at: new Date().toISOString(),
    totals,
    coverage,
    members,
    venues,
    member_coverage: memberCoverage,
    venue_by_user_matrix: venueByUserMatrix,
  };

  save('ddm_homepage.json', { generated_at: new Date().toISOString(), rows });
  save('ddm_homepage_summary.json', summary);

  // CSV
  const rowCols = ['id','date','time','user_raw','venue_raw','venue_norm','purpose','headcount','amount','per_person','method','year_month','hour','flags'];
  const csvRows = rows.map((r) => ({ ...r, flags: (r.flags || []).join('|') }));
  fs.writeFileSync(path.join(DATA, 'ddm_homepage.csv'), toCsv(csvRows, rowCols));

  console.log(`[aggregate:homepage] rows=${rows.length}  members=${members.length}  venues=${venues.length}  ${totals.total_amount.toLocaleString()}원 (${totals.coverage_months}개월)`);
  for (const m of members) {
    console.log(`  ${m.user.padEnd(15)} ${String(m.total_count).padStart(3)}건  ${m.total_amount.toLocaleString().padStart(12)}원  평균 ${Math.round(m.avg_per_event).toLocaleString()}원/회 · ${(m.avg_headcount||0).toFixed(1)}명`);
  }
}

main();
