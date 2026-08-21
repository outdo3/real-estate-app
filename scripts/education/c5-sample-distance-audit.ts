// SCHOOL V2-C5 §7 — 10개 표본 아파트/학교 거리 실측 감사용 read-only 스크립트.
// ApartmentMaster에서 실제 좌표(geocodeQuality='exact')를 지역별로 뽑고,
// 프로덕션 collectors/location.ts와 동일한 방식(Kakao SC4 카테고리 검색, radius 1000m)으로
// 가장 가까운 초등학교와의 직선거리(Kakao 자체 distance 필드)를 조회한다.
// DB write 없음. Kakao API 호출은 아파트당 1회(총 10회)로 "대량 호출"이 아니다.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';

const TARGETS: { sigungu: string; label: string }[] = [
  { sigungu: '서구', label: '서구-1' },
  { sigungu: '서구', label: '서구-2' },
  { sigungu: '해운대구', label: '해운대구-1' },
  { sigungu: '해운대구', label: '해운대구-2' },
  { sigungu: '부산진구', label: '부산진구-1' },
  { sigungu: '동래구', label: '동래구-1' },
  { sigungu: '사하구', label: '사하구-1' },
  { sigungu: '강서구', label: '강서구-1' },
  { sigungu: '기장군', label: '기장군-1' },
  { sigungu: '수영구', label: '수영구-1(기타)' },
];

async function findElementary(lat: number, lng: number) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SC4&x=${lng}&y=${lat}&radius=1000&sort=distance`;
  const res = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    },
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = await res.json();
  const school = (data.documents || []).find((d: any) => (d.place_name || '').includes('초등학교'));
  if (!school) return { ok: true as const, school: null };
  return { ok: true as const, school: { name: school.place_name, distanceM: Number(school.distance), address: school.road_address_name || school.address_name } };
}

async function main() {
  const usedIds = new Set<number>();
  for (const t of TARGETS) {
    const apt = await prisma.apartmentMaster.findFirst({
      where: {
        sigungu: t.sigungu,
        geocodeQuality: 'exact',
        latitude: { not: null },
        longitude: { not: null },
        id: { notIn: Array.from(usedIds) },
      },
      orderBy: { totalHouseholds: 'desc' },
    });
    if (!apt) {
      console.log(`[${t.label}] ${t.sigungu}: exact-geocode 아파트 없음`);
      continue;
    }
    usedIds.add(apt.id);
    const result = await findElementary(apt.latitude!, apt.longitude!);
    if (!result.ok) {
      console.log(`[${t.label}] ${apt.name} (${apt.umdName}) — Kakao 조회 실패 status=${result.status}`);
      continue;
    }
    if (!result.school) {
      console.log(`[${t.label}] ${apt.name} (${apt.umdName}) [${apt.latitude},${apt.longitude}] — 반경 1000m 내 초등학교 없음`);
      continue;
    }
    console.log(
      `[${t.label}] ${apt.name} (${apt.umdName}) [${apt.latitude},${apt.longitude}] ` +
      `↔ ${result.school.name} (${result.school.address}) = 직선 ${result.school.distanceM}m`
    );
    await new Promise((r) => setTimeout(r, 150));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
