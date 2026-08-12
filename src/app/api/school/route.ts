import { NextResponse } from 'next/server';
import { resolveNeisEduCode, addressMatchesRegion } from '@/lib/neis-sido-codes';
import { getOrSetCache } from '@/lib/server-cache';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const type = searchParams.get('type') || '중등';
  const [sido] = region.split(' ');

  // NEIS API KEY (환경변수 또는 샘플)
  const apiKey = process.env.NEIS_API_KEY || 'sample';

  const eduCode = resolveNeisEduCode(sido) || 'C10';

  try {
    const result = await getOrSetCache(`school-list:${region}:${type}`, 10 * 60 * 1000, async () => {
      let rawSchools: any[] = [];

      try {
        const pageSize = 500;
        let pIndex = 1;
        let totalCount = Infinity;

        while ((pIndex - 1) * pageSize < totalCount) {
          const neisUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&pIndex=${pIndex}&pSize=${pageSize}&ATPT_OFCDC_SC_CODE=${eduCode}`;
          const res = await fetch(neisUrl);
          if (!res.ok) break;
          const data = await res.json();
          totalCount = data.schoolInfo?.[0]?.head?.[0]?.list_total_count ?? 0;
          const rows = data.schoolInfo?.[1]?.row || [];
          if (rows.length === 0) break;
          rawSchools = rawSchools.concat(rows);
          pIndex++;
        }
      } catch (e) {
        console.warn("NEIS API 호출 실패, Fallback 적용", e);
      }

      // NEIS 호출이 완전히 실패한 경우, 과거에는 실존하지 않을 수도 있는 가짜 학교
      // 목록(대신중학교 등 하드코딩 샘플)으로 채워 마치 실제 조회 결과처럼 보여줬다.
      // 실제 데이터를 확보하지 못했으면 빈 목록을 그대로 반환한다(가짜 학교 생성 금지).

      const gungu = region.split(' ')[1] || '';
      let filtered = rawSchools.filter((s: any) => {
        const addr = (s.ORG_RDNMA || s.LCTN_SC_NM || '');
        if (addressMatchesRegion(addr, region, gungu)) return true;
        if (region === '부산광역시 서구' && s.SCHUL_NM.includes('대신')) return true;
        return false;
      });

      const kindMap: Record<string, string> = {
        '초등': '초등학교',
        '중등': '중학교',
        '고등': '고등학교'
      };
      const targetKind = kindMap[type];
      if (targetKind) {
        filtered = filtered.filter((s: any) => s.SCHUL_KND_SC_NM === targetKind);
      }

      // 학생수/학급당인원/학업성취도/특목고 진학률/통학시간 등은 NEIS schoolInfo API에
      // 없는 값이라, 과거에는 학교명 문자열 해시로 만든 시드값(seed1/seed2)으로 이 모든
      // 수치를 지어내 실제 통계처럼 보여줬다(STEP 1 감사에서 발견). 실제 근거가 있는
      // 필드(학교명, 학교코드, 고교 유형 구분)만 남기고 나머지는 생성하지 않는다 — 화면에서는
      // 해당 항목을 "데이터 준비 중"으로 표시한다.
      const mapped = filtered.map((s: any, index: number) => {
        const base = {
          id: s.SD_SCHUL_CODE || `${type}${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
        };

        if (type === '고등') {
          return {
            ...base,
            // HS_GNRL_BUSNS_SC_NM(일반고/특성화고 등 계열 구분)는 NEIS가 실제로 제공하는
            // 필드다. 값이 없을 때 임의로 '자율고'/'일반고'를 추측해 채우지 않는다.
            schoolType: s.HS_GNRL_BUSNS_SC_NM || null,
          };
        }
        return base;
      });

      // 실제 근거가 있는 순위 기준이 없으므로(과거의 '진학률 순' 정렬은 가짜 수치
      // 기준이었다) 가나다순으로만 정렬한다.
      mapped.sort((a: any, b: any) => a.name.localeCompare(b.name, 'ko'));
      mapped.forEach((r: any, idx: number) => r.rank = idx + 1);

      return mapped;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('School API Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch school data' }, { status: 500 });
  }
}
