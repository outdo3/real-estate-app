// E-JIP SCORE V2 STEP 0.7 §3 — 실제 MOLIT 거래 API 응답 field 확인(추정 금지).
// 기존 src/lib/api-molit.ts(production에서 이미 쓰는 함수) 그대로 재사용, READ-ONLY.
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  // 정적 import는 dotenv.config()보다 먼저 평가돼 api-molit.ts의 모듈-스코프
  // API_KEY 상수가 undefined로 굳어버린다(ESM import hoisting) — dynamic import로
  // dotenv 로드 이후에 모듈을 평가시킨다.
  const { fetchMolitData } = await import('../../src/lib/api-molit');
  // 서구(26140), 최근 3개월 표본
  const months = ['202607', '202606', '202605'];
  for (const dealYmd of months) {
    const rows = await fetchMolitData({ lawdCd: '26140', dealYmd, type: 'apt' });
    console.log(`\n=== 서구 26140, ${dealYmd}: ${rows.length}건 ===`);
    if (rows.length > 0) {
      console.log('첫 3건 원본 구조:');
      rows.slice(0, 3).forEach((r: any) => console.log(JSON.stringify({ aptSeq: r.aptSeq, name: r.name, dong: r.dong, jibun: r.jibun, buildYear: r.buildYear, excluUseArea: r.excluUseArea, dealDate: r.dealDate }, null, 1)));
      const withAptSeq = rows.filter((r: any) => r.aptSeq != null && r.aptSeq !== '');
      console.log(`aptSeq 있는 row: ${withAptSeq.length}/${rows.length}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
