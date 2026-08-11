// 오피스텔/생활형숙박시설(생숙)/재개발 데이터 수집 기반.
//
// 이 앱의 기존 관례(외부 API를 SDK 없이 fetch로 직접 호출, 확인 안 된 값은 절대
// 지어내지 않음)를 그대로 따른다. 세 카테고리의 실제 데이터 확보 가능성이 서로 크게
// 달라서 함수별로 구현 수준이 다르다:
//   - 오피스텔: 국토부 실거래가 공공데이터(RTMSDataSvcOffiTrade)가 실제로 존재하고
//     이 프로젝트의 fetchMolitData가 이미 지원한다(`type: 'officetel'`) — 그대로 동작하는
//     실제 수집 함수로 구현했다.
//   - 생숙(생활형숙박시설): 국토교통부 실거래가 공공데이터 목록에 생숙 전용 매매 실거래
//     엔드포인트가 없다(2026-08 기준 이 프로젝트가 확인한 범위 내에서는 없음 — 분양권/
//     준주택 통계는 지자체별로 흩어져 있어 통합 API가 없다). 없는 걸 있는 척 구현하는
//     대신, 스텁 함수로 명시하고 실제 데이터 소스가 확정되면 바로 채울 수 있게 자리만
//     잡아둔다.
//   - 재개발: 정비사업 진행단계는 전국 통합 공공데이터가 없고(구청/조합 공고, 정비사업
//     정보몽땅 등 지자체별 비정형 소스), 수동 입력 또는 지자체별 크롤러가 필요하다.
//     upsertRedevelopmentProject는 그런 소스가 채워 넣을 수 있는 저장 함수만 제공한다.

import { PropertyCategory } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchMolitData } from '@/lib/api-molit';
import { fetchBuildingRegistryInfo } from '@/lib/apt-building-info';

export interface UpsertResult {
  fetched: number;
  upserted: number;
  skipped: number;
}

// 오피스텔 실거래가(RTMSDataSvcOffiTrade)를 조회해 Property(category: OFFICETEL)에
// upsert한다. dealYmd는 "YYYYMM" — 호출부(배치 스크립트/관리자 액션)가 원하는 월들을
// 반복 호출해 채운다(이 함수 자체는 단일 월만 처리 — 여러 달을 한 번에 훑는 정책은
// MOLIT 레이트리밋에 맞춰 호출부가 결정해야 한다).
export async function fetchAndUpsertOfficetelTrades(lawdCd: string, dealYmd: string): Promise<UpsertResult> {
  const trades = await fetchMolitData({ type: 'officetel', lawdCd, dealYmd });
  if (!Array.isArray(trades) || trades.length === 0) return { fetched: 0, upserted: 0, skipped: 0 };

  // 실패 placeholder("API 에러")와 이름 없는 항목은 저장하지 않는다.
  const valid = (trades as any[]).filter((t) => t.typeLabel !== '에러' && t.name && t.name !== '이름 없음');

  let upserted = 0;
  for (const t of valid) {
    const dong = (t.dong || '').trim();
    if (!dong) continue; // dong 없이는 @@unique([category, name, dong]) 키를 안정적으로 못 채운다
    const buildYear = t.buildYear ? parseInt(t.buildYear, 10) : null;

    await prisma.property.upsert({
      where: { category_name_dong: { category: PropertyCategory.OFFICETEL, name: t.name, dong } },
      create: {
        category: PropertyCategory.OFFICETEL,
        name: t.name,
        dong,
        lawdCd,
        buildYear: buildYear && !isNaN(buildYear) ? buildYear : null,
      },
      // 실거래에서 얻는 건 이름/동/준공년도 정도라, 이미 건축물대장으로 더 정확한 값이
      // 채워져 있을 수 있는 세대수/주차대수/사용승인일은 덮어쓰지 않는다.
      update: {
        buildYear: buildYear && !isNaN(buildYear) ? buildYear : undefined,
      },
    });
    upserted += 1;
  }

  return { fetched: trades.length, upserted, skipped: trades.length - valid.length };
}

// 생숙(생활형숙박시설) 실거래 수집 — 아직 확인된 공공데이터 소스가 없어 스텁이다.
// 호출하면 즉시 명시적으로 실패를 알린다(조용히 빈 배열을 반환해 "정상 수집됐지만
// 0건"으로 오인되는 것을 막기 위함 — 관리자 대시보드의 파이프라인 상태 카드가 이
// 차이를 구분해서 보여준다).
export async function fetchAndUpsertLivingStayTrades(_lawdCd: string, _dealYmd: string): Promise<UpsertResult> {
  throw new Error('생숙(생활형숙박시설) 실거래 공공데이터 소스가 아직 연동되지 않았습니다.');
}

// 건축물대장 총괄표제부로 세대수/주차대수/준공년도/사용승인일을 보강한다. 오피스텔/
// APT 구분 없이 lawdCd+dong+jibun만 있으면 동작하는 범용 조회(apt-building-info.ts)를
// 그대로 재사용한다 — 지번 없이는 엉뚱한 건물이 잡히는 문제가 실측으로 이미 확인된
// 함수라, 이 서비스도 동일하게 jibun 없이는 호출하지 않는다.
export async function enrichPropertyFromRegistry(
  category: PropertyCategory,
  name: string,
  lawdCd: string,
  dong: string,
  jibun: string
): Promise<boolean> {
  const registry = await fetchBuildingRegistryInfo(name, lawdCd, dong, jibun);
  if (!registry) return false;

  await prisma.property.upsert({
    where: { category_name_dong: { category, name, dong } },
    create: {
      category,
      name,
      dong,
      lawdCd,
      totalHouseholds: registry.totalHouseholds ?? undefined,
      totalParking: registry.parkingCount ?? undefined,
      approvalDate: registry.approvalDate ?? undefined,
    },
    update: {
      totalHouseholds: registry.totalHouseholds ?? undefined,
      totalParking: registry.parkingCount ?? undefined,
      approvalDate: registry.approvalDate ?? undefined,
    },
  });
  return true;
}

export interface RedevelopmentProjectInput {
  zoneName: string;
  lawdCd?: string;
  stage: 'ZONE_DESIGNATED' | 'UNION_ESTABLISHED' | 'PROJECT_APPROVED' | 'MANAGEMENT_DISPOSAL_APPROVED' | 'RELOCATION_DEMOLITION' | 'CONSTRUCTION';
  targetHouseholds?: number;
  polygonGeojson?: unknown;
  lat?: number;
  lng?: number;
}

// 재개발 구역 정보 저장 — 전국 통합 공공데이터가 없어(지자체/조합 공고 등 비정형
// 소스) 자동 수집기가 아니라 관리자 입력·개별 크롤러가 채워 넣는 저장 함수로 둔다.
// zoneName을 사실상의 키로 삼아 있으면 갱신, 없으면 생성한다.
export async function upsertRedevelopmentProject(input: RedevelopmentProjectInput) {
  const existing = await prisma.redevelopmentProject.findFirst({ where: { zoneName: input.zoneName } });
  if (existing) {
    return prisma.redevelopmentProject.update({
      where: { id: existing.id },
      data: {
        lawdCd: input.lawdCd,
        stage: input.stage as any,
        targetHouseholds: input.targetHouseholds,
        polygonGeojson: input.polygonGeojson as any,
        lat: input.lat,
        lng: input.lng,
      },
    });
  }
  return prisma.redevelopmentProject.create({
    data: {
      zoneName: input.zoneName,
      lawdCd: input.lawdCd,
      stage: input.stage as any,
      targetHouseholds: input.targetHouseholds,
      polygonGeojson: input.polygonGeojson as any,
      lat: input.lat,
      lng: input.lng,
    },
  });
}
