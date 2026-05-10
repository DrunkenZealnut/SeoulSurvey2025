// scripts/lib/md_table.js
// 마크다운 테이블 추출/파싱.
// marker로 추출한 .md에서 헤더/데이터 행을 추출하고 페이지 번호를 함께 부착.

const PAGE_MARKER_RE = /<!--\s*page:\s*(\d+)\s*-->/i;

// 한 줄이 마크다운 표 행인지 (`|`로 시작/끝)
function isRow(line) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|');
}

// 구분선 (`|----|----|...`) 인지. trailing empty 셀의 `--` 같은 짧은 대시도 허용.
function isSeparator(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  // 셀 안 문자가 모두 dash/colon/공백이고 최소 한 cell에 dash 3+ 이상
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
  let hasLong = false;
  for (const c of cells) {
    const s = c.trim();
    if (!/^:?-+:?$/.test(s)) return false;
    if (s.replace(/[:]/g, '').length >= 3) hasLong = true;
  }
  return hasLong;
}

function splitRow(line) {
  // 양 끝 파이프 제거 후 split
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // 셀 안 \| 이스케이프는 marker 출력에서 거의 없으므로 단순 split
  return t.split('|').map((c) => c.trim());
}

const HEADER_KEYS = ['연번', '사용자', '일자', '시간', '장소', '집행목적', '인원', '금액', '방법', '비목'];

function isHeaderRow(cells) {
  if (cells.length < 8) return false;
  const joined = cells.join('|');
  // 모든 키가 부분문자열로 존재하면 헤더로 간주
  return HEADER_KEYS.every((k) => joined.includes(k));
}

// 페이지 헤더 텍스트 (`구의회 업무추진비 집행내역(N월)`, `(단위 : 원)`)인지
function isReportHeaderText(line) {
  const t = line.trim()
    .replace(/<[^>]+>/g, '')
    .replace(/\*+/g, '')
    .replace(/^#+\s*/, '')
    .trim();
  if (/구의회\s*업무추진비\s*집행내역/.test(t)) return true;
  if (/^\(\s*단위\s*:?\s*원\s*\)$/.test(t)) return true;
  return false;
}

/**
 * @param {string} mdContent
 * @returns {Array<{page:number, cells:string[]}>}
 *   데이터 행만 (헤더/구분선/페이지헤더 제외).
 */
export function extractRows(mdContent) {
  const lines = mdContent.split(/\r?\n/);
  const rows = [];
  let page = 0;
  let inTable = false;
  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const pm = line.match(PAGE_MARKER_RE);
    if (pm) {
      // 페이지 마커는 페이지 번호만 갱신. inTable/headerSeen은 유지(표가 페이지를 넘어 이어짐).
      // 표가 끝나는 신호는 isReportHeaderText 또는 일반 텍스트에서 처리됨.
      page = Number(pm[1]) + 1; // 0-based → 1-based
      continue;
    }

    if (isReportHeaderText(line)) {
      inTable = false;
      headerSeen = false;
      continue;
    }

    if (!isRow(line)) {
      inTable = false;
      headerSeen = false;
      continue;
    }

    // 표 행
    if (isSeparator(line)) {
      // 구분선 다음부터 데이터 시작
      inTable = true;
      continue;
    }

    const cells = splitRow(line);
    if (isHeaderRow(cells)) {
      headerSeen = true;
      inTable = false; // 다음 separator를 기다림
      continue;
    }

    // 표 안의 데이터 행만 수집
    if (inTable && headerSeen) {
      rows.push({ page, cells });
    } else if (inTable && !headerSeen) {
      // 일부 marker 출력에서 헤더가 누락된 표가 있을 수 있음 — 그래도 수집
      rows.push({ page, cells });
    }
  }
  return rows;
}

// 행의 끝쪽 빈 셀(마커가 만들어내는 trailing empty pipe) 제거
function trimTrailingEmpty(cells) {
  const out = [...cells];
  while (out.length && String(out[out.length - 1]).trim() === '') out.pop();
  return out;
}

// "승인액 계" 등 합계/소계 행 판별
export function isTotalRow(cells) {
  const first = (cells[0] ?? '').trim();
  return /^(승인액|소계|합계|총\s*계|소\s*계|합\s*계)/.test(first.replace(/\s+/g, ' '));
}

// 홈페이지 자료 헤더 (9컬럼): 연번|사용자|일자|시간|승인금액|가맹점명|내역|인원|결제
// 변형: ① 사용자 빈 행(연속 결재시 생략) → 8컬럼 + _inheritUser=true
//        ② 내역 split → 가운데 합치기
export function mapCellsHomepage(rawCells) {
  // detection은 trailing empty 제거 전에 (인원/결제 빈 셀로 length가 줄어드는 것 방지)
  const detectCells = [...rawCells];

  // 8컬럼 변형 detection: cell[1]이 일자 형식이면 사용자 셀 누락 (연번은 있을/빈 칸 둘 다)
  // LaTeX 래핑($2025 - 09 - 24$) 허용
  const hasDateAtCell1 = /\d{4}\D{0,5}\d{1,2}\D{0,5}\d{1,2}/.test(detectCells[1] ?? '');
  if (hasDateAtCell1) {
    // 8컬럼 변형: cells[0]=연번 cells[1]=일자 cells[2]=시간 cells[3]=금액
    //              cells[4]=식당 cells[5]=내역 cells[6]=인원 cells[7]=결제
    while (detectCells.length < 8) detectCells.push('');
    const len = detectCells.length;
    return {
      seq: detectCells[0],
      user: '',
      _inheritUser: true,
      date: detectCells[1],
      time: detectCells[2],
      amount: detectCells[3],
      venue: detectCells[4],
      purpose:
        len > 8 ? detectCells.slice(5, len - 2).join(' ').trim() : detectCells[5],
      headcount: detectCells[len - 2] ?? '',
      method: detectCells[len - 1] ?? '',
      category: '',
    };
  }

  // 9컬럼/이상 — trailing empty 제거 후 정상 매핑
  const cells = [...rawCells];
  while (cells.length && String(cells[cells.length - 1]).trim() === '') cells.pop();

  while (cells.length < 9) cells.push('');

  // 9컬럼 일반
  if (cells.length === 9) {
    return {
      seq: cells[0],
      user: cells[1],
      date: cells[2],
      time: cells[3],
      amount: cells[4],
      venue: cells[5],
      purpose: cells[6],
      headcount: cells[7],
      method: cells[8],
      category: '',
    };
  }

  // 10+ — 내역(가운데) split 케이스
  const tail = cells.slice(-2);
  const head = cells.slice(0, 6);
  const middle = cells.slice(6, cells.length - 2).join(' ').trim();
  return {
    seq: head[0],
    user: head[1],
    date: head[2],
    time: head[3],
    amount: head[4],
    venue: head[5],
    purpose: middle,
    headcount: tail[0],
    method: tail[1],
    category: '',
  };
}

/**
 * 행의 셀을 표준 컬럼으로 매핑.
 * 동대문구의회 표 컬럼: 연번 | 사용자 | 일자 | 시간 | 장소 | 집행목적 | 인원 | 금액 | 방법 | 비목 (10열)
 * marker가 셀을 합치거나 빈 셀을 만들어내는 변형 처리.
 */
export function mapCells(rawCells) {
  const cells = trimTrailingEmpty(rawCells);
  // 부족하면 패딩
  const canon = [...cells];
  while (canon.length < 10) canon.push('');

  // 정확히 10열인 일반 케이스
  if (canon.length === 10) {
    return {
      seq: canon[0],
      user: canon[1],
      date: canon[2],
      time: canon[3],
      venue: canon[4],
      purpose: canon[5],
      headcount: canon[6],
      amount: canon[7],
      method: canon[8],
      category: canon[9],
    };
  }

  // 11열 이상: 가운데(집행목적)가 split됐거나 venue가 split된 경우
  // 끝 4개(인원/금액/방법/비목)와 앞 5개(연번/사용자/일자/시간/장소)를 보존,
  // 가운데를 모두 합쳐 purpose로 처리
  const tail = canon.slice(-4);
  const head = canon.slice(0, 5);
  const middle = canon.slice(5, canon.length - 4).join(' ').trim();
  return {
    seq: head[0],
    user: head[1],
    date: head[2],
    time: head[3],
    venue: head[4],
    purpose: middle,
    headcount: tail[0],
    amount: tail[1],
    method: tail[2],
    category: tail[3],
  };
}
