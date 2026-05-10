#!/usr/bin/env node
// scripts/parse_council_homepage.js
// 동대문구의회 홈페이지 게시 의회운영업무추진비 자료 파싱.
// 사무국 PDF(ddm_council_upchubi)와 컬럼 구조가 다르므로 별도 파이프라인.
//
// 컬럼: 연번 | 사용자 | 일자 | 시간 | 승인금액 | 가맹점명 | 내역 | 인원 | 결제
// 사용자: 의장, 부의장, 운영위원장, 복지건설위원장 등 — 의원 직책

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { extractRows, mapCellsHomepage, isTotalRow } from './lib/md_table.js';
import {
  cleanText,
  isCorrupt,
  parseDate,
  parseTime,
  parseInt0,
  parseAmount,
  normalizeMethod,
  weekday,
  isWeekend,
  hourOf,
  isLateNight,
} from './lib/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'ddm_council_homepage');
const OUT_DIR = path.join(ROOT, 'data');

fs.mkdirSync(OUT_DIR, { recursive: true });

function extractFolderYM(folder) {
  // 폴더명: ..._2025년_6월_의회운영업무추진비_집행내역_...
  const m = folder.match(/(\d{4})년_(\d{1,2})월/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

function findMdFile(folderPath) {
  const entries = fs.readdirSync(folderPath);
  const folderName = path.basename(folderPath);
  const exact = entries.find((e) => e === `${folderName}.md`);
  if (exact) return path.join(folderPath, exact);
  const any = entries.find((e) => e.toLowerCase().endsWith('.md') && !e.includes('_meta'));
  return any ? path.join(folderPath, any) : null;
}

function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 6);
}

function processOne(folderPath) {
  const folderName = path.basename(folderPath);
  const mdPath = findMdFile(folderPath);
  if (!mdPath) {
    console.warn(`[skip] no md: ${folderName}`);
    return { rows: [], review: [] };
  }
  const md = fs.readFileSync(mdPath, 'utf8');
  const tableRows = extractRows(md);
  const folderYM = extractFolderYM(folderName);

  const rows = [];
  const review = [];
  let lastUser = ''; // 사용자 누락 행에서 상속

  for (const { page, cells } of tableRows) {
    if (isTotalRow(cells)) continue;
    const m = mapCellsHomepage(cells);
    const flags = [];

    const seq_raw = (m.seq ?? '').toString();
    let user_raw = cleanText(m.user);
    if (!user_raw && m._inheritUser && lastUser) {
      user_raw = lastUser;
      flags.push('user_inherited');
    }
    if (user_raw) lastUser = user_raw;
    const venue_raw = cleanText(m.venue);
    const purpose = cleanText(m.purpose);
    const headcount_raw = (m.headcount ?? '').toString();
    const amount_raw = (m.amount ?? '').toString();
    const method_raw = (m.method ?? '').toString();

    if (isCorrupt(m.seq)) flags.push('seq_corrupt');
    if (isCorrupt(m.purpose)) flags.push('purpose_corrupt');
    if (!user_raw) flags.push('user_missing');
    if (!venue_raw) flags.push('venue_missing');

    const date = parseDate(m.date);
    if (!date) flags.push('date_invalid');
    const time = parseTime(m.time);
    const seq = parseInt0(m.seq);
    const headcount = parseInt0(m.headcount);
    if (headcount == null && headcount_raw.trim()) flags.push('headcount_invalid');
    if (!headcount_raw.trim()) flags.push('headcount_missing');

    const amount = parseAmount(m.amount);
    if (amount == null) flags.push('amount_invalid');
    const method = normalizeMethod(m.method);

    if (!date || amount == null || amount <= 0) {
      review.push({
        source_folder: folderName,
        source_year_month: folderYM,
        page,
        cells_raw: cells,
        flags,
        reason: !date ? 'date_invalid' : 'amount_invalid_or_zero',
      });
      continue;
    }

    const ym = date.slice(0, 7);
    const wd = weekday(date);
    const h = hourOf(time);
    const id = `${ym}-${seq ?? 'x'}-${shortHash(`${date}|${user_raw}|${amount}|${venue_raw}`)}`;

    rows.push({
      id,
      source_folder: folderName,
      source_year_month: folderYM,
      page,
      seq,
      seq_raw,
      user_raw,
      date,
      date_raw: (m.date ?? '').toString(),
      time,
      venue_raw,
      venue_norm: '',
      purpose,
      headcount,
      headcount_raw,
      amount,
      amount_raw,
      method,
      method_raw,
      category: '의회운영', // 의회운영업무추진비
      year_month: ym,
      weekday: wd,
      is_weekend: isWeekend(date),
      hour: h,
      is_late_night: isLateNight(h),
      per_person: headcount && headcount > 0 ? amount / headcount : null,
      flags,
    });
  }
  return { rows, review };
}

function main() {
  const allRows = [];
  const allReview = [];

  const folders = fs
    .readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`[parse:homepage] ${folders.length} folders`);

  for (const f of folders) {
    const fp = path.join(SRC_DIR, f);
    const { rows, review } = processOne(fp);
    allRows.push(...rows);
    allReview.push(...review);
  }

  // 중복 제거
  const dedup = new Map();
  let dupCount = 0;
  for (const r of allRows) {
    if (!dedup.has(r.id)) dedup.set(r.id, r);
    else dupCount++;
  }
  const dedupedRows = [...dedup.values()];
  if (dupCount) console.log(`[dedup:homepage] removed ${dupCount} (${allRows.length} → ${dedupedRows.length})`);

  dedupedRows.sort((a, b) => a.date.localeCompare(b.date) || (a.seq ?? 0) - (b.seq ?? 0));

  fs.writeFileSync(
    path.join(OUT_DIR, 'ddm_homepage.raw.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), rows: dedupedRows }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'ddm_homepage_review.json'),
    JSON.stringify(
      { generated_at: new Date().toISOString(), reviews: allReview },
      null,
      2
    )
  );

  // 월별 sanity
  const byYM = new Map();
  for (const r of dedupedRows) {
    if (!byYM.has(r.year_month)) byYM.set(r.year_month, { c: 0, a: 0 });
    const e = byYM.get(r.year_month);
    e.c++;
    e.a += r.amount;
  }
  console.log(`\n[summary] rows=${dedupedRows.length}  review=${allReview.length}`);
  console.log(`[summary] year-month distribution:`);
  for (const [ym, e] of [...byYM.entries()].sort()) {
    console.log(`  ${ym}: ${String(e.c).padStart(3)}건  ${e.a.toLocaleString().padStart(13)}원`);
  }

  // 사용자(의원 직책) 분포
  const userMap = new Map();
  for (const r of dedupedRows) {
    if (!userMap.has(r.user_raw)) userMap.set(r.user_raw, { c: 0, a: 0 });
    const e = userMap.get(r.user_raw);
    e.c++;
    e.a += r.amount;
  }
  console.log(`\n[summary] 사용자(의원 직책) 분포:`);
  for (const [u, e] of [...userMap.entries()].sort((a, b) => b[1].a - a[1].a)) {
    console.log(`  ${u.padEnd(15)} ${String(e.c).padStart(3)}건  ${e.a.toLocaleString().padStart(13)}원`);
  }
}

main();
