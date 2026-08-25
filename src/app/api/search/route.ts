import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Define our result types
export type RegionSearchResult = {
  type: 'REGION';
  name: string;      // e.g. "연산동"
  sido: string;      // "부산광역시"
  sigungu: string;   // "연제구"
  dong: string;      // "연산동"
  lawdCd: string;    // "26470" (연제구 법정동코드)
};

export type ApartmentSearchResult = {
  type: 'APARTMENT';
  apartmentId: number;
  name: string;
  lawdCd: string | null;
  dong: string | null;
  jibun: string | null;
  aptSeq: string | null;
  lat: number | null;
  lng: number | null;
  totalHouseholds: number | null;
  completionYear: number | null;
};

export type UnifiedSearchResult = {
  regions: RegionSearchResult[];
  apartments: ApartmentSearchResult[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ regions: [], apartments: [] });
  }

  const keyword = q.trim();
  const normalizedKeyword = keyword.replace(/\s+/g, '');

  // Search regions (distinct dongs that match the keyword)
  // We can group by using Prisma API
  const regionGroups = await prisma.apartmentMaster.groupBy({
    by: ['sido', 'sigungu', 'sggCd', 'umdName'],
    where: {
      umdName: {
        contains: normalizedKeyword
      }
    },
    _count: {
      umdName: true
    },
    orderBy: {
      _count: {
        umdName: 'desc'
      }
    },
    take: 5
  });

  const regions: RegionSearchResult[] = regionGroups.map(r => ({
    type: 'REGION',
    name: `${r.sido} ${r.sigungu} ${r.umdName}`.trim(),
    sido: r.sido || '',
    sigungu: r.sigungu || '',
    dong: r.umdName || '',
    lawdCd: r.sggCd || ''
  }));

  // Search apartments
  const rawApartments = await prisma.apartmentMaster.findMany({
    where: {
      OR: [
        { normalizedName: { contains: normalizedKeyword } },
        { name: { contains: normalizedKeyword } }
      ]
    },
    take: 15,
    orderBy: { totalHouseholds: 'desc' },
    select: {
      id: true,
      name: true,
      sggCd: true,
      umdName: true,
      jibun: true,
      aptSeq: true,
      buildYear: true,
      totalHouseholds: true,
    }
  });

  const aptSeqs = rawApartments.map(a => a.aptSeq).filter(Boolean) as string[];
  const locations = await prisma.apartmentLocationFeature.findMany({
    where: {
      aptSeq: { in: aptSeqs }
    },
    select: {
      aptSeq: true,
      latitude: true,
      longitude: true
    }
  });

  const locationMap = new Map(locations.map(l => [l.aptSeq, l]));

  const apartments: ApartmentSearchResult[] = rawApartments.map(a => {
    const loc = a.aptSeq ? locationMap.get(a.aptSeq) : null;
    return {
      type: 'APARTMENT',
      apartmentId: a.id,
      name: a.name,
      lawdCd: a.sggCd,
      dong: a.umdName,
      jibun: a.jibun,
      aptSeq: a.aptSeq,
      lat: loc ? loc.latitude : null,
      lng: loc ? loc.longitude : null,
      totalHouseholds: a.totalHouseholds,
      completionYear: a.buildYear
    };
  });

  return NextResponse.json({ regions, apartments });
}
