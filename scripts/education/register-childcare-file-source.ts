/**
 * SCHOOL V2-C3A BLOCKER RESOLUTION — 어린이집 "풍부한 필드"(위경도/현원/
 * 교직원수/CCTV/통학차량) 후보 source(전국어린이집표준데이터 15013108,
 * 한국사회보장정보원_어린이집 기본정보 15083298)를 EducationSource에
 * REVIEW_REQUIRED로 등록만 해둔다 — 이번 STEP에서 primary로 채택하지
 * 않지만(§10/§35 비교 결과, docs/development/SCHOOL-V2-C3A 문서 참고),
 * 다음 세션이 같은 조사를 처음부터 반복하지 않도록 registry에 남긴다.
 *
 * REVIEW_REQUIRED로 두는 이유(추정 아님, 직접 확인한 상충):
 * - 원 제공처(info.childcare.go.kr) "어린이집 기본정보" SHEET 페이지 원문:
 *   "저작자와 출처를 표시하면 비영리목적의 변경 및 자유이용을 허락합니다."
 *   (비영리 한정 — 상업 서비스인 이집에 적용 불가 소지)
 * - 그러나 data.go.kr 카탈로그 기록(15083298 fileData.do)은
 *   "이용허락범위: 제한 없음"(상업 이용 가능 시사) — 서로 다른 공식
 *   페이지가 상충하는 문구를 보여줌.
 * - 게다가 이 source는 REST API가 아니라 수동 UI 조작(지역 선택 →
 *   검색 → 파일저장)으로만 받을 수 있고, data.go.kr 자신도 "기타
 *   유의사항"에 그 수동 절차를 그대로 안내한다(자동 갱신 불가).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/register-childcare-file-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

async function main() {
  const source = await prisma.educationSource.upsert({
    where: { code: 'childcare_national_sheet' },
    create: {
      code: 'childcare_national_sheet',
      displayName: '어린이집 기본정보(어린이집정보공개포털 SHEET, 표준데이터 계열)',
      provider: '한국사회보장정보원',
      datasetId: '15013108,15083298,3065251,15101184', // 동일 원천을 가리키는 data.go.kr 카탈로그 중복 등록들
      sourceType: 'SHEET', // REST가 아니라 수동 UI 다운로드 — ingestion 코드가 이 값으로 "자동화 불가" 분기 가능
      sourceUrl: 'https://info.childcare.go.kr/info/oais/openapi/OpenApiSlL.jsp',
      licenseCode: 'CONFLICTING_NONCOMMERCIAL_VS_UNRESTRICTED',
      attributionRequired: true,
      commercialUseAllowed: null, // 상충 — UNKNOWN으로 남김(false 아님, true도 아님)
      modificationAllowed: null,
      legalReviewStatus: 'REVIEW_REQUIRED',
      termsCheckedAt: new Date(),
    },
    update: {
      legalReviewStatus: 'REVIEW_REQUIRED',
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
