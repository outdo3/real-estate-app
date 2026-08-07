import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    
    // 네이버 검색 결과 스크래핑
    const query = encodeURIComponent(`${aptName} 아파트 정보`);
    const searchUrl = `https://search.naver.com/search.naver?query=${query}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch from Naver');
    }
    
    const html = await response.text();
    
    // 정규식으로 '총 X세대' 또는 'X세대', '2019년 준공' 등 추출
    const info: Record<string, string> = {};
    
    const householdMatch = html.match(/(?:총\s*)?([0-9,]+)세대/);
    if (householdMatch) {
      info['세대수'] = `${householdMatch[1]}세대`;
    }
    
    const yearMatch = html.match(/([0-9]{4})년\s*(?:준공|입주)/);
    if (yearMatch) {
      info['사용승인일'] = `${yearMatch[1]}년`;
    }
    
    const parkingMatch = html.match(/(?:주차대수|총주차대수)\s*([0-9,]+대)/);
    if (parkingMatch) {
      info['총주차대수'] = parkingMatch[1];
    }

    return NextResponse.json({ 
      success: true, 
      aptName,
      info: Object.keys(info).length > 0 ? info : null 
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return NextResponse.json({ success: false, error: 'Failed to scrape info' }, { status: 500 });
  }
}
