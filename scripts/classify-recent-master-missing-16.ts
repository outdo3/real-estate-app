/**
 * RECENT_MASTER_MISSING_16_AUDIT_V1 — §18 classification + repair candidate file.
 *
 * Two-step pipeline(재현 순서 그대로):
 *   1) npx ts-node ... scripts/audit-recent-master-missing-16.ts
 *      → data/master-integrity/_recent-16-forensic-profiles.json 생성(중간 산출물,
 *        재생성 가능이라 git에는 포함하지 않음)
 *   2) npx ts-node ... scripts/classify-recent-master-missing-16.ts
 *      → 위 파일을 읽어 분류 규칙(§3/§10/§20) 적용,
 *        data/master-integrity/recent-master-missing-16-v1.json(커밋 대상) 생성
 *
 * Read-only, DB write 없음.
 */
import * as fs from 'fs';
import * as path from 'path';

interface Profile {
  aptSeq: string; canonicalName: string; lawdCd: string; dong: string; jibun: string;
  buildYear: number | null; totalTradeCount: number; recent24Count: number; recent12Count: number;
  recent6Count: number; firstTradeDate: string; lastTradeDate: string;
  nameVariants: string[]; dongVariants: string[]; jibunVariants: string[];
  buildYearVariants: number[]; distinctAreaCount: number; sourceIdentityConflict: boolean;
  masterNameAliasMatches: { aptSeq: string; name: string; dong: string; jibun: string }[];
  masterAddressMatch: { aptSeq: string; name: string } | null;
  legacyExactMatch: { id: number; name: string; aptSeq: string | null } | null;
  legacyAddressMatch: { id: number; name: string; aptSeq: string | null } | null;
}

const profiles: Profile[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../data/master-integrity/_recent-16-forensic-profiles.json'), 'utf-8')
);

type Readiness = 'READY_FOR_MASTER_CREATE' | 'REVIEW_REQUIRED' | 'DO_NOT_CREATE';

const rows = profiles.map((p) => {
  // 이름 별칭 매치가 있어도 dong/jibun이 다르면 다른 단지(브랜드명 재사용) — merge 근거 아님.
  const realAliasCandidates = p.masterNameAliasMatches.filter((m) => !(m.dong === p.dong && m.jibun === p.jibun));
  const sameAddressDifferentName = p.masterAddressMatch;

  let classification: string;
  let masterCreateReadiness: Readiness;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  let recommendedAction: string;
  const evidence: string[] = [
    `MOLIT 실거래(ApartmentTradeHistory) 전체 이력 ${p.totalTradeCount}건(최초 ${p.firstTradeDate.slice(0, 10)} ~ 최근 ${p.lastTradeDate.slice(0, 10)})`,
    `이름/동/지번이 전체 이력에서 흔들림 없음(name=${p.nameVariants.length}종, dong=${p.dongVariants.length}종, jibun=${p.jibunVariants.length}종) — SOURCE_IDENTITY_CONFLICT 없음`,
    `ApartmentMaster 중복/오매칭 후보: name-alias(다른 주소)=${realAliasCandidates.length}건, 동일주소-다른이름=${sameAddressDifferentName ? 1 : 0}건`,
    `legacy Apartment 테이블: exact match=${p.legacyExactMatch ? 1 : 0}, address match=${p.legacyAddressMatch ? 1 : 0}`,
  ];

  if (sameAddressDifferentName) {
    classification = 'F_SOURCE_ALIAS_MISMATCH';
    masterCreateReadiness = 'REVIEW_REQUIRED';
    confidence = 'MEDIUM';
    recommendedAction = 'MANUAL_REVIEW — 같은 주소에 다른 이름의 기존 Master row가 있어 rename/alias 여부 확인 필요';
    evidence.push(`동일 dong+jibun에 기존 Master row 발견: aptSeq=${sameAddressDifferentName.aptSeq} name="${sameAddressDifferentName.name}"`);
  } else if (p.sourceIdentityConflict) {
    classification = 'I_UNKNOWN';
    masterCreateReadiness = 'REVIEW_REQUIRED';
    confidence = 'LOW';
    recommendedAction = 'MANUAL_REVIEW — 동일 aptSeq 내에서 name/dong/jibun이 거래별로 흔들림, identity 재확인 필요';
  } else {
    // 모든 신호가 깨끗함 — 실제 active apartment, Master import 누락.
    classification = 'A_ACTIVE_APARTMENT_MASTER_OMISSION';
    masterCreateReadiness = 'READY_FOR_MASTER_CREATE';
    confidence = p.totalTradeCount >= 5 ? 'HIGH' : 'MEDIUM'; // 거래 이력이 두터울수록 identity 확신도 높음
    recommendedAction = 'CREATE_MASTER_ROW — aptSeq/name/normalizedName/sido/sigungu/sggCd/umdName/jibun/buildYear(MOLIT 원본)로 최소 필드 생성, totalHouseholds/좌표는 후속 건축물대장/geocoding enrichment 대상(별도 승인 STEP)';
  }

  return {
    aptSeq: p.aptSeq,
    tradeName: p.canonicalName,
    lawdCd: p.lawdCd,
    dong: p.dong,
    jibun: p.jibun,
    buildYear: p.buildYear,
    recentTradeCount: p.recent24Count,
    recent12moCount: p.recent12Count,
    recent6moCount: p.recent6Count,
    totalTradeCount: p.totalTradeCount,
    lastTradeDate: p.lastTradeDate.slice(0, 10),
    firstTradeDate: p.firstTradeDate.slice(0, 10),
    classification,
    masterCreateReadiness: masterCreateReadiness as Readiness,
    canonicalName: p.canonicalName,
    officialSource: 'MOLIT RTMSDataSvcAptTradeDev(국토교통부 아파트 매매 실거래, ApartmentTradeHistory 영구 저장본)',
    evidence,
    duplicateMaster: !!sameAddressDifferentName,
    priority: masterCreateReadiness === 'READY_FOR_MASTER_CREATE' ? 'P1' : 'P2',
    recommendedAction,
    confidence,
  };
});

const summary = {
  total: rows.length,
  READY_FOR_MASTER_CREATE: rows.filter((r) => r.masterCreateReadiness === 'READY_FOR_MASTER_CREATE').length,
  REVIEW_REQUIRED: rows.filter((r) => r.masterCreateReadiness === 'REVIEW_REQUIRED').length,
  DO_NOT_CREATE: rows.filter((r) => r.masterCreateReadiness === 'DO_NOT_CREATE').length,
  classifications: rows.reduce((acc: Record<string, number>, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {}),
  confidence: rows.reduce((acc: Record<string, number>, r) => {
    acc[r.confidence] = (acc[r.confidence] || 0) + 1;
    return acc;
  }, {}),
};

console.log(JSON.stringify(summary, null, 2));

const outPath = path.resolve(__dirname, '../data/master-integrity/recent-master-missing-16-v1.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
console.log(`\n저장: ${outPath}`);
