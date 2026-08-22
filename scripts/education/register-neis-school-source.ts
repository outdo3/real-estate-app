/**
 * SCHOOL V2-C2A — EducationSource 등록(NEIS 학교기본정보, schoolInfo).
 * ingestion과 분리된 1회성 governance 액션(어린이집 C3A의
 * register-childcare-source.ts와 동일 패턴 재사용).
 *
 * 값 근거(추정 없음, 전부 직접 확인):
 * - 이용약관 제11조(open.neis.go.kr/portal/userAgreementPage.do):
 *   "기관은 당 사이트의 서비스에서 제공하는 데이터에 대하여 저작자
 *   및 출처 표시 조건으로 자유이용을 허락함을 원칙으로 합니다." —
 *   영리목적 이용을 별도로 제한하는 조항 없음.
 * - 학교기본정보 데이터셋 상세 페이지(open.neis.go.kr/portal/data/
 *   service/selectServicePage.do?infId=OPEN17020190531110010104913):
 *   "이용 허락 범위 제한없음", 갱신주기 "매주", 제공기관 "교육부,
 *   16개 시도교육청" — 두 공식 페이지가 서로 상충하지 않음(어린이집
 *   SHEET 건과 달리 conflict 없음).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/register-neis-school-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

async function main() {
  const source = await prisma.educationSource.upsert({
    where: { code: 'neis_school_info' },
    create: {
      code: 'neis_school_info',
      displayName: 'NEIS 학교기본정보(교육정보 개방포털)',
      provider: '교육부, 16개 시도교육청(운영: 한국교육학술정보원)',
      datasetId: 'OPEN17020190531110010104913',
      sourceType: 'API',
      sourceUrl: 'https://open.neis.go.kr/hub/schoolInfo',
      licenseCode: 'UNRESTRICTED_ATTRIBUTION',
      attributionRequired: true,
      commercialUseAllowed: true, // 이용약관 제11조 "자유이용" + 데이터셋 페이지 "이용 허락 범위 제한없음", 명시적 영리 금지 조항 없음(어린이집 SHEET와 달리 두 공식 페이지 상충 없음)
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
