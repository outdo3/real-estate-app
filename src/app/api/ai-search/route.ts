import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import {
  classifyQuery,
  normalizeSidoName,
  runConditionSearch,
  runRegionalStats,
  runCompare,
  generateBriefing,
} from '@/lib/ai-search';

export const dynamic = 'force-dynamic';

const DEFAULT_LAWD_CD = '26140'; // 부산광역시 서구 — 이 서비스의 기본 대상 지역
const CACHE_TTL_MS = 30 * 60 * 1000; // 30분 — 실거래 데이터가 자주 바뀌지 않으므로

function normalizeQueryKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query: string = (body.query || '').trim();
    const fallbackLawdCd: string = body.lawdCd || DEFAULT_LAWD_CD;

    if (!query) {
      return NextResponse.json({ success: false, error: '질문을 입력해주세요.' });
    }

    // 캐시 키에 지역(lawdCd)도 함께 넣는다 — 같은 질문 문장이라도(예: 홈 화면 추천 칩
    // "대신더샵 vs 대신롯데캐슬 비교"는 질문 자체에 지역이 없어 매번 클라이언트의 현재
    // 선택 지역에 의존) 사용자가 다른 지역을 보고 있을 때 재사용하면 엉뚱한 지역의 결과가
    // 그대로 캐시돼 30분간 계속 잘못 나온다 — 실측으로 재현·확인함.
    const queryHash = createHash('sha256').update(`${normalizeQueryKey(query)}|${fallbackLawdCd}`).digest('hex');

    // 1. Supabase DB 캐시 확인 — 동일 질문+동일 지역이면 Gemini를 다시 부르지 않는다.
    try {
      const cached = await prisma.aiSearchCache.findUnique({ where: { queryHash } });
      if (cached && Date.now() - cached.createdAt.getTime() < CACHE_TTL_MS) {
        return NextResponse.json({ success: true, cached: true, ...(cached.result as object) });
      }
    } catch (e) {
      console.warn('AI 검색 캐시 조회 실패(DB 미설정 등) — 새로 조회합니다', e);
    }

    // 2. 의도 분류 (Gemini)
    const classification = await classifyQuery(query);
    if (!classification) {
      return NextResponse.json({
        success: false,
        error: 'AI 검색을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
      });
    }

    // 3. 지역 코드 결정: 질문에서 추출된 지역 우선, 없으면 클라이언트가 보낸 현재 선택
    // 지역으로 폴백.
    let lawdCd = fallbackLawdCd;
    let regionExplicit = false;
    const normalizedSido = normalizeSidoName(classification.sido);
    if (normalizedSido && classification.sigungu) {
      const resolved = await resolveLawdCdByNames(normalizedSido, classification.sigungu);
      if (resolved) {
        lawdCd = resolved;
        regionExplicit = true;
      }
    }

    let payload: Record<string, unknown>;

    if (classification.intent === 'condition_search') {
      const complexes = await runConditionSearch(
        lawdCd,
        {
          maxPriceEok: classification.maxPriceEok,
          minParkingPerHousehold: classification.minParkingPerHousehold,
          minTotalHouseholds: classification.minTotalHouseholds,
          newBuildOnly: classification.newBuildOnly,
          nearElementarySchool: classification.nearElementarySchool,
        },
        request.url
      );
      const summary =
        complexes.length === 0
          ? '조건에 맞는 단지를 찾지 못했습니다.'
          : complexes
              .map((c) => {
                const parts = [`${c.name}(${c.dong}) ${c.price}`];
                if (c.parkingInfo) parts.push(c.parkingInfo);
                if (c.totalHouseholds) parts.push(`${c.totalHouseholds.toLocaleString('ko-KR')}세대`);
                if (c.buildYear) parts.push(`${c.buildYear}년 준공`);
                if (c.nearestSchool) parts.push(`${c.nearestSchool.name}까지 도보 약 ${c.nearestSchool.walkMinutes}분(${c.nearestSchool.distanceM}m)`);
                return parts.join(', ');
              })
              .join(' / ');
      const briefing = await generateBriefing('condition_search', summary, {
        requireSchoolMention: classification.nearElementarySchool,
      });
      payload = { intent: 'condition_search', briefing, complexes, lawdCd };
    } else if (classification.intent === 'regional_stats') {
      const stats = await runRegionalStats(lawdCd, request.url);
      if (!stats) {
        return NextResponse.json({ success: false, error: '지역 통계를 불러오지 못했습니다.' });
      }
      const summary = `최근 1개월 거래량 ${stats.volume}건(전월 대비 ${stats.volumeChange >= 0 ? '+' : ''}${stats.volumeChange}건), 평균 전세가율 ${stats.jeonseRate != null ? `${stats.jeonseRate}%` : '데이터 없음'}.`;
      const briefing = await generateBriefing('regional_stats', summary);
      payload = { intent: 'regional_stats', briefing, stats, lawdCd };
    } else {
      const targetA = classification.compareTargetA;
      const targetB = classification.compareTargetB;
      if (!targetA || !targetB) {
        return NextResponse.json({ success: false, error: '비교할 두 단지명을 정확히 알려주세요.' });
      }
      // 질문 문장에 지역이 명시되지 않았다면(예: 홈 화면 추천 칩) 클라이언트의 현재 선택
      // 지역을 두 단지에 강제로 씌우지 않는다 — 비교 대상은 임의의 지역에 있을 수 있는
      // 구체적인 두 단지라, "지금 보고 있는 지역"이라는 fallback 자체가 이 의도에는 맞지
      // 않는다(runCompare/fetchCompareTarget이 각 단지명을 스스로 지오코딩하게 둔다).
      const compareLawdCd = regionExplicit ? lawdCd : null;
      const [a, b] = await runCompare(targetA, targetB, compareLawdCd, request.url);
      const summary = [a, b]
        .map(
          (c) =>
            `${c.name}: 최근 실거래 ${c.latestPrice || '정보 없음'}(${c.latestArea || '-'}), 세대수 ${c.totalHouseholds || '정보 없음'}, ${c.parking || '주차 정보 없음'}, 용적률 ${c.far || '정보 없음'}, 건폐율 ${c.bcr || '정보 없음'}, 준공 ${c.buildYear || '정보 없음'}, 커뮤니티시설 ${c.facilities.length > 0 ? c.facilities.join(', ') : '정보 없음'}`
        )
        .join(' | ');
      const briefing = await generateBriefing('compare', summary);
      payload = { intent: 'compare', briefing, complexA: a, complexB: b, lawdCd };
    }

    // 4. Supabase DB 캐시에 저장 (실패해도 응답 자체는 정상 반환)
    try {
      const jsonSafePayload = JSON.parse(JSON.stringify(payload));
      await prisma.aiSearchCache.upsert({
        where: { queryHash },
        create: { queryHash, query, intent: classification.intent, result: jsonSafePayload },
        update: { intent: classification.intent, result: jsonSafePayload, createdAt: new Date() },
      });
    } catch (e) {
      console.warn('AI 검색 캐시 저장 실패(DB 미설정 등)', e);
    }

    return NextResponse.json({ success: true, cached: false, ...payload });
  } catch (error) {
    console.error('AI search route error:', error);
    return NextResponse.json({ success: false, error: 'AI 검색 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
