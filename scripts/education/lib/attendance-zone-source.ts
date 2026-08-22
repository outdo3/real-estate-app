import * as shapefile from 'shapefile';
import proj4 from 'proj4';
import * as iconv from 'iconv-lite';

// PRJ 파일에서 직접 확인한 정의(Korea_2000_Korea_Central_Belt_2010 = EPSG:5186)와
// 완전히 동일한 파라미터. 임의 추정이 아니라 원본 .prj WKT를 그대로 옮긴 것.
const EPSG_5186 =
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

const toWgs84 = proj4(EPSG_5186, WGS84);

export type RawZoneProps = {
  OBJECTID: number;
  HAKGUDO_ID: string;
  HAKGUDO_NM: string;
  HAKGUDO_GB: string; // '0' = 단일/일반, '1' = 공동통학구역(elementary) / (middle에서는 관측 안 됨)
  SD_CD: string;
  SGG_CD: string;
  EDU_UP_CD: string;
  EDU_UP_NM: string;
  EDU_CD: string;
  EDU_NM: string;
  CRE_DT: string;
  UPD_DT: string;
  BASE_DT: string;
  ESRI_OID: number;
};

export type ZoneRecord = {
  objectId: number;
  zoneId: string; // HAKGUDO_ID, "Z"+9자리
  zoneName: string;
  zoneTypeRaw: string; // HAKGUDO_GB
  isShared: boolean; // HAKGUDO_GB === '1'
  isAsymmetric: boolean; // zoneName에 "(일방)" 포함
  lawdCd: string; // SD_CD + SGG_CD, School.sigunguCode와 동일 포맷(실측 검증됨)
  sdCd: string;
  sggCd: string;
  eduOfficeName: string;
  baseDate: string;
  geometryTypeRaw: 'Polygon' | 'MultiPolygon';
  // WGS84(EPSG:4326)로 변환된 GeoJSON geometry. turf.js와 바로 호환.
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

function transformRing(ring: number[][]): number[][] {
  return ring.map(([x, y]) => toWgs84.forward([x, y]));
}

function transformGeometry(geom: GeoJSON.Geometry): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(transformRing) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => poly.map(transformRing)),
    };
  }
  throw new Error(`예상치 못한 geometry type: ${geom.type}`);
}

export async function loadAllZones(shpPath: string, dbfPath: string): Promise<ZoneRecord[]> {
  const source = await shapefile.open(shpPath, dbfPath, { encoding: 'EUC-KR' });
  const out: ZoneRecord[] = [];
  let r = await source.read();
  while (!r.done) {
    const p = r.value.properties as RawZoneProps;
    const geom = r.value.geometry as GeoJSON.Geometry;
    out.push({
      objectId: p.OBJECTID,
      zoneId: p.HAKGUDO_ID,
      zoneName: p.HAKGUDO_NM,
      zoneTypeRaw: p.HAKGUDO_GB,
      isShared: p.HAKGUDO_GB === '1',
      isAsymmetric: p.HAKGUDO_NM.includes('일방'),
      lawdCd: `${p.SD_CD}${p.SGG_CD}`,
      sdCd: p.SD_CD,
      sggCd: p.SGG_CD,
      eduOfficeName: p.EDU_NM,
      baseDate: p.BASE_DT,
      geometryTypeRaw: geom.type as 'Polygon' | 'MultiPolygon',
      geometry: transformGeometry(geom),
    });
    r = await source.read();
  }
  return out;
}

export function filterBusan(zones: ZoneRecord[]): ZoneRecord[] {
  return zones.filter((z) => z.sdCd === '26');
}

/**
 * 학구 이름(HAKGUDO_NM)에서 학교명 토큰을 순서대로 추출한다.
 * "온천초공덕초금성초공동(일방)통학구역" -> ["온천초", "공덕초", "금성초"]
 * "장림초통학구역" -> ["장림초"]
 * 접미사(공동/일방/통학구역)를 제거한 후 "초"/"중"/"고" 경계로 분리.
 * 순서상 첫 토큰이 "큰"(본구역), 이후가 "작은"(선택 가능)이라는 관계는
 * C6 실측(신화타워: 온천초=큰/금성초·공덕초=작은)과 본 STEP의 CSV cross-check로
 * 교차 검증됐으나, 표본이 1건뿐이라 UI 확정 문구에는 신중히 반영한다(§30 참고).
 */
export function parseZoneSchoolNameTokens(zoneName: string): string[] {
  const stripped = zoneName
    .replace(/공동\(일방\)통학구역$/, '')
    .replace(/공동통학구역$/, '')
    .replace(/통학구역$/, '');
  const tokens = stripped.match(/[^초중고]+[초중고]/g);
  return tokens ?? [stripped];
}

// CSV 파싱: 학구ID,학교ID,학교명,학교급구분,시도교육청코드,시도교육청명,교육지원청코드,교육지원청명,데이터기준일자
export type LinkageRow = {
  zoneId: string;
  schoolId: string; // "B"+9자리, official other code
  schoolName: string;
  schoolLevelRaw: string;
  sidoEduCode: string;
  sidoEduName: string;
  eduOfficeCode: string;
  eduOfficeName: string;
  baseDate: string;
};

// EUC-KR 바이트열(콤마 0x2C는 EUC-KR 완성형 lead/trail 바이트 범위(0xA1-0xFE)와
// 겹치지 않으므로 raw byte 기준으로 안전하게 split 가능 — 실측 CPG=EUC-KR 확인됨)
export function parseLinkageCsv(raw: Buffer): LinkageRow[] {
  const COMMA = 0x2c;
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0a) {
      lines.push(raw.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < raw.length) lines.push(raw.subarray(start));

  const splitCols = (line: Buffer): Buffer[] => {
    const cols: Buffer[] = [];
    let s = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === COMMA) {
        cols.push(line.subarray(s, i));
        s = i + 1;
      }
    }
    cols.push(line.subarray(s));
    return cols;
  };
  const dec = (b: Buffer) => iconv.decode(b, 'euc-kr').replace(/\r$/, '').trim();

  const rows: LinkageRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].length === 0) continue;
    const cols = splitCols(lines[i]);
    if (cols.length < 9) continue;
    rows.push({
      zoneId: dec(cols[0]),
      schoolId: dec(cols[1]),
      schoolName: dec(cols[2]),
      schoolLevelRaw: dec(cols[3]),
      sidoEduCode: dec(cols[4]),
      sidoEduName: dec(cols[5]),
      eduOfficeCode: dec(cols[6]),
      eduOfficeName: dec(cols[7]),
      baseDate: dec(cols[8]),
    });
  }
  return rows;
}
