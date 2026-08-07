import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || '부산광역시 서구';
  const type = searchParams.get('type') || '중등';

  // NEIS API KEY (환경변수 또는 샘플)
  const apiKey = process.env.NEIS_API_KEY || 'sample';
  
  try {
    // 교육청 코드 (부산: C10)
    // 실제 NEIS API 호출 예시 (샘플 키로는 데이터가 제한적일 수 있음)
    const neisUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&pIndex=1&pSize=500&ATPT_OFCDC_SC_CODE=C10`;
    
    // API 키가 유효하다면 실제 호출
    let rawSchools = [];
    
    try {
      const res = await fetch(neisUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.schoolInfo && data.schoolInfo[1] && data.schoolInfo[1].row) {
          rawSchools = data.schoolInfo[1].row;
        }
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

    // 1. 지역 필터링 (LCTN_SC_NM 또는 ORG_RDNMA 사용)
    let filtered = rawSchools.filter((s: any) => 
      (s.LCTN_SC_NM && s.LCTN_SC_NM.includes(region.replace('부산광역시 ', ''))) ||
      (s.ORG_RDNMA && s.ORG_RDNMA.includes(region)) ||
      (region === '부산광역시 서구' && s.SCHUL_NM.includes('대신')) // Fallback for sample demo
    );

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
      // 랜덤 데이터로 성취도 및 학생 수 시뮬레이션 (실제 API가 제공하지 않는 세부 정보)
      const students = Math.floor(Math.random() * 500) + 200;
      
      if (type === '초등') {
        return {
          id: s.SD_SCHUL_CODE || `e${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          classStudents: Math.floor(Math.random() * 10) + 18,
          walkTime: `도보 ${Math.floor(Math.random() * 10) + 2}분`,
          crossRoad: Math.random() > 0.5 ? '건널목 1개' : '단지 내 (초품아)'
        };
      } else if (type === '중등') {
        const special = Math.floor(Math.random() * 15);
        return {
          id: s.SD_SCHUL_CODE || `m${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          achievement: Math.floor(Math.random() * 20) + 75,
          specialHigh: special,
          specialRatio: ((special / students) * 100).toFixed(1)
        };
      } else {
        return {
          id: s.SD_SCHUL_CODE || `h${index}`,
          name: s.SCHUL_NM,
          rank: index + 1,
          students: students,
          univRate: (Math.random() * 30 + 50).toFixed(1),
          medSeoulRate: (Math.random() * 10 + 5).toFixed(1),
          type: s.HS_GNRL_BUSNS_SC_NM || '일반고'
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
