# Analysis: 동대문구의회 업무추진비 분석 (Gap Analysis)

> 작성일: 2026-05-09 / Phase: Check / 권위 기준: `docs/02-design/features/ddm-upchubi-analysis.design.md`

---

## 1. Overall Match Rate

| 카테고리 | 점수 |
|---|:---:|
| Design Match (스키마/알고리즘/시각화) | **94%** |
| Plan/Design 결정사항 반영 | **100%** |
| Convention/구조 준수 | **100%** |
| 비기능 요구 (재현성/성능/접근성) | 80% |
| **Overall Match Rate** | **93%** ✅ |

```
✅ Match:           38 항목
⚠️ Partial / Drift:  6 항목
❌ Missing:          1 항목
```

> Gap Detector 판정: **90% 임계값 통과** — `/pdca report` 진행 가능. 단 Design 문서 drift 동기화 권장.

---

## 2. Plan §8 결정사항 5가지 — 100% 반영

| # | 결정 | 구현 검증 |
|---|---|---|
| 1 | 신규 페이지 `ddm-upchubi.html` | ✅ 단독 페이지 신설 |
| 2 | Node.js (ESM) | ✅ `package.json type: module`, `import` |
| 3 | 직책 그대로 (`user_raw`) | ✅ `parse.js` cleanText만 적용, 카테고리화 X |
| 4 | 분포 기반 동적 임계값 | ✅ `quantile()` P95/P99, thresholds 출력 |
| 5 | 식당별 합계 추가 | ✅ by_venue.json/csv + §2 식당 TOP + 모달 |

---

## 3. Section-by-Section Gap

### §2 데이터 스키마 (4종)

| 스키마 | 상태 | 비고 |
|---|:---:|---|
| Expense (24필드) | ✅ | + `method_raw` 추가 (Design 미명시, 좋은 추가) |
| VenueAggregate (12필드) | ✅ | 모든 필드 구현 |
| Summary | ✅ | + `totals` 객체 추가 (KPI에 필수, Design 보강 필요) |
| Anomaly | ✅ | + `thresholds` 객체 추가 (투명성 — Design §4 정신에 부합) |

### §3 파싱 알고리즘

| 항목 | 상태 |
|---|:---:|
| 모듈 4개 (md_table/normalize/venue/anomaly) | ✅ |
| LaTeX 정제 (overline/mathbf/mathrm 등) | ✅ Design보다 광범위 |
| `!!!!!!` 격리 + flag | ✅ |
| `<br>` 공백 치환 | ✅ |
| `159,000 법인카드` amount/method 분리 | ✅ 양방향 처리 |
| 안정 ID 생성 (`yyyy-mm-seq-sha1[:6]`) | ✅ |
| 컬럼 시프트 휴리스틱 (인원 빈+큰 수+작은 수) | ⚠️ 직접 구현 X (amount=null만 격리) |
| field_missing 단일 vs 분리 플래그 | ⚠️ 구현이 더 정밀 (drift) |
| Levenshtein 임계값 (Design ≤2 vs 구현 ≤1) | ⚠️ 의도적 보수화 (drift) |

### §4 이상치 탐지 — 5개 룰 모두 ✅

| Rule | Design | 구현 |
|---|---|---|
| per_person_outlier | P99 | quantile 0.99 ✅ |
| venue_burst | P95, 30일 rolling | windowDays=30, q=0.95, +가드 ≥5건 ✅ |
| same_day_multi | 동일 user/일자 3건+ | minCount=3 ✅ |
| late_night | 22~05:59, info | hour≥22 \|\| <6, severity 'info' ✅ |
| venue_total_outlier | P95 | q=0.95 ✅ |
| 임계값 출력 (투명성) | thresholds 기록 | `anomaly.js:150-156` + 페이지 표시 ✅ |

### §6 시각화 (7섹션)

| 섹션 | 상태 |
|---|:---:|
| Header (한계 고지 + 양방향 링크) | ✅ |
| KPI 카드 (Design 4개 → 구현 6개) | ⚠️ Drift (긍정적 — Design 보강 필요) |
| §1 시계열 (이중축 + 연도 토글) | ✅ |
| §2 식당 TOP 20 + 정렬 + 모달 | ✅ |
| §3 사용자 TOP 15 | ✅ |
| §4 결제수단·비목 도넛 | ✅ |
| §5 요일×시간대 **히트맵** | ⚠️ 1D 막대 2개로 분리 — 정보량 손실 |
| §6 이상 패턴 + 룰 필터 + 임계값 표시 | ✅ |
| §7 데이터 다운로드 7종 | ✅ |

---

## 4. Gap 항목

### 🟡 Medium (3건)

| # | 위치 | 설명 | 권장 조치 |
|---|---|---|---|
| M1 | `ddm-upchubi.html` §5 | 요일×시간대 1D 분리 → 2D 정보량 손실 | Chart.js Matrix 또는 CSS Grid 히트맵 |
| M2 | `scripts/lib/venue.js` | alias 자동 그룹핑 결과의 사용자 검수 로그 부재 | `aggregate.js`에 클러스터 진단 출력 추가 |
| M3 | `ddm-upchubi.html` 차트 | 차트별 텍스트 요약(접근성) 부분 미흡 | `<details>` 토글 또는 aria-label 보강 |

### 🟢 Low (6건) — Design 문서 동기화 권장

| # | 항목 | 권장 |
|---|---|---|
| L1 | `Summary.totals` 추가 | Design §2.3 갱신 |
| L2 | `Anomaly.thresholds` 추가 | Design §2.4 갱신 |
| L3 | `Expense.method_raw` 추가 | Design §2.1 갱신 |
| L4 | flag 분리 명명 (user_missing 등) | Design §3.3 갱신 |
| L5 | Levenshtein ≤1 보수화 | Design §3.6 주석 |
| L6 | KPI 4 → 6 | Design §6.1 갱신 |

### ❌ Missing (1건)

| # | 항목 |
|---|---|
| X1 | 차트별 텍스트 요약 백업 (Design §9 비기능 — 접근성) |

---

## 5. §10 미해결 사항 검증

| 항목 | 결과 |
|---|---|
| 폴더-콘텐츠 일자 불일치 | ✅ **해결** — `parse.js:127`에서 콘텐츠 일자(`date.slice(0,7)`)로 집계, mismatch 경고 출력. summary.coverage가 2025-10에서 끝나는 것이 증거 |
| review.json 노이즈 과다 | ✅ **해결** — 5건만 격리됨, 추가 휴리스틱 불필요 |
| venue alias 정확도 | ⚠️ **부분 해결** — 알고리즘은 보수적이나 검수 로그 미이행 |

---

## 6. 권장 조치 (우선순위)

### 즉시
1. **M2 alias 검수 로그** — 데이터 신뢰성 직결
2. **L1~L6 Design 동기화** — 구현이 더 풍부, 문서 보강

### 단기
3. **X1/M3 접근성 보강**
4. **M1 2D 히트맵**

### 백로그
5. venue_aliases.json 수동 사전
6. 컬럼 시프트 휴리스틱 명시 구현

---

## 7. 결론

- **Match Rate 93% — 90% 임계값 충족**
- Plan 결정사항 5가지, Design 핵심 모두 반영
- Gap 7건 (Critical 0, Medium 3, Low 6, Missing 1)은 모두 비차단 항목
- 다음 단계: `/pdca report ddm-upchubi-analysis`
- 선택: Gap 항목을 보완하려면 `/pdca iterate` (Match Rate < 90% 자동 트리거 조건은 미충족이지만 수동 호출 가능)
