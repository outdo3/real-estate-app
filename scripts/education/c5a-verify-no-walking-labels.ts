// SCHOOL V2-C5-A §13 — 학교/유치원/어린이집 거리 UI가 다시 "도보 N분"(직선거리 기반
// 추정)을 사용자에게 노출하지 않는지 정적으로 검증하는 회귀 가드. 이 프로젝트는
// vitest/jest 같은 포맷 테스트 프레임워크가 없고(scripts/apartment-score/verify-*.ts,
// scripts/education/verify-school-normalization.ts처럼 tsx로 직접 실행하는 assertion
// 스크립트 관례를 따름) 대상 코드도 네트워크(Kakao/MOLIT) 의존이라 실행 기반 unit test
// 대신 소스 코드에 금지 패턴이 다시 등장하지 않는지 확인하는 방식을 택했다.
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

interface Check {
  file: string;
  // 이 파일에 있으면 안 되는 패턴들 — 다시 나타나면 "도보 N분"류 표현이 부활한 것.
  forbidden: RegExp[];
  // 반드시 있어야 하는 패턴 — 수정이 실제로 적용됐는지 확인.
  required: RegExp[];
}

const checks: Check[] = [
  {
    file: 'src/app/api/school/apartments/route.ts',
    forbidden: [/dist \* 1\.45/, /`도보 약 \$\{walkMin\}분`/],
    required: [/distanceLabel = `직선거리 약 \$\{distanceMeters\}m`/],
  },
  {
    file: 'src/lib/ai-search.ts',
    forbidden: [/walkMinutes: Math\.max/, /distanceM \/ 80/],
    required: [/name: school\.place_name, distanceM \};/],
  },
  {
    file: 'src/app/api/ai-search/route.ts',
    forbidden: [/도보 약 \$\{c\.nearestSchool\.walkMinutes\}분/],
    required: [/직선거리 약 \$\{c\.nearestSchool\.distanceM\}m/],
  },
  {
    file: 'src/app/ai-search/ai-search-client.tsx',
    forbidden: [/walkMinutes: number/, /도보 \$\{c\.nearestSchool\.walkMinutes\}분/],
    required: [/직선거리 약 \$\{c\.nearestSchool\.distanceM\}m/],
  },
  {
    file: 'src/app/school/[id]/school-detail-client.tsx',
    forbidden: [/\{apt\.walkTime\} · \{apt\.price\}/],
    required: [/\{apt\.distanceLabel \?\? apt\.walkTime\} · \{apt\.price\}/, /직선거리 기준이며/],
  },
  {
    file: 'src/components/KakaoPlaces.tsx',
    forbidden: [],
    required: [/isEducationPlace/, /직선거리 약 \$\{p\.distance\}m/],
  },
];

let failures = 0;

for (const check of checks) {
  const path = join(ROOT, check.file);
  const content = readFileSync(path, 'utf-8');

  for (const pattern of check.forbidden) {
    if (pattern.test(content)) {
      console.error(`FAIL [${check.file}] 금지 패턴이 발견됨: ${pattern}`);
      failures++;
    }
  }
  for (const pattern of check.required) {
    if (!pattern.test(content)) {
      console.error(`FAIL [${check.file}] 필수 패턴이 없음(수정이 되돌려졌을 수 있음): ${pattern}`);
      failures++;
    }
  }
}

// Score 파이프라인(school-access-sentence.ts)은 이번 STEP에서 변경 금지 — 회귀 가드가
// 실수로라도 이 파일을 건드리지 않았는지 git 이력이 아니라 "여전히 walkMin류 표현이
// 전혀 없다(정성적 문구만)"는 사실 자체를 재확인한다(변경 여부가 아니라 원래 안전한
// 상태가 유지되는지 확인).
const scorePath = join(ROOT, 'src/lib/apartment-score/server/school-access-sentence.ts');
const scoreContent = readFileSync(scorePath, 'utf-8');
if (/walkMin|distanceM \/ 80|\* 1\.45/.test(scoreContent)) {
  console.error('FAIL [school-access-sentence.ts] Score 파이프라인에 도보시간 계산이 유입됨 — 이번 STEP에서 절대 금지');
  failures++;
}

if (failures === 0) {
  console.log(`PASS — ${checks.length}개 파일 + Score 파이프라인 불변 확인, 전부 통과`);
  process.exit(0);
} else {
  console.error(`\n${failures}건 실패`);
  process.exit(1);
}
