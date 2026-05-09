#!/usr/bin/env node
// scripts/parse_ddm_upchubi.js
// 동대문구의회 업무추진비 .md 42개 → 정제 행 + 격리 review 출력.
//
// 사용:
//   node scripts/parse_ddm_upchubi.js
//
// 출력:
//   data/ddm_upchubi.raw.json     (정제 후 모든 행, flag 포함)
//   data/ddm_upchubi_review.json  (무효 또는 강한 의심 행)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { extractRows, mapCells, isTotalRow } from './lib/md_table.js';
import {
  cleanText,
  isCorrupt,
  parseDate,
  parseTime,
  parseInt0,
  parseAmount,
  splitAmountMethod,
  normalizeMethod,
  normalizeCategory,
  weekday,
  isWeekend,
  hourOf,
  isLateNight,
} from './lib/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'ddm_council_upchubi');
const OUT_DIR = path.join(ROOT, 'data');

fs.mkdirSync(OUT_DIR, { recursive: true });

// 폴더명에서 yyyy-mm 추출
function extractFolderYM(folder) {
  const m = folder.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function findMdFile(folderPath) {
  const entries = fs.readdirSync(folderPath);
  // 폴더명과 동일한 .md (가장 흔함)
  const folderName = path.basename(folderPath);
  const exact = entries.find((e) => e === `${folderName}.md`);
  if (exact) return path.join(folderPath, exact);
  // fallback: 첫 .md
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

  for (const { page, cells } of tableRows) {
    if (isTotalRow(cells)) continue; // "승인액 계" 등 합계 행 제외
    const m = mapCells(cells);
    const flags = [];

    const seq_raw = (m.seq ?? '').toString();
    const user_raw = cleanText(m.user);
    const date_raw = (m.date ?? '').toString();
    const venue_raw = cleanText(m.venue);
    const purpose = cleanText(m.purpose);
    const headcount_raw = (m.headcount ?? '').toString();
    const amount_raw = (m.amount ?? '').toString();
    const time_raw = (m.time ?? '').toString();
    const method_raw = (m.method ?? '').toString();
    const category_raw = (m.category ?? '').toString();

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

    const am = splitAmountMethod(m.amount, m.method);
    if (am.merged) flags.push('amount_method_merged');
    const amount = am.amount;
    const method = normalizeMethod(am.method);

    if (amount == null) flags.push('amount_invalid');

    const category_raw_str = cleanText(m.category);
    const category = normalizeCategory(m.category);
    if (category_raw_str && category !== category_raw_str) {
      flags.push('category_normalized');
    }

    // 무효 행: date 없거나 amount 없는 경우 review로 분리
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
      date_raw,
      time,
      venue_raw,
      venue_norm: '', // 다음 단계에서 채움 (aggregate)
      purpose,
      headcount,
      headcount_raw,
      amount,
      amount_raw,
      method,
      method_raw,
      category,
      category_raw: category_raw_str,
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

  console.log(`[parse] ${folders.length} folders`);

  let folderYmMismatch = 0;
  for (const f of folders) {
    const fp = path.join(SRC_DIR, f);
    const { rows, review } = processOne(fp);
    allRows.push(...rows);
    allReview.push(...review);

    // 폴더명 vs 콘텐츠 yyyy-mm 불일치 카운트
    const folderYM = extractFolderYM(f);
    if (folderYM) {
      const contentYMs = new Set(rows.map((r) => r.year_month));
      if (contentYMs.size && !contentYMs.has(folderYM)) {
        folderYmMismatch++;
        console.warn(
          `[warn] folder=${folderYM} content=${[...contentYMs].join(',')} → ${f}`
        );
      }
    }
  }

  // 중복 제거 (같은 id가 다른 폴더에서 나오면 더 작은 source_year_month 우선 = 더 오래된 출처)
  const dedup = new Map();
  let dupCount = 0;
  for (const r of allRows) {
    if (!dedup.has(r.id)) {
      dedup.set(r.id, r);
    } else {
      dupCount++;
      const prev = dedup.get(r.id);
      const a = String(prev.source_year_month ?? '');
      const b = String(r.source_year_month ?? '');
      if (b && (!a || b < a)) dedup.set(r.id, r);
    }
  }
  const dedupedRows = [...dedup.values()];
  console.log(`[dedup] removed ${dupCount} duplicates (rows ${allRows.length} → ${dedupedRows.length})`);

  // 정렬
  dedupedRows.sort((a, b) => a.date.localeCompare(b.date) || (a.seq ?? 0) - (b.seq ?? 0));
  allRows.length = 0;
  allRows.push(...dedupedRows);

  fs.writeFileSync(
    path.join(OUT_DIR, 'ddm_upchubi.raw.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), rows: allRows }, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'ddm_upchubi_review.json'),
    JSON.stringify(
      { generated_at: new Date().toISOString(), reviews: allReview },
      null,
      2
    )
  );

  // sanity 출력
  const byYM = new Map();
  for (const r of allRows) {
    if (!byYM.has(r.year_month)) byYM.set(r.year_month, { count: 0, total: 0 });
    const e = byYM.get(r.year_month);
    e.count++;
    e.total += r.amount;
  }
  const ymSorted = [...byYM.entries()].sort();
  console.log(`\n[summary] rows=${allRows.length} review=${allReview.length}`);
  console.log(`[summary] folder/content YM mismatch folders=${folderYmMismatch}`);
  console.log(`[summary] year-month distribution:`);
  for (const [ym, e] of ymSorted) {
    console.log(`  ${ym}: ${String(e.count).padStart(3)}건  ${e.total.toLocaleString().padStart(13)}원`);
  }
}

main();
