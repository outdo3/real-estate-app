import { mapBusanBusinessType, mapMolitBusinessType, parseMolitBusinessTypeCode } from './businessType';
import { molitFingerprint } from './fingerprint';
import { normalizeName } from './normalize';
import { mapBusanStage, mapMolitStage, parseMolitStageCode } from './stage';
import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { BusanRawRecord, MolitRawRow, ParsedSourceRecord } from './types';

function parseHouseholdCountLoose(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '해당없음') return null;
  const n = parseInt(trimmed.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// R2 실측: 시도/시군구/구역명칭/현 사업추진단계/사업유형은 전부 채워져 있고
// 사업시행자만 6건 결측(이 필드는 이 파이프라인에서 쓰지 않는다). raw 값은 전부
// SourceRecord에 원문 그대로 보존한다.
export function parseMolitRow(row: MolitRawRow): ParsedSourceRecord {
  const sido = row.시도.trim();
  const sigungu = row.시군구.trim();
  const rawName = row.구역명칭.trim();
  const rawBusinessType = row.사업유형?.trim() || null;
  const rawStage = row.현사업추진단계?.trim() || null;
  const rawHouseholdCount = row.공급예정세대수?.trim() || null;

  return {
    source: SOURCE_MOLIT,
    sourceRecordId: molitFingerprint({ sido, sigungu, rawName, rawBusinessType }),
    rawName,
    sido,
    sigungu,
    rawBusinessType,
    rawBusinessTypeCode: rawBusinessType ? parseMolitBusinessTypeCode(rawBusinessType) : null,
    businessType: rawBusinessType ? mapMolitBusinessType(rawBusinessType) : 'UNKNOWN',
    rawStage,
    rawStageCode: rawStage ? parseMolitStageCode(rawStage) : null,
    stage: rawStage ? mapMolitStage(rawStage) : 'UNKNOWN',
    rawHouseholdCount,
    householdCount: parseHouseholdCountLoose(rawHouseholdCount),
    rawLocation: null, // 국토부 CSV에는 주소 필드 자체가 없음(R1/R2 확정)
    rawPayload: row,
    normalizedName: normalizeName(rawName),
  };
}

// 부산 API는 aCode(native id)가 있어 fingerprint가 필요 없다(R3B "sourceRecordId 전략"
// 1순위). areaName에서 사업유형을 추정하는 것 외에는 원본 그대로 사용.
export function parseBusanRecord(record: BusanRawRecord, sido = '부산광역시', sigungu: string | null = null): ParsedSourceRecord {
  const rawName = record.areaName.trim();
  const rawStage = record.step?.trim() || null;
  const rawHouseholdCount = record.generationJoo != null ? String(record.generationJoo).trim() : null;
  const rawLocation = record.location?.trim() || null;

  return {
    source: SOURCE_BUSAN,
    sourceRecordId: record.aCode,
    rawName,
    sido,
    sigungu: sigungu ?? extractSigunguFromLocation(rawLocation) ?? '미상',
    rawBusinessType: null, // 부산 API는 공식 유형 필드가 없음(R1/R2) — areaName 접미사 추정만
    rawBusinessTypeCode: null,
    businessType: mapBusanBusinessType(rawName),
    rawStage,
    rawStageCode: null, // 부산 API step은 코드가 아니라 라벨 텍스트 자체(R1/R2 실측)
    stage: rawStage ? mapBusanStage(rawStage) : 'UNKNOWN',
    rawHouseholdCount,
    householdCount: parseHouseholdCountLoose(rawHouseholdCount),
    rawLocation,
    rawPayload: record,
    normalizedName: normalizeName(rawName),
  };
}

// 부산 API 자체에는 구/군 전용 필드가 없다(R1/R2: location 텍스트에서만 부분적으로
// 추출 가능, 268/343건 중 148건만 구/군명이 텍스트에 직접 포함). 여기서는 location
// 텍스트에서 "OO구"/"OO군" 패턴만 뽑고, 못 찾으면 null을 반환해 호출부가 "미상"으로
// 떨어지게 한다 — 억지로 지어내지 않는다.
const BUSAN_GU_GUN_PATTERN = /(강서구|금정구|기장군|남구|동구|동래구|부산진구|북구|사상구|사하구|서구|수영구|연제구|영도구|중구|해운대구)/;

export function extractSigunguFromLocation(location: string | null): string | null {
  if (!location) return null;
  const m = location.match(BUSAN_GU_GUN_PATTERN);
  return m ? m[1] : null;
}
