# Report: 동대문구의회 업무추진비 분석 (Completion Report)

> 작성일: 2026-05-09 / Phase: Completed / Match Rate: **93%**

---

## Executive Summary

| 항목 | 내용 |
|------|------|
| Feature | 동대문구의회 업무추진비 4년치 데이터 정형화·집계·시각화 |
| 시작 → 완료 | 2026-05-09 (Plan/Design/Do/Check/Report 단일 세션) |
| Match Rate | **93%** (90% 임계값 통과) |
| 처리 행 | **1,317건** (중복 59건 제거 후) · OCR 격리 5건 |
| 커버리지 | **40개월** (2022-07 ~ 2025-10, 폴더 42개 중 2개는 2024년 중복본) |
| 산출 코드 | 6 scripts (1,111 LOC) + 1 HTML (439 LOC) + 1 HTML 수정 |
| 데이터 산출물 | JSON 5종 + CSV 2종 (총 약 2.95 MB) |
| 신규 페이지 | `ddm-upchubi.html` (KPI 6, 차트 6, 테이블 1, 모달 1, 다운로드 7) |

### Value Delivered (4 Perspectives) — 실측 기반

| 관점 | 내용 |
|------|------|
| **Problem (문제)** | 동대문구의회가 공개한 42개월치 업무추진비 PDF가 OCR 노이즈(LaTeX `$2022 - 07 - 01$`, `$\overline{4}$`, `!!!!!!!!`, 컬럼 시프트)와 다양한 직책·장소 표기로 정형화되지 않은 상태였음. 폴더-콘텐츠 일자 불일치(2025-11/12 폴더 = 2024-11/12 데이터) 같은 데이터 신뢰성 함정도 있었음. |
| **Solution (해결)** | Node.js ESM 파이프라인 2단계(파싱→집계)로 1,317건을 정제, 267개 식당 fuzzy 그룹핑, 5종 분포 기반 이상치 자동 탐지(P95/P99 임계값 자체 기록). 단일 명령 `npm run build:data`로 전체 재현 가능. 외부 npm 의존 0개. |
| **Function UX Effect (기능·UX 효과)** | 신규 페이지 `ddm-upchubi.html`에 6개 KPI + 시계열(연도 토글) + 식당 TOP 20(정렬·모달) + 직책 TOP 15 + 결제수단/비목 도넛 + 요일/시간 분포 + 이상 패턴(룰별 필터) + 다운로드 7종 제공. 시민이 30초 안에 "어디에 얼마를"을 파악, 식당 클릭으로 시계열·주 사용자까지 드릴다운. |
| **Core Value (핵심 가치)** | 4년치 공공 데이터의 **정형 데이터셋(JSON/CSV) 공개**로 시민·언론·연구자의 의정 모니터링 도구화. 데이터 한계(OCR/일자 불일치/alias 그룹핑)를 페이지 상단·다운로드 컬럼에서 명시해 신뢰성 확보. 분포 기반 임계값 산정 결과 자체를 공개해 "왜 이상치인지" 투명하게 설명. |

---

## 1. 발견 (Findings)

### 1.1 데이터 인사이트

| 카테고리 | TOP 3 |
|---|---|
| 식당 (금액) | 청마루한우 1,950만/121건 · 최강낙지 887만/67건 · 마루샤브 용두직영점 692만/5건 |
| 식당 (건수) | 청마루한우 121 · 최강낙지 67 · 경성농장 46 |
| 직책 (금액) | 의정팀장 2,158만/126건 · 국주임 1,935만/112건 · 국서무 1,741만/80건 |
| 결제수단 | 법인카드 7,515만(50%) · 카드 5,562만(37%) · 제로페이 1,986만(13%) |

### 1.2 이상 패턴 (101건, 분포 기반)

| 룰 | 산정 임계값 | 적발 |
|---|---|---|
| 1인당 단가 P99 | 33,039원 | 13건 |
| 식당 누적 P95 | 2,055,000원 | 14건 |
| 30일 rolling 동일 식당 P95 | 4회/30일 (실효 임계 5회) | 61건 |
| 동일 사용자/일자 | 3건+ | 10건 |
| 심야 (22시~05:59) | 22시 | 3건 |

### 1.3 데이터 품질 이슈

- **폴더-콘텐츠 일자 불일치 2건**: `2025-11/12` 폴더 → 실제 `2024-11/12` 데이터 (재발행본). 콘텐츠 일자 기준 집계로 안전 처리.
- **중복 59건 제거**: 폴더 재발행으로 인한 중복.
- **OCR 격리 5건**: amount 추출 실패한 행. `data/ddm_upchubi_review.json`로 분리.
- **2025-11/12 실데이터 부재**: 대시보드 커버리지가 2025-10에서 끝나는 이유. 페이지 상단에 명시.

---

## 2. PDCA 사이클 요약

| Phase | 산출 | 비고 |
|-------|------|------|
| **Plan** | `docs/01-plan/features/ddm-upchubi-analysis.plan.md` | 4 perspective Value Delivered + 5 결정사항 |
| **Design** | `docs/02-design/features/ddm-upchubi-analysis.design.md` | 시스템 구성, 4 스키마, 정제 규칙 8, 이상치 5룰, 7섹션 와이어프레임 |
| **Do** | scripts 6개(1,111 LOC) + HTML 1개(439 LOC) + dongdaemun.html 링크 | `npm run build:data` 한 줄 재현 |
| **Check** | `docs/03-analysis/ddm-upchubi-analysis.analysis.md` | gap-detector Match Rate 93% |
| **Report** | 본 문서 | Match Rate ≥ 90% 충족 |

### 2.1 Plan 결정사항 5가지 — 100% 반영

| # | 결정 | 결과 |
|---|------|------|
| 1 | 신규 페이지 `ddm-upchubi.html` | ✅ |
| 2 | Node.js (ESM) | ✅ `package.json type:module` |
| 3 | 직책 그대로 | ✅ `user_raw` 카테고리화 X |
| 4 | 분포 기반 동적 임계값 | ✅ P95/P99 + thresholds 출력 |
| 5 | 식당별 합계 추가 | ✅ by_venue.json/csv + TOP·모달 |

---

## 3. 산출물

### 3.1 코드 (1,550 LOC)

| 파일 | LOC | 역할 |
|------|-----|------|
| `scripts/lib/normalize.js` | 163 | LaTeX 정제, 일자/금액/시간 파싱, 결제수단 표준화 |
| `scripts/lib/md_table.js` | 174 | 마크다운 표 추출 + 셀 매핑 + 합계 행 필터 |
| `scripts/lib/venue.js` | 109 | 식당명 정규화 + Levenshtein fuzzy 그룹핑 |
| `scripts/lib/anomaly.js` | 159 | 분포 기반 5종 이상치 |
| `scripts/parse_ddm_upchubi.js` | 250 | 42 폴더 → raw.json + review.json (중복 제거) |
| `scripts/aggregate_ddm_upchubi.js` | 256 | 정제 → 행/식당/요약/이상치 |
| `ddm-upchubi.html` | 439 | 시각화 페이지 (Vanilla JS + Chart.js 4.4.7 CDN) |
| `dongdaemun.html` | +6 | 헤더에 양방향 링크 추가 |
| `package.json` | 9 | `npm run build:data` |

### 3.2 데이터 (총 약 2.95 MB)

| 파일 | 크기 | 내용 |
|------|------|------|
| `data/ddm_upchubi.json` | 1.17 MB | 정제된 1,317행 (24필드) |
| `data/ddm_upchubi.csv` | 266 KB | 다운로드용 |
| `data/ddm_upchubi.raw.json` | 1.15 MB | 1차 정제 + flag 부착 |
| `data/ddm_upchubi_by_venue.json` | 270 KB | 267 식당 집계 |
| `data/ddm_upchubi_by_venue.csv` | 26 KB | 식당 집계 다운로드 |
| `data/ddm_upchubi_summary.json` | 10 KB | 시계열·사용자·결제수단·비목·요일·시간 |
| `data/ddm_upchubi_anomalies.json` | 34 KB | 101건 이상치 + 임계값 |
| `data/ddm_upchubi_review.json` | 3 KB | OCR 실패 격리 5건 |

### 3.3 시각화 페이지 구성

KPI 카드 6 → 시계열(연도 토글 5) → 식당 TOP 20(정렬 토글 + 모달) → 직책 TOP 15 → 결제수단/비목 도넛 → 요일/시간 분포 → 이상 패턴(룰 필터 6) → 다운로드 7종

---

## 4. Gap (잔존)

> Match Rate 93% — 모두 비차단(non-blocking).

| Severity | 건 | 항목 |
|----------|----|------|
| 🔴 Critical | 0 | — |
| 🟡 Medium | 3 | M1 요일×시간 2D 히트맵, M2 alias 검수 로그, M3 차트 접근성 |
| 🟢 Low | 6 | Design 문서 6개 drift 동기화 (구현이 더 풍부) |
| ❌ Missing | 1 | 차트별 텍스트 요약 백업 |

후속 권장: `/pdca iterate ddm-upchubi-analysis`로 Medium 3건 자동 보완 가능.

---

## 5. 회고 (Lessons Learned)

### 잘된 점
- **2단계 파이프라인**(parse → aggregate)이 디버깅·재실행 모두 유리. amount 콤마 버그·11열 표·합계 행 등 3가지 버그를 단일 명령 재실행으로 빠르게 수정.
- **콘텐츠 일자 권위 원칙**이 폴더 명명 함정을 사전에 차단.
- **분포 기반 임계값**이 정성적 기준(예: 5만원 초과)보다 데이터 적응적이며 투명성도 높음.
- **외부 의존 0개**로 보안·재현성 모두 안전.

### 개선 여지
- venue fuzzy 클러스터링 결과를 사람이 직접 검토할 수 있는 **진단 출력 부재**가 신뢰도에 영향.
- 정적 페이지의 **접근성**(차트 텍스트 백업)이 Design 명세 대비 미흡.
- Design 문서가 구현 이후 6곳에서 drift — 구현 중 발견된 추가 필드(`totals`, `thresholds`, `method_raw` 등)를 Design에 역피드백할 자동 루틴 부재.

### 재사용 가치
- LaTeX/OCR 정제 라이브러리는 다른 자치구 PDF에도 그대로 활용 가능 (확장 시 `scripts/lib/` 하위에 별도 normalize 함수 추가).
- 분포 기반 이상치 + 임계값 출력 패턴은 다른 공공 데이터 분석에도 일반화 가능.

---

## 6. 다음 단계 옵션

| 액션 | 명령 |
|------|------|
| 잔존 Gap 자동 보완 | `/pdca iterate ddm-upchubi-analysis` |
| 코드 리뷰 정리 | `/simplify` (코드 정리·반복 제거) |
| 아카이브 (사이클 종료) | `/pdca archive ddm-upchubi-analysis` |
| 다른 자치구 확장 | `/pdca plan {구}-upchubi-analysis` |

---

## 7. 참조

- Plan: `docs/01-plan/features/ddm-upchubi-analysis.plan.md`
- Design: `docs/02-design/features/ddm-upchubi-analysis.design.md`
- Analysis: `docs/03-analysis/ddm-upchubi-analysis.analysis.md`
- 페이지: `ddm-upchubi.html` (로컬: `python3 -m http.server` 후 `/ddm-upchubi.html`)
- 출처: 동대문구의회 공개 PDF 자료 (`/ddm_council_upchubi/` 42 폴더)
