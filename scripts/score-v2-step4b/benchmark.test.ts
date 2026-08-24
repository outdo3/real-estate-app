import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma';
import { calculateApartmentScore } from '../../src/lib/apartment-score/server/calculate';

test('BENCHMARK REGRESSION', async () => {
  const targets = [
    { name: '대신해모센트럴', lawdCd: '' },
    { name: '협성르네상스', lawdCd: '' },
    { name: '구덕금호', lawdCd: '' },
    { aptSeq: '26140-37', name: 'PAIR03_A_희망센츄럴빌' },
    { aptSeq: '26350-2285', name: 'PAIR03_B_해운대센텀두산위브' },
    { aptSeq: '26530-1021', name: 'PAIR04_A_사상로터리아파트' },
    { aptSeq: '26140-1361', name: 'PAIR04_B_e편한세상영도센트럴비치' },
    { aptSeq: '26290-94', name: 'PAIR06_A_LG메트로시티1' },
    { aptSeq: '26140-63', name: 'PAIR06_B_문화' },
    { aptSeq: '26470-27', name: 'PAIR10_A_진흥목화' },
    { aptSeq: '26440-125', name: 'PAIR10_B_더샵명지퍼스트월드' },
  ];

  const results: any[] = [];

  for (const t of targets) {
    let aptSeq = t.aptSeq;
    if (!aptSeq) {
      const match = await prisma.apartmentMaster.findFirst({
        where: { name: { contains: t.name } },
        select: { aptSeq: true }
      });
      if (match && match.aptSeq) {
        aptSeq = match.aptSeq;
      }
    }
    if (!aptSeq) {
      console.warn('Cannot find aptSeq for', t.name);
      continue;
    }

    const res = await calculateApartmentScore(aptSeq);
    
    const v2Result = (res as any)._shadowV2;

    results.push({
      name: t.name,
      aptSeq,
      v1_status: res.status,
      v1_score: res.score,
      v1_coverage: res.coverage,
      v2_status: v2Result?.eligibility,
      v2_overall: v2Result?.overallScore,
      v2_coverage: v2Result?.overallCoverage,
      v2_domains: v2Result?.domains,
    });
  }

  console.log(JSON.stringify(results, null, 2));

  // Assertions for specific targets
  const guduk = results.find(r => r.name.includes('구덕금호'));
  assert.ok(guduk, '구덕금호 should be tested');
  assert.equal(guduk.v2_status, 'NOT_ENOUGH_DATA');
});
