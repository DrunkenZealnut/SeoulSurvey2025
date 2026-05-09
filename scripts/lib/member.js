// scripts/lib/member.js
// 집행목적 텍스트에서 구의원 참석 여부를 추론한다.
//
// 분류:
//   attended      : 의원이 식사 자리에 동석한 것이 매우 명확
//   likely        : 의원 관련 일정·간담회·행사 컨텍스트로 동석 가능성 있음
//   not_attended  : 의원 단어 없음, 또는 의원 자료·연구실·물품 등 행정 처리

// 의원 참석이 명확한 동석 패턴 (STRONG)
const STRONG_PATTERNS = [
  /직원\s*및\s*의원/,
  /사무국\s*및\s*의원/,
  /집행부\s*직원\s*및\s*의원/,
  /의원\s*및\s*직원/,
  /의원\s*및\s*사무국/,
  /의원\s*등\s*간담/,
  /의원\s*간담회/,
  /의원\s*회식/,
  /의원\s*격려/,
  /의원\s*송년회/,
  /의원\s*신년회/,
  /의원\s*간\s*간담/,
  /의장단\s*월례/,
  /의장단\s*간담/,
  /의장단\s*회의/,
  /의원\s*및\s*관계자\s*간담/,    // "의원 및 관계자 간담회" 명백한 동석
  /구의원\s*및\s*집행부/,
  /구의원\s*체련/,
  /의원\s*체련/,
  /구간부\s*및\s*구의원/,
];

// 의원 단어가 있어도 본인 미참석 정황 (REJECT)
const REJECT_PATTERNS = [
  /의원\s*요구\s*자료/,
  /의원요구자료/,
  /의원\s*요구자료/,
  /의원\s*연구실/,
  /의원\s*사무실/,
  /의원\s*요청\s*자료/,
  /의원\s*자료\s*요구/,
  /의원\s*수첩/,
  /의원\s*인터뷰/,
  /의원\s*명패/,
  /의원\s*명함/,
  /의원\s*자녀\s*결혼/,             // 경조사 — 본인 동석 X
  /의원\s*자매도시.*답례품/,
  /의원\s*입법/,                    // 입법 관련 직원 협의
  /구정질문\s*관련\s*업무협의/,       // 의원 발언 자료 직원 준비
];

// 의원 출장·국외 등은 본인 동석 가능성 있는 협의로 likely 처리하기 위한 마커
const LIKELY_MARKERS = [
  /의원\s*국내\s*연수/, /의원\s*국내연수/,
  /의원\s*국외/, /의원\s*해외/,
  /의원\s*워크숍/,
  /구의회의원\s*한마음/, /구의원\s*한마음/,
  /의원\s*및\s*관계자/,    // STRONG에 빠져도 likely로 잡히게
];

const MEMBER_KEYWORDS = /의원|의장|부의장|위원장|상임위원장|운영위원장|예결위|예결특위|의장단|구의회의원/;

export function classifyMemberAttendance(purpose) {
  const p = (purpose || '').replace(/\s+/g, ' ').trim();
  if (!p) return 'not_attended';

  // 1. STRONG 패턴 → 동석
  for (const re of STRONG_PATTERNS) if (re.test(p)) return 'attended';

  // 2. REJECT 패턴 → 미참석 (의원이라는 단어가 있어도 자료/물품/공간 관련)
  for (const re of REJECT_PATTERNS) if (re.test(p)) return 'not_attended';

  // 3. LIKELY 마커 → 가능성 있음
  for (const re of LIKELY_MARKERS) if (re.test(p)) return 'likely';

  // 4. 의원 키워드만 있고 위 패턴에 안 걸리면 likely (보수적 판단)
  if (MEMBER_KEYWORDS.test(p)) return 'likely';

  return 'not_attended';
}

export const MEMBER_LABELS = {
  attended: '의원 동석',
  likely: '의원 동석 가능',
  not_attended: '의원 미동석/사무국 단독',
};

// === 5단계 통합 추론 분류 ===
// 비목(category) + 집행목적 카테고리(purpose_short) + 의원동석(member_attended)을
// 결합해 식사 자리의 성격을 더 세밀하게 분리한다.
//
// 라벨:
//   A_direct           : 🟢 의원 직접 동석 (식사 자리에 의원이 있었음이 명확)
//   B_likely           : 🟡 의원 동석 가능 (의원 관련 일정/주제로 본인 참여 가능)
//   C_council_business : 🔵 의회 안건 사무처리 (시책 비목 + 정례회·의안·보도·행사 등 의원 사안을 사무국이 처리, 본인은 미동석)
//   D_office_self      : ⚪ 사무국 자체 운영 (기관/부서 비목 OR 시책+사무국 자체 업무)
//   E_other            : ▫️ 분류 불가 (OCR 노이즈, 모호한 내용 등)

const COUNCIL_BUSINESS_PURPOSES = new Set([
  '의회 회의', '의안·자료수집', '언론·보도', '현안 협의',
  '행사·기념', '회의록', '관계자 간담',
]);
const OFFICE_SELF_PURPOSES = new Set([
  '경조사·격려', '청사·시설', '인사 업무', '민원·다과',
]);

export function classifyBucket(row) {
  const ma = row.member_attended;
  const cat = row.category;
  const ps = row.purpose_short || '';

  if (ma === 'attended') return 'A_direct';
  if (ma === 'likely') return 'B_likely';

  // not_attended — 비목·용도로 추가 분리
  if (cat === '기관' || cat === '부서') return 'D_office_self';
  if (cat === '시책') {
    if (COUNCIL_BUSINESS_PURPOSES.has(ps)) return 'C_council_business';
    if (OFFICE_SELF_PURPOSES.has(ps)) return 'D_office_self';
  }
  return 'E_other';
}

export const BUCKET_LABELS = {
  A_direct: '의원 직접 동석',
  B_likely: '의원 동석 가능',
  C_council_business: '의회 안건 사무처리',
  D_office_self: '사무국 자체 운영',
  E_other: '분류 불가',
};
export const BUCKET_COLORS = {
  A_direct: '#00A88E',
  B_likely: '#F39C12',
  C_council_business: '#2980B9',
  D_office_self: '#7F8C8D',
  E_other: '#BDC3C7',
};
export const BUCKET_DESC = {
  A_direct: '집행목적에 "직원 및 의원 간담", "의장단 월례", "의원 회식·격려" 등 명확한 동석 패턴이 있는 경우',
  B_likely: '의원 국내·국외 출장, 한마음 체육대회 등 의원 관련 일정으로 본인 참여 가능성 있는 경우',
  C_council_business: '시책 비목 + 의회 회의·의안·보도·행사·현안협의 등 의원 사안을 사무국이 처리(의원 본인은 식사 자리에 없음)',
  D_office_self: '기관/부서 비목 OR 시책+사무국 자체 업무(직원 경조사, 청사시설, 인사업무, 방문민원 응대 등)',
  E_other: 'OCR 깨짐, 광고·홈페이지·음향 등 추론 어려운 일반 운영 협의',
};
