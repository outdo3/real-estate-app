/**
 * SCHOOL V2-C3A — EducationSource 등록(어린이집 공식 source, cpmsapi021).
 * ingestion과 분리된 1회성 governance 액션 — legal gate 통과 여부를 별도로
 * 남기기 위해 ingest-childcare.ts와 다른 스크립트로 둔다.
 *
 * 값 근거(추정 없음, 전부 아래 경로에서 직접 확인):
 * - provider/URL/이용허락조건: info.childcare.go.kr → 보육정보공개 API →
 *   OPEN API → 전국 어린이집 정보 조회(OpenApiInfoSl.jsp) 페이지 원문
 * - 공식 서비스 명세서: OpenAPI서비스명세서_021_v1.0.doc(svcseq=79) 다운로드해 확인
 * - datasetId(15101155): data.go.kr에 동일 서비스로 등록된 공공데이터포털 카탈로그 ID
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/register-childcare-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

async function main() {
  const source = await prisma.educationSource.upsert({
    where: { code: 'childcare_national_api' },
    create: {
      code: 'childcare_national_api',
      displayName: '전국 어린이집 정보(어린이집정보공개포털)',
      provider: '한국사회보장정보원',
      datasetId: '15101155',
      sourceType: 'API',
      sourceUrl: 'http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request',
      // info.childcare.go.kr OpenApiInfoSl.jsp 원문: "저작자와 출처를 표시하면
      // 영리목적의 이용을 포함한 변경 및 자유이용을 허락합니다." — KOGL 제1유형에
      // 해당하는 내용을 그대로 명시한 문구(사이트가 KOGL 유형 코드로 표기하지
      // 않아 코드 대신 원문 취지를 licenseCode에 요약해 남긴다).
      licenseCode: 'ATTRIBUTION_ONLY_FREE_USE',
      attributionRequired: true,
      commercialUseAllowed: true, // 원문에 "영리목적의 이용을 포함" 명시
      modificationAllowed: true, // 원문에 "변경... 자유이용" 명시
      legalReviewStatus: 'CLEARED',
      termsCheckedAt: new Date(),
      // C1 schema에 notes 컬럼이 없어(불필요한 schema 변경 방지, §33) 확인 근거는
      // DB가 아니라 docs/development/SCHOOL-V2-C3A-childcare-ingestion.md에 남긴다.
    },
    update: {
      licenseCode: 'ATTRIBUTION_ONLY_FREE_USE',
      commercialUseAllowed: true,
      modificationAllowed: true,
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
