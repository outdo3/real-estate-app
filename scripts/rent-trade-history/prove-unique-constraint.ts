// RENT_TRADE_HISTORY_V1 PHASE B §43 — UNIQUE CONSTRAINT PROOF. 실제 자연키 unique
// index가 DB 레벨에서 중복 insert를 막는지, 영구 데이터를 남기지 않고 검증한다.
// 트랜잭션 안에서 (1) 정상 create, (2) 완전히 같은 자연키로 두 번째 create 시도(반드시
// P2002로 실패해야 함) 후 트랜잭션을 의도적으로 throw로 중단해 rollback한다.
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ROLLBACK_SENTINEL = new Error('__INTENTIONAL_ROLLBACK__');

async function main() {
  const baseRow = {
    source: 'MOLIT_APT_RENT',
    lawdCd: '99999',
    dealYmd: '209912', // 실제 존재하지 않는 미래 더미 값 — 실 데이터와 절대 충돌하지 않게
    aptSeq: '__PROOF_TEST__',
    identityKey: 'id:__PROOF_TEST__',
    dealType: 'jeonse',
    groupKeyStr: 'id:__PROOF_TEST__::59.99::jeonse',
    aptName: '__PROOF_TEST__',
    dong: '__PROOF_TEST__',
    jibun: null,
    exclusiveArea: new Prisma.Decimal(59.99),
    deposit: 12345,
    monthlyRent: 0,
    dealYear: 2099,
    dealMonth: 12,
    dealDay: 1,
    dealDate: new Date('2099-12-01T00:00:00.000Z'),
    floor: 5,
    buildYear: null,
    contractType: null,
    contractTerm: null,
    preDeposit: null,
    preMonthlyRent: null,
    useRenewalRight: null,
    occurrenceIndex: 0,
  };

  let p2002Caught = false;
  try {
    await prisma.$transaction(async (tx) => {
      const first = await tx.apartmentRentHistory.create({ data: baseRow });
      console.log(`INSERT 1 succeeded (id=${first.id}) — 트랜잭션 내부, 아직 커밋 전`);
      try {
        await tx.apartmentRentHistory.create({ data: baseRow }); // 완전히 동일한 자연키
        console.log('INSERT 2 unexpectedly succeeded — UNIQUE CONSTRAINT가 작동하지 않음(문제!)');
      } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          p2002Caught = true;
          console.log(`INSERT 2 correctly rejected: P2002 unique constraint violation (target=${JSON.stringify(e.meta?.target)})`);
        } else {
          throw e;
        }
      }
      throw ROLLBACK_SENTINEL; // 무엇이 일어났든 항상 rollback — 영구 데이터 남기지 않음
    });
  } catch (e) {
    if (e !== ROLLBACK_SENTINEL) throw e;
    console.log('TRANSACTION ROLLED BACK (의도적) — DB에 어떤 row도 남지 않음');
  }

  const remaining = await prisma.apartmentRentHistory.count({ where: { aptSeq: '__PROOF_TEST__' } });
  console.log(`VERIFY: rollback 후 잔여 테스트 row 수 = ${remaining} (기대값: 0)`);
  console.log(`RESULT: p2002Caught=${p2002Caught} remaining=${remaining} => ${p2002Caught && remaining === 0 ? 'PASS' : 'FAIL'}`);

  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
