// scripts/lib/anomaly.js
// 분포 기반 이상치 탐지.

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export function detectPerPersonOutliers(rows, q = 0.99) {
  const vals = rows
    .map((r) => r.per_person)
    .filter((v) => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!vals.length) return { threshold: null, hits: [] };
  const threshold = quantile(vals, q);
  const hits = rows
    .filter((r) => r.per_person != null && r.per_person >= threshold)
    .map((r) => ({
      rule: 'per_person_outlier',
      severity: r.per_person >= threshold * 2 ? 'high' : 'warn',
      evidence: { id: r.id, metric: 'per_person', value: r.per_person, threshold },
      message_ko: `1인당 단가 ${r.per_person.toLocaleString()}원이 P${(q * 100).toFixed(0)}(${Math.round(threshold).toLocaleString()}원) 초과 — ${r.user_raw} / ${r.venue_raw} / ${r.date}`,
    }));
  return { threshold, hits };
}

export function detectVenueTotalOutliers(venueAggregates, q = 0.95) {
  const vals = venueAggregates.map((v) => v.total_amount).sort((a, b) => a - b);
  if (!vals.length) return { threshold: null, hits: [] };
  const threshold = quantile(vals, q);
  const hits = venueAggregates
    .filter((v) => v.total_amount >= threshold)
    .map((v) => ({
      rule: 'venue_total_outlier',
      severity: v.total_amount >= threshold * 1.5 ? 'high' : 'warn',
      evidence: {
        venue_norm: v.venue_norm,
        metric: 'venue_total_amount',
        value: v.total_amount,
        threshold,
      },
      message_ko: `${v.display_name} 누적 사용액 ${v.total_amount.toLocaleString()}원이 P${(q * 100).toFixed(0)}(${Math.round(threshold).toLocaleString()}원) 초과 (${v.total_count}건)`,
    }));
  return { threshold, hits };
}

export function detectVenueBurst(rows, windowDays = 30, q = 0.95) {
  // venue_norm 별로 정렬된 일자에서 windowDays rolling count 분포
  const byVenue = new Map();
  for (const r of rows) {
    if (!r.venue_norm || !r.date) continue;
    if (!byVenue.has(r.venue_norm)) byVenue.set(r.venue_norm, []);
    byVenue.get(r.venue_norm).push(r);
  }
  const allCounts = [];
  const candidates = []; // {venue_norm, ymd, count, last_id}
  const dayMs = 86400 * 1000;
  for (const [venue, list] of byVenue.entries()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let l = 0;
    for (let r = 0; r < list.length; r++) {
      while (
        l <= r &&
        new Date(list[r].date) - new Date(list[l].date) > windowDays * dayMs
      ) {
        l++;
      }
      const cnt = r - l + 1;
      allCounts.push(cnt);
      if (cnt >= 3) {
        candidates.push({
          venue_norm: venue,
          window_end: list[r].date,
          count: cnt,
          last_id: list[r].id,
        });
      }
    }
  }
  allCounts.sort((a, b) => a - b);
  const threshold = quantile(allCounts, q) ?? 5;
  const hits = candidates
    .filter((c) => c.count >= threshold && c.count >= 5) // 최소 5건 이상만 보고
    .map((c) => ({
      rule: 'venue_burst',
      severity: c.count >= threshold * 1.5 ? 'high' : 'warn',
      evidence: {
        venue_norm: c.venue_norm,
        window: `${windowDays}d ending ${c.window_end}`,
        metric: 'rolling_count',
        value: c.count,
        threshold,
      },
      message_ko: `${c.venue_norm} 최근 ${windowDays}일 내 ${c.count}회 사용 (P${(q * 100).toFixed(0)} ${threshold.toFixed(1)} 초과)`,
    }));
  return { threshold, hits };
}

export function detectSameDayMulti(rows, minCount = 3) {
  const key = (r) => `${r.user_raw}|${r.date}`;
  const grouped = new Map();
  for (const r of rows) {
    if (!r.user_raw || !r.date) continue;
    const k = key(r);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(r);
  }
  const hits = [];
  for (const [k, list] of grouped.entries()) {
    if (list.length >= minCount) {
      const total = list.reduce((s, x) => s + (x.amount || 0), 0);
      hits.push({
        rule: 'same_day_multi',
        severity: list.length >= minCount * 2 ? 'high' : 'warn',
        evidence: {
          metric: 'same_day_count',
          value: list.length,
          threshold: minCount,
        },
        message_ko: `${list[0].user_raw} ${list[0].date}에 ${list.length}건 집행 (합계 ${total.toLocaleString()}원)`,
      });
    }
  }
  return { threshold: minCount, hits };
}

export function detectLateNight(rows) {
  const hits = rows
    .filter((r) => r.is_late_night)
    .map((r) => ({
      rule: 'late_night',
      severity: 'info',
      evidence: { id: r.id, metric: 'hour', value: r.hour, threshold: 22 },
      message_ko: `심야/이른새벽 집행 — ${r.user_raw} / ${r.venue_raw} / ${r.date} ${r.time}`,
    }));
  return { threshold: 22, hits };
}

export function runAll(rows, venueAggregates) {
  const pp = detectPerPersonOutliers(rows);
  const vt = detectVenueTotalOutliers(venueAggregates);
  const vb = detectVenueBurst(rows);
  const sd = detectSameDayMulti(rows);
  const ln = detectLateNight(rows);
  return {
    thresholds: {
      per_person_p99: pp.threshold,
      venue_total_p95: vt.threshold,
      venue_burst_p95: vb.threshold,
      same_day_min: sd.threshold,
      late_night_hour_min: ln.threshold,
    },
    anomalies: [...pp.hits, ...vt.hits, ...vb.hits, ...sd.hits, ...ln.hits],
  };
}
