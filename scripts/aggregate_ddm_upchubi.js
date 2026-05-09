#!/usr/bin/env node
// scripts/aggregate_ddm_upchubi.js
// raw 행 → 정제된 행, 식당 집계, 요약, 이상치 산출.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeVenue, displayName, clusterKeys } from './lib/venue.js';
import { runAll } from './lib/anomaly.js';
import { classifyPurpose } from './lib/purpose.js';
import { classifyMemberAttendance } from './lib/member.js';

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

  // 1) venue_norm + purpose category + 구의원 참석 분류
  for (const r of rows) {
    r.venue_norm = normalizeVenue(r.venue_raw);
    const cls = classifyPurpose(r.purpose);
    r.purpose_cat = cls.cat;
    r.purpose_short = cls.short;
    r.member_attended = classifyMemberAttendance(r.purpose);
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
    const avg_headcount = headcounts.length
      ? headcounts.reduce((s, x) => s + x.headcount, 0) / headcounts.length
      : null;
    const top_users = [...v.users.entries()]
      .map(([user_raw, x]) => ({ user_raw, count: x.count, amount: x.amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    const by_year_month = [...v.ymStats.values()].sort((a, b) => a.ym.localeCompare(b.ym));

    // purpose 분포
    const purposeMap = new Map();
    for (const r of v.rows) {
      const cat = r.purpose_short || '미상';
      const e = purposeMap.get(cat) || { short: cat, count: 0, amount: 0 };
      e.count++;
      e.amount += r.amount;
      purposeMap.set(cat, e);
    }
    const purpose_breakdown = [...purposeMap.values()].sort((a, b) => b.count - a.count);

    // 구의원 참석 분포
    const memberMap = { attended: 0, likely: 0, not_attended: 0 };
    const memberAmount = { attended: 0, likely: 0, not_attended: 0 };
    for (const r of v.rows) {
      const k = r.member_attended || 'not_attended';
      memberMap[k]++;
      memberAmount[k] += r.amount;
    }

    // method 분포
    const methodMap = new Map();
    for (const r of v.rows) {
      if (!r.method) continue;
      const e = methodMap.get(r.method) || { method: r.method, count: 0, amount: 0 };
      e.count++;
      e.amount += r.amount;
      methodMap.set(r.method, e);
    }
    const method_breakdown = [...methodMap.values()].sort((a, b) => b.count - a.count);

    // 시간대 (점심/저녁/심야 등)
    const timeBuckets = { '점심(11-14)': 0, '오후(14-18)': 0, '저녁(18-22)': 0, '심야(22-06)': 0, '오전(06-11)': 0, '미상': 0 };
    for (const r of v.rows) {
      if (r.hour == null) timeBuckets['미상']++;
      else if (r.hour >= 22 || r.hour < 6) timeBuckets['심야(22-06)']++;
      else if (r.hour < 11) timeBuckets['오전(06-11)']++;
      else if (r.hour < 14) timeBuckets['점심(11-14)']++;
      else if (r.hour < 18) timeBuckets['오후(14-18)']++;
      else timeBuckets['저녁(18-22)']++;
    }

    // 평일/주말 비율
    const weekend = v.rows.filter((r) => r.is_weekend).length;
    const weekday = v.rows.length - weekend;

    // 가장 많이 쓴 달
    const peakMonth = by_year_month.slice().sort((a, b) => b.count - a.count)[0] || null;

    // 최근 12개월 활성도 (최근 last_used 기준)
    let recent_count = 0;
    let recent_amount = 0;
    if (v.last) {
      const last = new Date(v.last + 'T00:00:00Z');
      const cutoff = new Date(last);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      for (const r of v.rows) {
        if (r.date >= cutoffStr) {
          recent_count++;
          recent_amount += r.amount;
        }
      }
    }

    // 대표 집행 사례 5개 (금액 큰 순)
    const sample_rows = v.rows
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((r) => ({
        date: r.date,
        time: r.time,
        user_raw: r.user_raw,
        purpose: r.purpose,
        purpose_short: r.purpose_short,
        amount: r.amount,
        headcount: r.headcount,
        method: r.method,
      }));

    return {
      venue_norm: v.venue_norm,
      display_name: displayName([...v.aliases]),
      aliases: [...v.aliases],
      total_amount,
      total_count,
      avg_amount,
      avg_per_person,
      avg_headcount,
      first_used: v.first,
      last_used: v.last,
      top_users,
      by_year_month,
      purpose_breakdown,
      method_breakdown,
      member_attendance: { count: memberMap, amount: memberAmount },
      time_buckets: timeBuckets,
      weekday_count: weekday,
      weekend_count: weekend,
      peak_month: peakMonth,
      recent12m_count: recent_count,
      recent12m_amount: recent_amount,
      sample_rows,
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
  const purposeMap = new Map();
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
    if (r.purpose_short) add(purposeMap, r.purpose_short, r.amount);
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
  const by_purpose = [...purposeMap.entries()]
    .map(([purpose_short, e]) => ({ purpose_short, total_amount: e.total_amount, count: e.count }))
    .sort((a, b) => b.total_amount - a.total_amount);

  // 구의원 참석 분석
  const memberAttendance = {
    attended: { count: 0, total_amount: 0 },
    likely: { count: 0, total_amount: 0 },
    not_attended: { count: 0, total_amount: 0 },
  };
  const memberByYM = new Map();
  for (const r of rows) {
    const k = r.member_attended || 'not_attended';
    memberAttendance[k].count++;
    memberAttendance[k].total_amount += r.amount;
    if (!memberByYM.has(r.year_month))
      memberByYM.set(r.year_month, {
        ym: r.year_month,
        attended: 0,
        likely: 0,
        not_attended: 0,
        attended_amount: 0,
        likely_amount: 0,
        not_attended_amount: 0,
      });
    const e = memberByYM.get(r.year_month);
    e[k]++;
    e[k + '_amount'] += r.amount;
  }
  const memberCoverage = [...memberByYM.values()].sort((a, b) => a.ym.localeCompare(b.ym));

  function topByKey(rs, keyFn, limit = 10) {
    const m = new Map();
    for (const r of rs) {
      const k = keyFn(r);
      if (!k) continue;
      const e = m.get(k) || { key: k, count: 0, amount: 0 };
      e.count++;
      e.amount += r.amount;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
  }
  const attendedRows = rows.filter((r) => r.member_attended === 'attended');
  const likelyRows = rows.filter((r) => r.member_attended === 'likely');
  const venueDisplayMap = new Map(venueList.map((v) => [v.venue_norm, v.display_name]));
  function annotateVenueKey(arr) {
    return arr.map((x) => ({ ...x, display_name: venueDisplayMap.get(x.key) || x.key }));
  }
  const attendedAnalysis = {
    by_venue: annotateVenueKey(topByKey(attendedRows, (r) => r.venue_norm, 15)),
    by_user: topByKey(attendedRows, (r) => r.user_raw, 10),
    by_purpose: topByKey(attendedRows, (r) => r.purpose_short, 12),
    samples: attendedRows
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((r) => ({
        date: r.date,
        time: r.time,
        user_raw: r.user_raw,
        venue_raw: r.venue_raw,
        purpose: r.purpose,
        amount: r.amount,
        headcount: r.headcount,
        method: r.method,
      })),
  };
  const likelyAnalysis = {
    by_venue: annotateVenueKey(topByKey(likelyRows, (r) => r.venue_norm, 15)),
    by_user: topByKey(likelyRows, (r) => r.user_raw, 10),
    by_purpose: topByKey(likelyRows, (r) => r.purpose_short, 12),
  };

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
    by_purpose,
    member_attendance: memberAttendance,
    member_coverage: memberCoverage,
    attended_analysis: attendedAnalysis,
    likely_analysis: likelyAnalysis,
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
