// REPORT ENGINE REPORT-1 — 모든 리포트가 공유하는 공통 계약.
//
// 왜 envelope인가: 템플릿(UI)이 raw 테이블을 각자 조회하면, 취소건 제외/16코드 스코프/
// LEFT JOIN 규칙 같은 신뢰 규칙이 화면 수만큼 복제되고 그중 하나만 어긋나도 조용히
// 틀린 리포트가 나간다. 그래서 **데이터 레이어가 envelope 하나를 만들고 템플릿은 그것만
// 읽는다**(REPORT_ENGINE_V1_ARCHITECTURE.md §7).
//
// 이 파일은 Prisma를 import하지 않는다 — 순수 타입만 두어야 .test.mjs에서 직접 쓸 수 있다.

/** 리포트 종류. REPORT-1은 REGION_* 만 구현하지만, 계약은 나머지를 막지 않는다. */
export type ReportType =
  | 'REGION_CITY'
  | 'REGION_DISTRICT'
  | 'REGION_DONG'
  | 'APARTMENT_DETAIL'
  | 'APARTMENT_COMPARE'
  | 'DAILY_NEW_TRADES';

/**
 * 지표 단위의 신뢰 등급. Compare V2의 MetricTrust와 **같은 낱말**을 의도적으로 쓴다
 * (src/lib/compare-v2/types.ts) — 두 곳이 다른 어휘를 쓰면 같은 값이 화면마다 다른
 * 의미로 읽힌다.
 *
 * SAFE    원본 그대로 계산됐고 표본도 충분하다.
 * LIMITED 계산은 됐지만 표본/커버리지 한계가 있어 강한 해석에 쓰면 안 된다.
 * UNSAFE  계산은 가능하나 현재 데이터 계약으로는 의미를 보장할 수 없다(표시 금지 권장).
 * MISSING 값이 없다. **추정하지 않는다.**
 */
export type MetricTrust = 'SAFE' | 'LIMITED' | 'UNSAFE' | 'MISSING';

/** 리포트 전체의 완전성. 지표별 trust를 **덮어쓰지 않고 요약**한다(§3). */
export type ReportCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNVERIFIED';

export interface MetricSource {
  /** 어느 테이블/API에서 왔는지. 사후 추적용. */
  source: string;
  /** 그 소스가 마지막으로 검증/수집된 시각. 없으면 null(모른다고 말한다). */
  dataAsOf: string | null;
}

export interface ReportMetric<V = number | string | null> {
  key: string;
  label: string;
  /** 계산된 원시값. MISSING이면 반드시 null. */
  value: V | null;
  /** 화면 표기용 문자열. 값이 없으면 '정보 없음'을 그대로 넣는다(빈 문자열 금지). */
  displayValue: string;
  unit: string | null;
  trust: MetricTrust;
  /** trust가 SAFE가 아닐 때 그 이유. SAFE면 null. */
  reason: string | null;
  /** 이 지표를 만든 표본 수(해당되는 경우만). */
  sampleSize: number | null;
  source: MetricSource;
}

/** 표본 충분성 판정. UI 문구는 여기서 정하지 않는다(§9). */
export interface SampleGate {
  sampleSize: number;
  /** 표본을 센 기간(예: '최근 1년'). */
  sampleWindow: string;
  /** 강한 비교/해석을 붙여도 되는가. */
  sampleSufficient: boolean;
  /** 불충분할 때 이유. 충분하면 null. */
  reason: string | null;
}

/** 리포트 스코프. identity는 항상 코드/aptSeq 기준(표시명 아님). */
export interface ReportScope {
  level: 'CITY' | 'DISTRICT' | 'DONG' | 'APARTMENT' | 'COMPARE' | 'DAILY';
  /** 부산 전체는 null. 구/동은 16코드 중 하나. */
  lawdCd: string | null;
  /** 동 리포트에서만 사용. */
  dong: string | null;
  /** 아파트/비교 리포트용. REPORT-1에서는 사용하지 않는다. */
  aptSeqs: string[] | null;
  /** 사람이 읽는 이름. identity가 아니라 표시용이다. */
  displayName: string;
}

export interface ReportPeriod {
  /** 포함(inclusive) 시작일 YYYY-MM-DD. */
  start: string;
  /** 포함(inclusive) 종료일 YYYY-MM-DD. */
  end: string;
  label: string;
}

export interface ReportTrust {
  completeness: ReportCompleteness;
  /** 취소건을 뺐는지. REPORT-1은 항상 true(§7). */
  canceledExcluded: boolean;
  /** 집계에 쓴 lawdCd 목록. 스코프 밖(27110/11680)이 섞이지 않았음을 증명한다. */
  scopeLawdCds: string[];
  /** 요약 근거 — 지표별 trust 분포. */
  metricTrustCounts: Record<MetricTrust, number>;
  notes: string[];
}

/** 표/목록 한 줄. 거래 행 자체가 진실이고, master 보강은 없을 수 있다(§8/§11). */
export interface ReportRow {
  key: string;
  cells: Record<string, string | number | null>;
  /** master 보강이 붙지 않은 행인지. 화면에서 '정보 없음'으로 표기하기 위함. */
  enriched: boolean;
}

export interface ReportSection {
  key: string;
  title: string;
  kind: 'ROWS' | 'DISTRIBUTION';
  rows: ReportRow[];
  /** 이 섹션 전체의 신뢰 등급. */
  trust: MetricTrust;
  note: string | null;
}

export interface ReportHighlight {
  key: string;
  label: string;
  displayValue: string;
  /** 기간 한정 표현을 **반드시** 함께 싣는다(예: '최근 2년'). §6/§11. */
  contextLabel: string;
  trust: MetricTrust;
}

/**
 * 해석 문구. REPORT-1은 **예측을 만들지 않는다**(§10).
 * source가 'MEASURED_DELTA'면 문장 안의 숫자는 전부 실측 차이값이다.
 */
export interface ReportInterpretation {
  source: 'MEASURED_DELTA' | 'EJIP_SCORE_BRIEFING' | 'NONE';
  text: string | null;
  /** 어떤 규칙으로 만들어졌는지. 사후 검증용. */
  ruleId: string | null;
}

export interface NavigationTarget {
  label: string;
  href: string;
}

export interface ReportEnvelope<T = unknown> {
  reportType: ReportType;
  /** 계약 버전. 필드 의미가 바뀌면 올린다. */
  reportVersion: string;
  scope: ReportScope;
  period: ReportPeriod;
  /** 이 envelope을 만든 시각(ISO). */
  generatedAt: string;
  /** 데이터가 마지막으로 검증/수집된 시각(ISO). 실시간을 암시하지 않는다(§12). */
  dataAsOf: string | null;
  trust: ReportTrust;
  title: string;
  subtitle: string | null;
  metrics: ReportMetric[];
  sections: ReportSection[];
  highlights: ReportHighlight[];
  interpretation: ReportInterpretation;
  sourceNotes: MetricSource[];
  navigationTargets: NavigationTarget[];
  /** 리포트 종류별 추가 payload. 템플릿이 필요로 하는 경우에만. */
  data: T | null;
}

/** 지표별 trust를 리포트 전체 완전성으로 **요약**한다(덮어쓰지 않는다). */
export function summarizeTrust(metrics: ReportMetric[]): {
  completeness: ReportCompleteness;
  counts: Record<MetricTrust, number>;
} {
  const counts: Record<MetricTrust, number> = { SAFE: 0, LIMITED: 0, UNSAFE: 0, MISSING: 0 };
  for (const m of metrics) counts[m.trust] += 1;

  // UNSAFE가 하나라도 있으면 리포트를 검증됐다고 말할 수 없다.
  if (counts.UNSAFE > 0) return { completeness: 'UNVERIFIED', counts };
  // LIMITED/MISSING이 있으면 부분적이다 — SAFE로 승격하지 않는다(§3).
  if (counts.LIMITED > 0 || counts.MISSING > 0) return { completeness: 'PARTIAL', counts };
  return { completeness: 'COMPLETE', counts };
}
