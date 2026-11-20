import { isPublicRegionAllowed } from './enablement';
import legalDongs from './legal-dongs.json';

// 행정표준코드관리시스템 법정동 코드 전체자료 (원본 파일 2026-10-01).
// 현존 법정 읍·면·동·리만 포함한다. 거래 원본에 사용하는 읍/면+리 표기를 유지한다.
const byDistrict: Readonly<Record<string, readonly (readonly string[])[] | undefined>> = legalDongs;

export function getPublicLegalDongs(lawdCd: string) {
  if (!isPublicRegionAllowed(lawdCd, 'app')) return [];
  return (byDistrict[lawdCd] ?? []).map(([code, name]) => ({ code, name }));
}
