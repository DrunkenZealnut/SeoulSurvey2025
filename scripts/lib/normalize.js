// scripts/lib/normalize.js
// LaTeX/OCR 노이즈 정제 유틸. 모든 함수는 순수함수.

const LATEX_CMD_RE = /\\(?:overline|mathbf|mathit|mathrm|text|bm|boldsymbol|underline|tilde|hat|bar|vec)\s*\{([^{}]*)\}/g;
const LATEX_DOLLAR_RE = /^\$([\s\S]*?)\$$/;
const NUM_ONLY_RE = /\d+/g;

export function stripLatex(s) {
  if (s == null) return '';
  let out = String(s).trim();
  // $...$ 이중 래핑 한 번 벗기기
  const m = out.match(LATEX_DOLLAR_RE);
  if (m) out = m[1];
  // \overline{4} → 4 등
  out = out.replace(LATEX_CMD_RE, '$1');
  // 잔여 $ 제거
  out = out.replace(/\$/g, '');
  // 잔여 \명령어{} 제거 (인자 통과)
  out = out.replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1');
  // 잔여 단독 백슬래시 명령어 제거
  out = out.replace(/\\[a-zA-Z]+/g, '');
  return out.trim();
}

export function isCorrupt(s) {
  if (s == null) return true;
  const t = String(s).trim();
  if (!t) return true;
  if (/^!{5,}$/.test(t)) return true;
  return false;
}

export function parseDate(s) {
  if (s == null) return null;
  const stripped = stripLatex(s);
  // YYYY-M-D, YYYY - MM - DD, 공백/하이픈 변형 허용
  const m = stripped.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2].padStart(2, '0');
  const d = m[3].padStart(2, '0');
  // 유효성 간이 검증
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${y}-${mo}-${d}`;
}

export function parseTime(s) {
  if (s == null) return null;
  const stripped = stripLatex(s);
  const m = stripped.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const ss = (m[3] || '00').padStart(2, '0');
  if (+hh > 23 || +mm > 59 || +ss > 59) return null;
  return `${hh}:${mm}:${ss}`;
}

export function parseInt0(s) {
  if (s == null) return null;
  const stripped = stripLatex(s);
  const nums = stripped.match(NUM_ONLY_RE);
  if (!nums) return null;
  // 첫 숫자 토큰만 사용
  const n = Number(nums[0]);
  return Number.isFinite(n) ? n : null;
}

export function parseAmount(s) {
  if (s == null) return null;
  const stripped = stripLatex(s);
  // 토큰 단위로 본 뒤 콤마를 제거해 숫자만 추출 — "159,000" 하나로 보존.
  const tokens = stripped.split(/\s+/).filter(Boolean);
  let max = -Infinity;
  for (const t of tokens) {
    // 토큰이 콤마+숫자 패턴이면 콤마 제거 후 숫자로 변환
    if (/^[\d,]+(\.\d+)?$/.test(t)) {
      const n = Number(t.replace(/,/g, ''));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max === -Infinity ? null : max;
}

// "159,000 법인카드" 같은 amount+method 병합 셀 분리
// 반환: { amount, method, merged }
export function splitAmountMethod(amountCell, methodCell) {
  const a = stripLatex(amountCell ?? '').trim();
  const m = stripLatex(methodCell ?? '').trim();

  // amount 셀에 amount + method가 같이 있는 경우
  // 예: "159,000 법인카드"
  const merged = a.match(/^([\d,]+)\s+(\S.*)$/);
  if (merged) {
    return {
      amount: parseAmount(merged[1]),
      method: merged[2] || m,
      merged: true,
    };
  }

  // method 셀에 amount + method가 같이 있는 경우 (인원→amount, amount→method 시프트)
  // 예: amountCell="" methodCell="159,000 법인카드"
  if (!a && m) {
    const merged2 = m.match(/^([\d,]+)\s+(\S.*)$/);
    if (merged2) {
      return {
        amount: parseAmount(merged2[1]),
        method: merged2[2],
        merged: true,
      };
    }
  }

  return {
    amount: parseAmount(a),
    method: m,
    merged: false,
  };
}

export function cleanText(s) {
  if (s == null) return '';
  return stripLatex(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KNOWN_METHODS = ['법인카드', '제로페이', '현금', '카드'];
export function normalizeMethod(s) {
  if (s == null) return '';
  const t = cleanText(s).replace(/<[^>]+>/g, '').replace(/['"`▌│{}\\\-]/g, '').trim();
  for (const m of KNOWN_METHODS) {
    if (t.includes(m)) return m;
  }
  return t || '';
}

export function isWeekend(isoDate) {
  if (!isoDate) return false;
  const d = new Date(isoDate + 'T00:00:00Z');
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  return wd === 0 || wd === 6;
}

export function weekday(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.getUTCDay();
}

export function hourOf(time) {
  if (!time) return null;
  const m = time.match(/^(\d{2}):/);
  return m ? Number(m[1]) : null;
}

export function isLateNight(hour) {
  if (hour == null) return false;
  return hour >= 22 || hour < 6;
}
