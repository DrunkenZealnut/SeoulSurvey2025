#!/usr/bin/env node
// scripts/aggregate_ddm_upchubi.js
// raw 행 → 정제된 행, 식당 집계, 요약, 이상치 산출.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeVenue, displayName, clusterKeys } from './lib/venue.js';
import { runAll } from './lib/anomaly.js';

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
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function main() {
  const raw = load('ddm_upchubi.raw.json');
  const rows = raw.rows;

  // 1) venue_norm 채우기 (1차 정규화)
  for (const r of rows) {
    r.venue_norm = normalizeVenue(r.venue_raw);
  }

  // 2) fuzzy 클러스터링으로 alias 그룹핑
  const cluster = clusterKeys(rows.map((r) => r.venue_norm));
  for (const r of rows) {
    if (cluster.has(r.venue_norm)) r.venue_norm = cluster.get(r.venue_norm);
  }

  // 3) venue 집계
  const venues = new Map();
  for (const r of rows) {
    const k = r.venue_norm;
    if (!k) continue;
    if (!venues.has(k)) {
      venues.set(k, {
        venue_norm: k,
        aliases: new Set(),
        rows: [],
        users: new Map(),
        ymStats: new Map(),
        first: null,
        last: null,
      });
    }
    const v = venues.get(k);
    v.aliases.add(r.venue_raw);
    v.rows.push(r);
    if (!v.first || r.date < v.first) v.first = r.date;
    if (!v.last || r.date > v.last) v.last = r.date;
    const ucnt = v.users.get(r.user_raw) || { count: 0, amount: 0 };
    ucnt.count++;
    ucnt.amount += r.amount;
    v.users.set(r.user_raw, ucnt);
    const ym = r.year_month;
    const yms = v.ymStats.get(ym) || { ym, count: 0, amount: 0 };
    yms.count++;
    yms.amount += r.amount;
    v.ymStats.set(ym, yms);
  }
  const venueList = [...venues.values()].map((v) => {
    const total_amount = v.rows.reduce((s, x) => s + x.amount, 0);
    const total_count = v.rows.length;
    const avg_amount = total_amount / total_count;
    const headcounts = v.rows.filter((x) => x.headcount && x.headcount > 0);
    const avg_per_person = headcounts.length
      ? headcounts.reduce((s, x) => s + x.amount / x.headcount, 0) / headcounts.length
      : null;
    const top_users = [...v.users.entries()]
      .map(([user_raw, x]) => ({ user_raw, count: x.count, amount: x.amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
    const by_year_month = [...v.ymStats.values()].sort((a, b) => a.ym.localeCompare(b.ym));
    return {
      venue_norm: v.venue_norm,
      display_name: displayName([...v.aliases]),
      aliases: [...v.aliases],
      total_amount,
      total_count,
      avg_amount,
      avg_per_person,
      first_used: v.first,
      last_used: v.last,
      top_users,
      by_year_month,
    };
  });

  venueList.sort((a, b) => b.total_amount - a.total_amount);
  venueList.forEach((v, i) => (v.rank_by_amount = i + 1));
  const byCount = [...venueList].sort((a, b) => b.total_count - a.total_count);
  byCount.forEach((v, i) => (v.rank_by_count = i + 1));

  // 4) summary
  const ymMap = new Map();
  const yearMap = new Map();
  const userMap = new Map();
  const methodMap = new Map();
  const categoryMap = new Map();
  const wdMap = new Map();
  const hourBuckets = { '00-05': 0, '06-11': 0, '12-17': 0, '18-21': 0, '22-23': 0, unknown: 0 };

  function add(map, key, amount) {
    const e = map.get(key) || { total_amount: 0, count: 0 };
    e.total_amount += amount;
    e.count++;
    map.set(key, e);
  }

  for (const r of rows) {
    if (!ymMap.has(r.year_month))
      ymMap.set(r.year_month, { year_month: r.year_month, row_count: 0, total_amount: 0 });
    const ym = ymMap.get(r.year_month);
    ym.row_count++;
    ym.total_amount += r.amount;

    add(yearMap, r.year_month.slice(0, 4), r.amount);
    if (r.user_raw) add(userMap, r.user_raw, r.amount);
    if (r.method) add(methodMap, r.method, r.amount);
    if (r.category) add(categoryMap, r.category, r.amount);
    if (r.weekday != null) add(wdMap, r.weekday, r.amount);
    if (r.hour == null) hourBuckets.unknown++;
    else if (r.hour < 6) hourBuckets['00-05']++;
    else if (r.hour < 12) hourBuckets['06-11']++;
    else if (r.hour < 18) hourBuckets['12-17']++;
    else if (r.hour < 22) hourBuckets['18-21']++;
    else hourBuckets['22-23']++;
  }

  const coverage = [...ymMap.values()].sort((a, b) => a.year_month.localeCompare(b.year_month));
  const by_year = [...yearMap.entries()]
    .map(([year, e]) => ({ year: Number(year), total_amount: e.total_amount, count: e.count }))
    .sort((a, b) => a.year - b.year);
  const by_user = [...userMap.entries()]
    .map(([user_raw, e]) => ({ user_raw, total_amount: e.total_amount, count: e.count }))
    .sort((a, b) => b.total_amount - a.total_amount);
  const by_method = [...methodMap.entries()]
    .map(([method, e]) => ({ method, total_amount: e.total_amount, count: e.count }))
    .sort((a, b) => b.total_amount - a.total_amount);
  const by_category = [...categoryMap.entries()]
    .map(([category, e]) => ({ category, total_amount: e.total_amount, count: e.count }))
    .sort((a, b) => b.total_amount - a.total_amount);
  const by_weekday = [...wdMap.entries()]
    .map(([weekday, e]) => ({
      weekday: Number(weekday),
      total_amount: e.total_amount,
      count: e.count,
    }))
    .sort((a, b) => a.weekday - b.weekday);
  const by_hour_bucket = Object.entries(hourBuckets).map(([bucket, count]) => ({
    bucket,
    count,
  }));

  const totals = {
    total_amount: rows.reduce((s, x) => s + x.amount, 0),
    total_count: rows.length,
    distinct_venues: venueList.length,
    distinct_users: userMap.size,
    coverage_months: coverage.length,
    date_min: coverage[0]?.year_month,
    date_max: coverage[coverage.length - 1]?.year_month,
  };

  const summary = {
    generated_at: new Date().toISOString(),
    totals,
    coverage,
    by_year,
    by_user,
    by_method,
    by_category,
    by_weekday,
    by_hour_bucket,
  };

  // 5) anomaly
  const anomalyResult = runAll(rows, venueList);

  // 6) 출력
  // 정제된 row 단위
  save('ddm_upchubi.json', { generated_at: new Date().toISOString(), rows });
  save('ddm_upchubi_by_venue.json', {
    generated_at: new Date().toISOString(),
    venues: venueList,
  });
  save('ddm_upchubi_summary.json', summary);
  save('ddm_upchubi_anomalies.json', {
    generated_at: new Date().toISOString(),
    ...anomalyResult,
  });

  // CSV
  const rowCols = [
    'id',
    'date',
    'time',
    'year_month',
    'weekday',
    'hour',
    'user_raw',
    'venue_raw',
    'venue_norm',
    'purpose',
    'headcount',
    'amount',
    'per_person',
    'method',
    'category',
    'is_late_night',
    'is_weekend',
    'flags',
  ];
  const csvRows = rows.map((r) => ({ ...r, flags: (r.flags || []).join('|') }));
  fs.writeFileSync(path.join(DATA, 'ddm_upchubi.csv'), toCsv(csvRows, rowCols));

  const venueCols = [
    'rank_by_amount',
    'rank_by_count',
    'display_name',
    'venue_norm',
    'total_amount',
    'total_count',
    'avg_amount',
    'avg_per_person',
    'first_used',
    'last_used',
  ];
  fs.writeFileSync(path.join(DATA, 'ddm_upchubi_by_venue.csv'), toCsv(venueList, venueCols));

  console.log(`[aggregate] rows=${rows.length}  venues=${venueList.length}  users=${userMap.size}`);
  console.log(`[aggregate] anomalies=${anomalyResult.anomalies.length}`);
  console.log(`[aggregate] totals=${totals.total_amount.toLocaleString()}원 (${totals.coverage_months}개월)`);
}

main();
