// STATS_REPORT_ENTRY_V1 — 통계 화면에서 "지금 선택된 지역의 리포트"로 가는 링크를
// 정하는 **순수** 함수.
//
// ── 왜 필요한가 (감사 결과) ────────────────────────────────────────────────────
// 리포트 route와 CTA는 이미 있었다(REPORT-7, commit ca1d255). 그런데 통계에서는
// **구/군과 동만** 연결돼 있었다:
//
//   if (!isBusanCurrentLawdCd(region.lawdCd ?? '')) return null;   // ← 여기서 끝
//
// RegionContext의 기본값(FALLBACK_REGION)은 `lawdCd: null` / `sidoCode: '26'` /
// `부산광역시 전체`다. 즉 처음 들어온 사용자는 항상 "부산 전체" 상태이고, 그 상태에서는
// 위 게이트가 false라 **어떤 통계 화면에서도 리포트 진입점이 보이지 않았다.** 게다가
// 통계 메인(`/stats`)에는 진입점이 애초에 없었다. `/report/city/busan` route는 살아
// 있었고(`/tools`에서만 링크) 시 리포트는 통계에서 한 번도 연결된 적이 없다
// (`git log --all -S "REPORT_LABELS.city" -- src/app/stats/` 결과 0건).
//
// → "통계에 리포트 기능이 빠졌다"는 관찰의 실체는 **삭제가 아니라 미연결**이다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────────
// 이 파일은 route 문자열을 직접 만들지 않고 `report-links.ts`의 단일 정의를 호출한다.
// 지역 identity가 불충분하면 **null**을 돌려주고, 호출부는 CTA를 렌더하지 않는다 —
// 다른 지역 리포트로 보내는 fallback을 만들지 않는다(§4).
import { cityReportHref, districtReportHref, dongReportHref, REPORT_LABELS } from './report-links';
import { isBusanCurrentLawdCd } from './region-scope';
import { DEFAULT_REPORT_PERIOD_KEY, resolveReportPeriod } from './report-period';
import { briefingPeriodFor, isVolumePeriodPreset, volumePeriodRangeText } from '@/lib/stats/volume-period';

/** 리포트가 존재하는 시도. 소프트런칭 범위와 같다(부산). */
export const REPORT_SIDO_CODE = '26';

/** RegionContext의 RegionState에서 이 판정에 필요한 부분만. */
export interface StatsRegionLike {
  lawdCd: string | null;
  sidoCode: string;
  /** 미선택이면 'all'. */
  dong: string;
  /** "시도 전체" 선택 시 빈 문자열. */
  sigungu: string;
}

export interface StatsReportEntry {
  href: string;
  /** 지역명이 들어간 전체 문구 — 폭이 넉넉한 자리(전체폭 CTA)용. */
  label: string;
  /** 짧은 문구 — 지역명이 바로 옆에 이미 보이는 좁은 자리(헤더 인라인)용. */
  shortLabel: string;
  scope: 'city' | 'district' | 'dong';
}

/**
 * 선택된 지역 → 리포트 진입점.
 *
 *   동 선택          → `/report/dong/{lawdCd}/{dong}`
 *   구·군 선택        → `/report/district/{lawdCd}`
 *   시도 전체(부산)   → `/report/city/busan`
 *   그 외            → null
 *
 * "그 외"에 들어가는 경우를 명시한다(조용히 다른 리포트로 보내지 않기 위해):
 *  · 부산이 아닌 시도(서울 등) — 리포트가 다루지 않는다.
 *  · 현행 16개가 아닌 lawdCd(예: 27110) — `isBusanCurrentLawdCd`가 막는다. 이때
 *    "부산 전체"로 내려보내지 않는다 — 사용자가 고른 지역이 아니기 때문이다.
 *  · 동이 선택됐는데 lawdCd가 없는 상태 — 동만으로는 경로를 만들 수 없다.
 */
export function resolveStatsReportEntry(region: StatsRegionLike | null | undefined): StatsReportEntry | null {
  if (!region) return null;
  const lawdCd = (region.lawdCd || '').trim();
  const dong = (region.dong || '').trim();

  if (lawdCd) {
    // 알 수 없는 코드면 여기서 끝낸다. 시 리포트로 내려보내지 않는다.
    if (!isBusanCurrentLawdCd(lawdCd)) return null;

    if (dong && dong !== 'all') {
      const href = dongReportHref(lawdCd, dong);
      if (!href) return null;
      return { href, label: REPORT_LABELS.dong(dong), shortLabel: REPORT_LABELS.regionShort, scope: 'dong' };
    }

    const href = districtReportHref(lawdCd);
    if (!href) return null;
    // 구/군 이름이 비어 있으면 지역명 없는 문구로 떨어진다 — 이름을 추측하지 않는다.
    const name = (region.sigungu || '').trim();
    return {
      href,
      label: name ? REPORT_LABELS.district(name) : REPORT_LABELS.regionShort,
      shortLabel: REPORT_LABELS.regionShort,
      scope: 'district',
    };
  }

  // lawdCd가 없는 "시도 전체" — 부산일 때만 시 리포트가 있다.
  if (region.sidoCode === REPORT_SIDO_CODE) {
    return { href: cityReportHref(), label: REPORT_LABELS.city, shortLabel: REPORT_LABELS.regionShort, scope: 'city' };
  }

  return null;
}

// ── STATS_15D_BRIEFING_ENTRY_FIX ──────────────────────────────────────────────
//
// Production 재현: 실거래 화면에서 "최근 15일"을 고른 뒤 "부산 한장 브리핑"을 누르면 `/report/city/busan`
// (기본 30일)이 열렸다. 그 버튼은 통계 상세 페이지(type-client)의 공용 CTA인데, 기간 상태는 각 화면
// (실거래·거래 많은 단지) **안에** 있어 CTA가 몰랐다. STATS_PERIOD_IMAGE_PARITY_V2는 거래량 카드 안의
// 링크만 고쳤다. 이제 브리핑 링크는 전부 이 두 함수로 만든다.

/** 브리핑 경로에 기간 키를 붙인다. 이미 쿼리가 있으면 이어 붙인다. */
export function withBriefingPeriod(href: string, periodKey: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}period=${encodeURIComponent(periodKey)}`;
}

export interface StatsBriefingTarget {
  href: string;
  /** CTA 아래 한 줄 — 브리핑이 실제로 쓰는 기간·범위·거래유형. 조용히 다른 기간으로 열지 않는다. */
  basisLabel: string;
  /** 화면에서 고른 기간을 그대로 싣는가. false면 브리핑 기본 기간(어제까지 30일)으로 열린다. */
  matchesSelection: boolean;
}

/**
 * 통계 화면의 선택 기간 → 브리핑 링크.
 * - 선택 기간이 통계 기간 키(오늘·어제·7일·15일·30일·3개월)면 그 키를 싣는다 — 리포트가 같은 계산기로 같은 범위를 만든다.
 * - 브리핑에 같은 기간이 없는 선택(이번 주·지난주·12개월 등)이나 기간이 없는 화면이면 기본 기간으로 열되,
 *   그 기간을 라벨로 밝힌다.
 * 브리핑은 **매매** 기준이다(실거래 피드 "전체"는 전월세를 함께 센다) — 라벨에 적어 숫자 차이를 오해하지 않게 한다.
 */
export function statsBriefingTarget(entry: StatsReportEntry, selectedPeriod: string | null | undefined, now: Date = new Date()): StatsBriefingTarget {
  if (selectedPeriod && isVolumePeriodPreset(selectedPeriod)) {
    const b = briefingPeriodFor(selectedPeriod, now);
    return { href: withBriefingPeriod(entry.href, b.periodKey), basisLabel: `${b.basisLabel} · 매매`, matchesSelection: true };
  }
  const d = resolveReportPeriod(DEFAULT_REPORT_PERIOD_KEY, now);
  return {
    href: entry.href,
    basisLabel: `${d.label} · ${volumePeriodRangeText({ from: d.start, to: d.end })} 기준 · 매매`,
    matchesSelection: false,
  };
}
