/**
 * SCHOOL V2-C3B — EducationSource 등록(유치원알리미 "일반현황"
 * OpenAPI, basicInfo2). ingestion과 분리된 1회성 governance 액션
 * (어린이집/NEIS와 동일 패턴).
 *
 * 값 근거(추정 없음, 2026-08-21 e-childschoolinfo.moe.go.kr/openApi/
 * openApiList.do "일반현황" 오퍼레이션 상세를 브라우저로 직접 열람해
 * 확인):
 * - 요청 URL: https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do
 * - 제공방식: REST, 데이터포맷: JSON, XLSX
 * - 등록일자: 2022-04-26, 적재주기: 비정기(수시)
 * - 제공기관: 교육부
 * - 심의여부: **자동승인**(어린이집 cpmsapi021과 달리 개발/운영 모두
 *   자동승인 — 실제 텍스트가 그렇게 표기됨, 인증키 신청 마찰이 더
 *   낮을 것으로 예상되나 실제 신청은 하지 않았음)
 * - 이용허락조건 원문: "저작자와 출처를 표시하면 영리목적의 이용을
 *   포함한 변경 및 자유이용을 허락합니다." — 어린이집 cpmsapi021과
 *   동일 문구, 상업적 이용/가공 명시적 허용.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/register-kindergarten-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

async function main() {
  const source = await prisma.educationSource.upsert({
    where: { code: 'moe_kindergarten_basicinfo_api' },
    create: {
      code: 'moe_kindergarten_basicinfo_api',
      displayName: '유치원알리미 일반현황(basicInfo2)',
      provider: '교육부',
      datasetId: 'basicInfo2', // 유치원알리미 자체 오퍼레이션명(별도 data.go.kr 카탈로그 ID 없음, 포털 자체 API)
      sourceType: 'API',
      sourceUrl: 'https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do',
      licenseCode: 'ATTRIBUTION_ONLY_FREE_USE', // 어린이집 cpmsapi021과 동일 원문
      attributionRequired: true,
      commercialUseAllowed: true,
      modificationAllowed: true,
      legalReviewStatus: 'CLEARED',
      termsCheckedAt: new Date(),
    },
    update: {
      legalReviewStatus: 'CLEARED',
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
