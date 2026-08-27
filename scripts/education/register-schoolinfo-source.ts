/**
 * SCHOOLINFO / SCHOOL V2.1 — EducationSource 등록(학교알리미 OpenAPI, schoolinfo_openapi).
 * ingestion과 분리된 1회성 governance 액션(register-neis-school-source.ts/
 * register-kindergarten-source.ts와 동일 패턴 재사용).
 *
 * 값 근거: docs/development/SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md가 남긴
 * CONDITIONAL 판정(§10)을, 사용자가 확보한 학교알리미 공식 회신(이번 STEP 지시사항
 * §1, 8개 항목)이 다음과 같이 해소했다:
 *   1. 원본 데이터를 임의 변경/왜곡하지 않으면 상업적 웹/앱 활용 가능
 *   2. 원본값 유지 전제에서 재구성/비교/분석 가능(비율/거리/비교/지표/순위/해석 포함)
 *   3. 단, 이집 자체 산출물(비율/거리/비교/지표/순위/해석)은 학교알리미 원본이
 *      아니라 이집 산출임을 명확히 표시해야 함(→ RAW/DERIVED 라벨 분리, §15 IA)
 *   4. 원본 위경도 임의 변경 금지(→ School.latitude/longitude는 원본 그대로만 저장)
 *   5. 아파트-학교 거리 계산 가능(이집 산출 표시 조건)
 *   6. 진학/졸업/학교 특성 원본값 표시 가능, 파생 ranking/평가는 별도 구분
 *   7. 자체 DB 저장/업데이트 금지 아님(원본 정합성 유지 조건)
 *   8. 필수 출처 표시: "출처: 학교알리미"
 *
 * 이 스크립트는 governance 등록만 수행한다 — 학생수/학급수/교원수 등 실제 SchoolStat
 * 통계 ingestion은 별도 STEP(대규모 신규 데이터 수집, 이번 STEP 범위 밖)에서 진행한다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/register-schoolinfo-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

async function main() {
  const source = await prisma.educationSource.upsert({
    where: { code: 'schoolinfo_openapi' },
    create: {
      code: 'schoolinfo_openapi',
      displayName: '학교알리미 OpenAPI(공시정보)',
      provider: '교육부(주관), 한국교육학술정보원(KERIS, 운영)',
      datasetId: '15098092',
      sourceType: 'API',
      sourceUrl: 'https://www.schoolinfo.go.kr/openApi.do',
      licenseCode: 'ATTRIBUTION_REQUIRED_ORIGINAL_PRESERVED',
      attributionRequired: true,
      // 공식 회신: 원본 그대로 유지하는 조건으로 상업적 활용 및 재구성/비교/분석 가능.
      commercialUseAllowed: true,
      modificationAllowed: true,
      legalReviewStatus: 'CLEARED',
      termsCheckedAt: new Date(),
    },
    update: {
      legalReviewStatus: 'CLEARED',
      commercialUseAllowed: true,
      modificationAllowed: true,
      termsCheckedAt: new Date(),
    },
  });

  console.log(JSON.stringify(source, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
