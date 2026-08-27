/**
 * STATISTICS V2 — REGIONAL TRANSACTION FEED §46/§47. 이 기능은 persisted DB
 * table이 없고 전부 MOLIT 라이브 조회 기반이라(§3 감사 결과), QA도 DB 쿼리가
 * 아니라 실행 중인 dev 서버의 `/api/stats/feed`를 직접 호출해 응답 구조·계산
 * 정합성을 검사하는 방식으로 만든다(read-only — GET만 호출, 쓰기 없음).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-qa.ts [옵션]
 *
 * 옵션:
 *   --region=<lawdCd>   기본 부산 서구(26140)
 *   --district=<lawdCd> --region의 별칭
 *   --period=<preset>   기본 12m(신고가/직전거래 비교 표본을 넉넉히 확보하기 위해)
 *   --quick             fixture 단지 존재여부 검사 생략(속도 우선)
 *   --json              tmp/qa/STATISTICS_V2_QA.json로 저장
 *   --base=<url>        기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}

const OPT = {
  region: flag('region') || flag('district') || '26140',
  period: flag('period') || '12m',
  quick: flag('quick') !== null,
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_WRONG_SCHOOL' | 'P0_WRONG_REGION' | 'P0_INVALID_STAT' | 'P1_DATA_GAP' | 'INFO';
  region: string;
  detail: string;
}

const FIXTURE_REGIONS: { lawdCd: string; label: string; apartments: string[] }[] = [
  { lawdCd: '26140', label: '부산 서구', apartments: ['대신롯데캐슬'] },
  { lawdCd: '26470', label: '부산 연제구', apartments: ['한솔솔파크', '일동미라주더스타'] },
  { lawdCd: '26350', label: '부산 해운대구', apartments: [] },
  { lawdCd: '11680', label: '서울 강남구', apartments: [] },
];

async function fetchFeed(base: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/api/stats/feed?${qs}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
  return res.json();
}

async function main() {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  for (const fixture of FIXTURE_REGIONS) {
    const data = await fetchFeed(OPT.base, { lawdCd: fixture.lawdCd, period: OPT.period, limit: '200' });
    if (data.status !== 'OK') {
      push({ severity: data.status === 'HTTP_ERROR' ? 'P0_WRONG_REGION' : 'P1_DATA_GAP', region: fixture.label, detail: `feed 응답 status=${data.status || data.httpStatus}` });
      continue;
    }

    const allTrades = (data.groups || []).flatMap((g: any) => g.trades as any[]);

    // A. 지역/기간 경계 — 모든 거래가 요청한 lawdCd/기간에 속하는지(dong 필터는
    // 응답에 dong 원본 필드가 없어 여기선 생략, region 자체는 API가 lawdCd로
    // 조회했으므로 응답의 region.lawdCd 일치만 확인).
    if (data.region?.lawdCd !== fixture.lawdCd) {
      push({ severity: 'P0_WRONG_REGION', region: fixture.label, detail: `요청 lawdCd(${fixture.lawdCd}) != 응답 region.lawdCd(${data.region?.lawdCd})` });
    }
    for (const t of allTrades) {
      if (t.dealDate < data.period.from || t.dealDate > data.period.to) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `기간(${data.period.from}~${data.period.to}) 밖 거래 포함: ${t.name} ${t.dealDate}` });
      }
    }

    // B. 취소거래가 집계에 섞였는지.
    for (const t of allTrades) {
      if (t.dealCanceled && (t.isRecordHigh || t.changeAmount != null)) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `취소거래가 신고가/직전거래 비교에 포함됨: ${t.name} ${t.dealDate}` });
      }
    }

    // C. 중복 거래(동일 그룹+금액+날짜+층).
    const seen = new Set<string>();
    for (const t of allTrades) {
      const key = `${t.aptSeq || t.name + '|' + t.dong}|${t.excluUseArea}|${t.dealType}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}`;
      if (seen.has(key)) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `중복 거래 의심: ${t.name} ${t.dealDate} ${t.dealAmount}` });
      seen.add(key);
    }

    // D. 날짜 그룹 정합성 — 그룹 내림차순, 그룹 안 거래의 dealDate가 그룹 날짜와 일치.
    const dates = (data.groups || []).map((g: any) => g.date);
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] >= dates[i - 1]) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `날짜 그룹이 내림차순이 아님: ${dates[i - 1]} -> ${dates[i]}` });
    }
    for (const g of data.groups || []) {
      for (const t of g.trades) {
        if (t.dealDate !== g.date) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `그룹 날짜(${g.date})와 거래 dealDate(${t.dealDate}) 불일치: ${t.name}` });
      }
    }

    // E. 거래량 집계 정합성 — verifiedCount(비취소) 재계산 후 응답 summary와 비교.
    // (pagination으로 일부만 반환될 수 있어 total>=limit이면 스킵 — 정합성 확인은
    // 첫 페이지가 전체를 다 담는 짧은 기간에서만 100% 신뢰 가능.)
    if (!data.pagination.hasMore) {
      const recomputedVerified = allTrades.filter((t: any) => !t.dealCanceled).length;
      if (recomputedVerified !== data.summary.verifiedCount) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `verifiedCount 불일치: 응답=${data.summary.verifiedCount}, 재계산=${recomputedVerified}` });
      }
      const recomputedRecordHigh = allTrades.filter((t: any) => t.isRecordHigh).length;
      if (recomputedRecordHigh !== data.summary.recordHighCount) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `recordHighCount 불일치: 응답=${data.summary.recordHighCount}, 재계산=${recomputedRecordHigh}` });
      }
    }

    // F. apartment 링크 안전성 — name/dong이 비어있는 row가 canonical 링크 생성에 쓰이면 위험.
    for (const t of allTrades) {
      if (!t.name || t.name === '이름 없음') {
        push({ severity: 'P1_DATA_GAP', region: fixture.label, detail: `단지명 미확보 거래 존재(링크 위험) — dealDate=${t.dealDate}` });
      }
    }

    // G. fixture 단지 존재 여부(정보성 — 특정 기간에 실거래가 없을 수 있어 실패로 보지 않음).
    if (!OPT.quick) {
      for (const aptName of fixture.apartments) {
        const found = allTrades.some((t: any) => t.name.includes(aptName));
        push({ severity: 'INFO', region: fixture.label, detail: `${aptName}: ${found ? '기간 내 실거래 발견' : `${OPT.period} 내 실거래 없음(정상일 수 있음)`}` });
      }
    }

    console.log(`[${fixture.label}] verifiedCount=${data.summary.verifiedCount} recordHigh=${data.summary.recordHighCount} rise=${data.summary.riseCount} fall=${data.summary.fallCount} cancelled=${data.summary.cancelledCount}`);
  }

  // H. period preset 전수 확인(서구 기준) — 크래시/구조 오류만 체크.
  const presets = ['today', 'yesterday', '7d', 'thisWeek', 'lastWeek', '30d', '12m'];
  for (const preset of presets) {
    const data = await fetchFeed(OPT.base, { lawdCd: '26140', period: preset, limit: '20' });
    if (data.status !== 'OK') {
      push({ severity: 'P1_DATA_GAP', region: '부산 서구', detail: `preset=${preset} 응답 status=${data.status}` });
    }
  }

  // I. dong 필터 확인.
  const dongData = await fetchFeed(OPT.base, { lawdCd: '26140', dong: '암남동', period: '30d', limit: '200' });
  if (dongData.status === 'OK') {
    const wrongDong = (dongData.groups || []).flatMap((g: any) => g.trades).filter((t: any) => t.dong !== '암남동');
    if (wrongDong.length > 0) push({ severity: 'P0_WRONG_REGION', region: '부산 서구 암남동', detail: `dong 필터 적용에도 다른 동 거래 ${wrongDong.length}건 포함` });
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_SCHOOL || 0) + (counts.P0_WRONG_REGION || 0) + (counts.P0_INVALID_STAT || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}] ${f.region}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'STATISTICS_V2_QA.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, releaseGate, findings }, null, 2));
    console.log('\n(JSON: tmp/qa/STATISTICS_V2_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
