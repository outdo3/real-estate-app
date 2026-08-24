const { PrismaClient } = require('@prisma/client');
const { calculateApartmentScore } = require('../../src/lib/apartment-score/server/calculate');
const prisma = new PrismaClient();

async function run() {
  const targets = [
    { aptSeq: '26140-1356', name: '대신해모센트럴' },
    { aptSeq: '26350-2216', name: '협성르네상스' },
    { aptSeq: '26140-11', name: '구덕금호' },
    { aptSeq: '26140-37', name: 'PAIR03_A_희망센츄럴빌' },
    { aptSeq: '26350-2285', name: 'PAIR03_B_해운대센텀두산위브' },
    { aptSeq: '26530-1021', name: 'PAIR04_A_사상로터리아파트' },
    { aptSeq: '26140-1361', name: 'PAIR04_B_e편한세상영도센트럴비치' },
    { aptSeq: '26290-94', name: 'PAIR06_A_LG메트로시티1' },
    { aptSeq: '26140-63', name: 'PAIR06_B_문화' },
    { aptSeq: '26470-27', name: 'PAIR10_A_진흥목화' },
    { aptSeq: '26440-125', name: 'PAIR10_B_더샵명지퍼스트월드' }
  ];
  for (const t of targets) {
    const res = await calculateApartmentScore(t.aptSeq);
    console.log(t.name, 'V1:', res.score, 'V2:', res._shadowV2?.overallScore?.toFixed(2) ?? res._shadowV2?.eligibility);
  }
}

run().finally(() => prisma.$disconnect());
