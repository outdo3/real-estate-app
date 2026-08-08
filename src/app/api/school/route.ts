import { NextResponse } from 'next/server';
import { resolveNeisEduCode, addressMatchesRegion } from '@/lib/neis-sido-codes';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const type = searchParams.get('type') || '중등';
  const [sido] = region.split(' ');

  // NEIS API KEY (환경변수 또는 샘플)
  const apiKey = process.env.NEIS_API_KEY || 'sample';

  // 교육청 코드를 시/도 이름으로 동적으로 조회한다. 예전에는 부산(C10)으로
  // 하드코딩되어 있어, 다른 시/도를 선택해도 항상 부산 학교 목록을 대상으로
  // 지역명(gungu)만 필터링하는 바람에 결과가 비거나 엉뚱한 지역이 섞이는
  // 문제가 있었다.
  const eduCode = resolveNeisEduCode(sido) || 'C10';

  try {
    // NEIS API는 pSize를 요청과 무관하게 최대 500건까지만 반환하므로,
    // list_total_count를 확인해 필요한 만큼 페이지를 순회해 전량을 확보한다.
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

    // 만약 실제 데이터가 부족하거나 에러가 나면 시뮬레이션용 진짜 학교 데이터 생성 (데모용 Fallback)
    if (rawSchools.length === 0) {
      rawSchools = [
        { SCHUL_NM: '대신중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://daeshin.ms.kr', SD_SCHUL_CODE: '1' },
        { SCHUL_NM: '경남중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://kyungnam.ms.kr', SD_SCHUL_CODE: '2' },
        { SCHUL_NM: '부경중학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '중학교', HMPG_ADRES: 'http://pukyong.ms.kr', SD_SCHUL_CODE: '3' },
        
        { SCHUL_NM: '송도초등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '초등학교', HMPG_ADRES: 'http://songdo.es.kr', SD_SCHUL_CODE: '4' },
        { SCHUL_NM: '천마초등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '초등학교', HMPG_ADRES: 'http://chunma.es.kr', SD_SCHUL_CODE: '5' },
        
        { SCHUL_NM: '부경고등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '고등학교', HMPG_ADRES: 'http://pukyong.hs.kr', SD_SCHUL_CODE: '6' },
        { SCHUL_NM: '경남고등학교', LCTN_SC_NM: '부산광역시 서구', SCHUL_KND_SC_NM: '고등학교', HMPG_ADRES: 'http://kyungnam.hs.kr', SD_SCHUL_CODE: '7' }
      ];
    }

    // 1. 지역 필터링: 주소를 토큰 단위로 쪼개 gungu와 정확히 일치하는 경우만 허용
    // (예전 addr.includes(gungu) 방식은 "강서구".includes("서구") === true라
    // '서구'를 선택해도 '강서구' 학교가 함께 매칭될 수 있었다)
    const gungu = region.split(' ')[1] || '';
    let filtered = rawSchools.filter((s: any) => {
      const addr = (s.ORG_RDNMA || s.LCTN_SC_NM || '');
      if (addressMatchesRegion(addr, region, gungu)) return true;
      // Fallback for sample demo
      if (region === '부산광역시 서구' && s.SCHUL_NM.includes('대신')) return true;
      return false;
    });

    // 2. 학교급 필터링
    const kindMap: Record<string, string> = {
      '초등': '초등학교',
      '중등': '중학교',
      '고등': '고등학교'
    };
    const targetKind = kindMap[type];
    if (targetKind) {
      filtered = filtered.filter((s: any) => s.SCHUL_KND_SC_NM === targetKind);
    }

    // 3. UI 렌더링을 위한 데이터 가공 (실무에서는 학업성취도 API, 대학진학 API 등을 추가 호출하여 Join)
    const result = filtered.map((s: any, index: number) => {
      // 이름 기반 해시(seed)를 만들어 탭을 오가도 값이 고정되게 처리 (안정감 있는 모의 데이터)
      const nameHash = s.SCHUL_NM.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      const seed1 = (nameHash % 100) / 100; // 0.0 ~ 0.99
      const seed2 = ((nameHash * 3) % 100) / 100;

      // 학급당 인원은 15~28명 선, 학생수는 200~1000명 선으로 현실화
      const classStudents = Math.floor(seed1 * 13) + 15; 
      const students = classStudents * (Math.floor(seed2 * 15) + 10);
      
      if (type === '초등') {
        // 초품아 여부 (확률 20%)
        const isChopuma = seed1 > 0.8;
        return {
          id: s.SD_SCHUL_CODE || `e${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          graduates: Math.floor(students / 6),
          classStudents: classStudents,
          walkTime: isChopuma ? '도보 1분' : `도보 ${Math.floor(seed2 * 10) + 3}분`,
          crossRoad: isChopuma ? '단지 내 (초품아)' : `건널목 ${Math.floor(seed1 * 3) + 1}개`
        };
      } else if (type === '중등') {
        // 학업성취도는 65~98% 수준으로 현실화
        const achievement = Math.floor(seed1 * 33) + 65;
        const graduates = Math.floor(students / 3);
        // 특목고 진학명수는 학생수의 0~5% 수준
        const special = Math.floor(students * (seed2 * 0.05));
        const sciHigh = Math.floor(special * (seed1 * 0.5 + 0.1));
        const foreignHigh = special - sciHigh;
        
        return {
          id: s.SD_SCHUL_CODE || `m${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          graduates: graduates,
          classStudents: classStudents,
          achievement: achievement,
          specialHigh: special,
          sciHigh: sciHigh,
          foreignHigh: foreignHigh,
          specialRatio: graduates > 0 ? ((special / graduates) * 100).toFixed(1) : "0.0"
        };
      } else {
        // 4년제 진학률 40~85%, 의약계열 2~12% 수준
        const graduates = Math.floor(students / 3);
        return {
          id: s.SD_SCHUL_CODE || `h${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          graduates: graduates,
          classStudents: classStudents,
          univRate: (seed1 * 45 + 40).toFixed(1),
          medSeoulRate: (seed2 * 10 + 2).toFixed(1),
          type: s.HS_GNRL_BUSNS_SC_NM || (seed1 > 0.8 ? '자율고' : '일반고')
        };
      }
    });

    // 랭킹 정렬 (점수 높은 순)
    if (type === '중등') result.sort((a: any, b: any) => parseFloat(b.specialRatio) - parseFloat(a.specialRatio));
    if (type === '고등') result.sort((a: any, b: any) => parseFloat(b.univRate) - parseFloat(a.univRate));

    // 랭크 재부여
    result.forEach((r: any, idx: number) => r.rank = idx + 1);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('School API Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch school data' }, { status: 500 });
  }
}
