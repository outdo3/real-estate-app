import { createHash } from 'node:crypto';

// 국토부 CSV는 native record ID가 없다(R3B "sourceRecordId 전략" 2순위) — 결정론적
// fingerprint로 대체한다. stage/세대수는 절대 포함하지 않는다: 포함하면 원본 값이
// 갱신될 때마다(예: 사업이 다음 단계로 넘어갈 때마다) 매번 다른 fingerprint가 나와
// @@unique([source, sourceRecordId])가 새 레코드로 오인해 사실상 매번 새로 생성되는
// 문제가 생긴다(R3B 명시 지시사항).
export function molitFingerprint(params: {
  sido: string;
  sigungu: string;
  rawName: string;
  rawBusinessType: string | null;
}): string {
  const key = ['MOLIT', params.sido, params.sigungu, params.rawName, params.rawBusinessType ?? ''].join('|');
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
