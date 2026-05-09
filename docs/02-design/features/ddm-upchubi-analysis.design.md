# Design: 동대문구의회 업무추진비 분석 (ddm-upchubi-analysis)

> 작성일: 2026-05-09 / Phase: Design / 선행: `docs/01-plan/features/ddm-upchubi-analysis.plan.md`

---

## 0. Plan 결정사항 반영

| # | 결정 | Design 반영 |
|---|------|-------------|
| 1 | 신규 페이지 `ddm-upchubi.html` | §6 와이어프레임에서 단독 페이지 설계 |
| 2 | Node.js | §3 `scripts/*.js`, ESM 모듈 |
| 3 | 직책 그대로 | §2 `user_raw` 필드 그대로 보존 |
| 4 | 분포 기반 동적 임계값 | §4 P95/P99·z-score·rolling window 사용 |
| 5 | 식당별 합계 추가 | §2 venue 집계 스키마, §6 식당 TOP·상세 모달 |

---

## 1. 시스템 구성

```
┌─────────────────────────────────────────────────────────┐
│ ddm_council_upchubi/ (42개 폴더, .md+meta+blocks+png)   │
└─────────────────────────────────────────────────────────┘
              │
              ▼ scripts/parse_ddm_upchubi.js (Node 18+)
┌─────────────────────────────────────────────────────────┐
│ data/ddm_upchubi.raw.json   (원본 행 + 추출 메타)        │
│ data/ddm_upchubi_review.json (OCR 의심 행 격리)          │
└─────────────────────────────────────────────────────────┘
              │
              ▼ scripts/aggregate_ddm_upchubi.js
┌─────────────────────────────────────────────────────────┐
│ data/ddm_upchubi.json       (정제·표준화된 행 단위)      │
│ data/ddm_upchubi.csv        (다운로드용)                 │
│ data/ddm_upchubi_by_venue.json/csv (식당 집계)           │
│ data/ddm_upchubi_summary.json (월/연/사용자/비목 집계)   │
│ data/ddm_upchubi_anomalies.json (이상치 탐지 결과)       │
└─────────────────────────────────────────────────────────┘
              │
              ▼ ddm-upchubi.html (Vanilla JS + Chart.js)
┌─────────────────────────────────────────────────────────┐
│ 시각화 페이지 (dongdaemun.html과 양방향 링크)            │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 데이터 스키마

### 2.1 행 단위 표준 스키마 (`ddm_upchubi.json`)

```ts
type Expense = {
  id: string;                  // "{yyyy-mm}-{seq}-{rowHash6}", 안정 키
  source_folder: string;       // 원본 폴더명
  source_year_month: string;   // 폴더명에서 추출한 yyyy-mm (참고용)
  page: number | null;         // 원본 PDF 페이지 (blocks.json 매핑)

  // 원본 컬럼 (정제 후)
  seq: number | null;          // 연번 (노이즈 시 null, raw 보존)
  seq_raw: string;             // 원본 표기 ("!!!!!!" 등 그대로)
  user_raw: string;            // 사용자 직책 (원본 그대로, 트리밍만)
  date: string;                // ISO "YYYY-MM-DD" (LaTeX 정제)
  date_raw: string;            // 원본 표기
  time: string | null;         // "HH:MM:SS"
  venue_raw: string;           // 장소 원본 (개행/특수문자 포함)
  venue_norm: string;          // 정규화된 장소 (집계 키)
  purpose: string;             // 집행목적
  headcount: number | null;    // 인원
  headcount_raw: string;       // 원본
  amount: number;              // 금액 (원, 콤마 제거)
  amount_raw: string;          // 원본
  method: string;              // 카드/제로페이/법인카드/...
  category: string;            // 비목 (시책 등)

  // 파생/플래그
  year_month: string;          // date 기반 yyyy-mm (집계 권위 키)
  weekday: number;             // 0=일 ~ 6=토
  is_weekend: boolean;
  hour: number | null;
  is_late_night: boolean;      // hour >= 22 또는 < 06
  per_person: number | null;   // amount / headcount
  flags: string[];             // ["seq_corrupt", "purpose_corrupt", "amount_method_merged", "headcount_missing", ...]
};
```

### 2.2 식당(업소) 집계 스키마 (`ddm_upchubi_by_venue.json`)

```ts
type VenueAggregate = {
  venue_norm: string;          // 정규화 키
  display_name: string;        // 표시용 (가장 빈도 높은 venue_raw 변형)
  aliases: string[];           // 매핑된 venue_raw 목록
  total_amount: number;
  total_count: number;
  avg_amount: number;
  avg_per_person: number | null;
  first_used: string;          // ISO date
  last_used: string;
  top_users: { user_raw: string; count: number; amount: number }[];  // TOP 3
  by_year_month: { ym: string; count: number; amount: number }[];
  rank_by_amount: number;      // 1부터
  rank_by_count: number;
};
```

### 2.3 요약 스키마 (`ddm_upchubi_summary.json`)

```ts
type Summary = {
  generated_at: string;
  coverage: { year_month: string; row_count: number; total_amount: number }[];
  by_year: { year: number; total_amount: number; count: number }[];
  by_user: { user_raw: string; total_amount: number; count: number }[];
  by_method: { method: string; total_amount: number; count: number }[];
  by_category: { category: string; total_amount: number; count: number }[];
  by_weekday: { weekday: number; total_amount: number; count: number }[];
  by_hour_bucket: { bucket: string; count: number }[];  // 00-05/06-11/12-17/18-21/22-23
};
```

### 2.4 이상치 결과 스키마 (`ddm_upchubi_anomalies.json`)

```ts
type Anomaly = {
  rule: "per_person_outlier" | "venue_burst" | "same_day_multi" | "late_night" | "venue_total_outlier";
  severity: "info" | "warn" | "high";
  evidence: { id?: string; venue_norm?: string; window?: string; metric: string; value: number; threshold: number };
  message_ko: string;
};
```

---

## 3. 파싱 알고리즘 (Node.js)

### 3.1 모듈 구성

```
scripts/
├── parse_ddm_upchubi.js     # 폴더 순회 → raw 추출 + 격리
├── aggregate_ddm_upchubi.js # 정제 → summary/venue/anomaly
└── lib/
    ├── md_table.js          # 마크다운 테이블 파서
    ├── normalize.js         # LaTeX·노이즈 정제 함수 모음
    ├── venue.js             # 장소 정규화 + alias 그룹핑
    └── anomaly.js           # 이상치 탐지 룰
```

### 3.2 `parse_ddm_upchubi.js` 흐름

1. `ddm_council_upchubi/` 하위 폴더 나열 → 폴더명에서 `(yyyy-mm)` 추출
2. 폴더 안의 동명 `.md` 읽기 (2가지 명명 규칙 모두 지원)
3. `<!-- page: N -->` 마커로 페이지 분할 (메타로 활용)
4. 마크다운 테이블 블록만 추출 (헤더 행: `| 연번 | 사용자 |...`)
5. 각 행을 cell 배열로 분해 후 §3.3 정제 적용
6. 헤더 반복 행(`구의회 업무추진비 집행내역(M월)`, `(단위 : 원)`) 필터
7. 결과를 `raw.json`에 누적, 의심 행은 `review.json`로 분리

### 3.3 정제 규칙 (`lib/normalize.js`)

| 패턴 | 처리 |
|------|------|
| `$2022 - 07 - 01$` 또는 `$2022 - 07 - 01$` | 정규식 `\$?\s*(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s*\$?` → `YYYY-MM-DD` |
| `$\overline{4}$`, `$\mathbf{2}$`, `$12 \overline{ }$` | LaTeX 명령어 제거 후 숫자만 추출 (`\\overline\{[^}]*\}`, `\\mathbf\{[^}]*\}` 등) |
| `!!!!!!...` | 해당 셀 null + flag 추가 (`seq_corrupt`/`purpose_corrupt` 등) |
| 셀 내 `<br>` | 공백으로 치환 (장소 다행 처리) |
| 빈 셀 | `null` + flag(`field_missing`) |
| `159,000 법인카드` (금액-방법 병합) | 정규식 `^([\d,]+)\s+(.+)$`로 분리, 분리 가능 시 amount/method 양쪽 채우고 `amount_method_merged` flag |
| 인원 빈 + 금액에 큰 수 + 방법에 작은 수 | 컬럼 시프트 의심 → review로 격리 |
| 금액 콤마 | 제거 후 `Number()` 변환, NaN 시 review |
| 시간 LaTeX | 동일하게 정제 |

### 3.4 행 유효성 판정

- **유효(통계 포함)**: `date && amount > 0 && user_raw`
- **부분 유효(통계 포함, flag 부착)**: 위 + seq/purpose 노이즈
- **무효(review로 격리)**: date 추출 실패 OR amount 추출 실패 OR 헤더 라인

### 3.5 안정 ID 생성

```js
id = `${year_month}-${seq ?? 'x'}-${sha1(date|user_raw|amount|venue_raw).slice(0,6)}`
```

### 3.6 장소 정규화 (`lib/venue.js`)

1. 트리밍, 다중 공백 단일화, `<br>` 제거, 괄호 영문(예: `(b b q)`) 공백 제거
2. 한자/특수문자 제거 후 NFC 정규화
3. **fuzzy 그룹핑**: Levenshtein ≤ 2 이고 길이 차 ≤ 2 인 경우 같은 그룹
4. 그룹 내 빈도 최댓값 표기를 `display_name`으로 사용
5. 수동 alias 사전 (`scripts/lib/venue_aliases.json`)으로 보강 가능

> **검증 안전장치**: alias 자동 그룹핑 결과를 콘솔 출력 + 사용자 검수 권장

---

## 4. 이상치 탐지 룰 (분포 기반)

| Rule | 정의 | 임계값 |
|------|------|--------|
| `per_person_outlier` | 1인당 단가 outlier | 분포의 P99 초과 |
| `venue_burst` | 30일 rolling window 동일 venue 사용 횟수 | 전체 venue 분포 P95 초과 |
| `same_day_multi` | 동일 user_raw + 동일 일자 다중 집행 | 3건 이상 |
| `late_night` | 22:00~05:59 집행 | 항상 info |
| `venue_total_outlier` | venue 누적 사용액 | 분포 P95 초과 |

> 모든 임계값은 코드 상수가 아닌 산정 결과를 함께 anomalies 출력에 기록(투명성 확보).

---

## 5. 합계 검증 (Sanity Check)

- **월 단위**: `Σ amount` per `year_month`을 콘솔 출력 + summary에 기록
- **샘플 PDF 대조**: 무작위 3개월(2022-12, 2024-06, 2025-09) 페이지 PNG와 1차 합계를 사람이 비교 (Do phase 체크리스트)
- **컬럼 시프트 의심 행**: review.json 별도 분리, 사용자 검수 후 수동 보정 가능

---

## 6. 시각화 (`ddm-upchubi.html`)

### 6.1 페이지 레이아웃

```
┌────────────────────────────────────────────────────┐
│ Header — 동대문구의회 업무추진비 분석                │
│   - 데이터: 2022.07~2025.12 (42개월)                │
│   - 출처/한계 고지 박스                              │
│   - dongdaemun.html ↔ 본 페이지 링크                │
├────────────────────────────────────────────────────┤
│ KPI 카드 4개                                        │
│   총 집행액 / 총 건수 / 평균 1인당 / 데이터 커버리지 │
├────────────────────────────────────────────────────┤
│ §1 시계열                                            │
│   월별 집행액 라인 + 건수 바 (이중 축)              │
│   연도 비교 토글                                     │
├────────────────────────────────────────────────────┤
│ §2 식당(업소) TOP 20  ← Plan 5번 결정 반영           │
│   - 막대차트 + 정렬 토글(금액/건수)                  │
│   - 행 클릭 → 모달: 시계열·사용자 분포·평균 단가    │
│   - CSV 다운로드 버튼                                │
├────────────────────────────────────────────────────┤
│ §3 사용자(직책) TOP 15                               │
│   - 원본 표기 그대로                                 │
├────────────────────────────────────────────────────┤
│ §4 비목·결제수단 도넛                                │
├────────────────────────────────────────────────────┤
│ §5 요일×시간대 히트맵                                │
├────────────────────────────────────────────────────┤
│ §6 이상 패턴 보고                                    │
│   - 분포 기반 임계값 명시                            │
│   - 룰별 리스트 + 증거 링크                          │
├────────────────────────────────────────────────────┤
│ §7 데이터 다운로드                                   │
│   - JSON / CSV / Venue CSV / Anomalies              │
├────────────────────────────────────────────────────┤
│ Footer — 데이터 한계 / OCR 주의 사항                 │
└────────────────────────────────────────────────────┘
```

### 6.2 기술 스택

- **Vanilla JS + Chart.js 4.x** (CDN), 빌드 도구 없음
- 데이터 fetch: 정적 `data/*.json` 비동기 로드
- 모달: HTML `<dialog>` 사용
- 스타일: `dongdaemun.html`과 동일 톤 (CSS 변수 재사용)

### 6.3 양방향 링크
- `dongdaemun.html` 상단·하단에 "업무추진비 분석" 링크 추가
- `ddm-upchubi.html` 헤더에 "동대문구 분석으로 돌아가기" 링크

---

## 7. 디렉터리 영향

```
SeoulSurvey2025/
├── ddm-upchubi.html                          [신규]
├── dongdaemun.html                           [수정 - 링크 추가만]
├── scripts/
│   ├── parse_ddm_upchubi.js                  [신규]
│   ├── aggregate_ddm_upchubi.js              [신규]
│   └── lib/
│       ├── md_table.js
│       ├── normalize.js
│       ├── venue.js
│       ├── anomaly.js
│       └── venue_aliases.json (선택)
├── data/
│   ├── ddm_upchubi.raw.json                  [신규]
│   ├── ddm_upchubi.json                      [신규]
│   ├── ddm_upchubi.csv                       [신규]
│   ├── ddm_upchubi_by_venue.json/csv         [신규]
│   ├── ddm_upchubi_summary.json              [신규]
│   ├── ddm_upchubi_anomalies.json            [신규]
│   └── ddm_upchubi_review.json               [신규]
└── docs/
    ├── 01-plan/features/ddm-upchubi-analysis.plan.md
    └── 02-design/features/ddm-upchubi-analysis.design.md
```

---

## 8. 구현 순서 (Do Phase 권장)

1. `lib/md_table.js` + `lib/normalize.js` 작성 (단위 테스트 가능 단순 함수)
2. `parse_ddm_upchubi.js` — 1개 폴더로 PoC, 그 후 42개 일괄
3. 합계 sanity check + review.json 검수 (수동 1회)
4. `lib/venue.js` 정규화 → alias 결과 검수
5. `aggregate_ddm_upchubi.js` — 식당/사용자/시계열/비목 집계
6. `lib/anomaly.js` + 분위수 산정
7. `ddm-upchubi.html` 정적 차트(시계열·식당 TOP) 먼저
8. 모달·이상치 보고·다운로드 추가
9. `dongdaemun.html` 링크 연결
10. 최종 검증 및 데이터 한계 고지 문구 다듬기

---

## 9. 비기능 요구

- **재현성**: `node scripts/parse_ddm_upchubi.js && node scripts/aggregate_ddm_upchubi.js` 한 줄로 모든 데이터 재생성
- **무외부 의존 최소화**: 표 파싱은 자작 함수로(외부 npm 의존 0~1개)
- **성능**: 42개 파일 파싱 ≤ 5초 (단순 파싱), 집계 ≤ 2초 (M3 Pro 기준)
- **접근성**: 차트 옆 텍스트 요약 병기

---

## 10. 미해결 사항 (Do 진입 전 체크)

- [ ] `2025-12_180874` 폴더 내용이 실제 `2024-12` 데이터인 사례 확인 — **콘텐츠 일자 기준으로 집계**(폴더명 신뢰 X)
- [ ] OCR 노이즈 격리 후 review.json 항목이 너무 많으면 추가 휴리스틱 필요
- [ ] venue alias 자동 그룹핑 정확도가 낮으면 수동 alias 사전 비중 증가
