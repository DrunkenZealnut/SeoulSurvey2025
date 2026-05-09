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
