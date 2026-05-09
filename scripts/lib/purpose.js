// scripts/lib/purpose.js
// 집행목적(purpose) 텍스트 → 카테고리 매핑.
// 우선순위 매칭: 위쪽 카테고리부터 확인하고 첫 매치 사용.

const RULES = [
  {
    cat: '의회 회의 (임시회/정례회/본회의)',
    short: '의회 회의',
    test: (p) =>
      /(제\s*\d{2,3}\s*회)|임시회|정례회|본회의|운영위|예산결산|상임위|위원회/.test(p),
  },
  {
    cat: '의안·자료수집 / 의정활동',
    short: '의안·자료수집',
    test: (p) => /의안자료|자료수집|의정활동|의원\s*요구자료|요구자료/.test(p),
  },
  {
    cat: '언론·보도',
    short: '언론·보도',
    test: (p) => /보도|기자|언론|지역매체|매체|취재|홍보\s*영상|인터뷰|생방송|방송/.test(p),
  },
  {
    cat: '인사 업무',
    short: '인사 업무',
    test: (p) => /인사업무|인사\s*관련|인사관리|인사\s*협의|인사이동/.test(p),
  },
  {
    cat: '개원식·행사·기념',
    short: '행사·기념',
    test: (p) => /개원식|신년\s*인사회|신년인사회|기념\s*행사|행사|시상|위촉/.test(p),
  },
  {
    cat: '방문민원·다과·음료 구입',
    short: '민원·다과',
    test: (p) => /방문민원|민원인|다과|음료|간식\s*구매|간식\s*구입|도시락|음료\s*구입/.test(p),
  },
  {
    cat: '회의록·속기',
    short: '회의록',
    test: (p) => /회의록|속기/.test(p),
  },
  {
    cat: '의회 청사·시설',
    short: '청사·시설',
    test: (p) => /청사|연구실|환경개선|유지보수|시설|보수|정비/.test(p),
  },
  {
    cat: '경조사·격려',
    short: '경조사·격려',
    test: (p) => /경조|조의|위로|격려/.test(p),
  },
  {
    cat: '현안업무·운영 협의',
    short: '현안 협의',
    test: (p) => /현안업무|의회현안|운영현안|업무\s*협의|업무협의|운영\s*협의|업무\s*추진/.test(p),
  },
  {
    cat: '유관기관·관계자 간담',
    short: '관계자 간담',
    test: (p) => /유관기관|관계자|관계\s*직원|기관\s*관계/.test(p),
  },
];

export function classifyPurpose(p) {
  const text = (p || '').replace(/\s+/g, ' ').trim();
  if (!text || /^!{3,}$/.test(text)) return { cat: '미상·노이즈', short: '미상' };
  for (const r of RULES) {
    if (r.test(text)) return { cat: r.cat, short: r.short };
  }
  return { cat: '기타', short: '기타' };
}

export const ALL_CATEGORIES = RULES.map((r) => ({ cat: r.cat, short: r.short }))
  .concat([{ cat: '기타', short: '기타' }, { cat: '미상·노이즈', short: '미상' }]);
