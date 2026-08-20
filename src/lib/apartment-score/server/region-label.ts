import type { PeerLevel } from './types';

// [BUSAN SCORE DATA V1 §3] calculate.ts는 예전에 카테고리마다 실제로 어떤 peer
// level(LOCAL/SIGUNGU/REGION_WIDE)이 쓰였는지와 무관하게 항상 sigungu 이름
// ("서구")을 설명 문구에 넣었다 — 실측(§25 감사)상 94.3%가 실제로는 LOCAL(동)
// 비교였는데도 "서구 비교 단지보다"라고 표현된 것. score/percentile 계산 자체는
// 옳았고 텍스트만 실제보다 넓은 비교처럼 보였다.
//
// 이 함수는 카테고리별 실제 peerLevel에 맞는 지역 표현을 고른다 — score/weight
// 공식은 전혀 건드리지 않는다(레이블만 correctness 수정).
//
// @param isDecadeBandLocal 주차(§11)는 LOCAL이 "동"이 아니라 "sigungu +
//   buildYear 10년대 band"라 동 이름을 쓰면 오히려 틀린 설명이 된다 — 그 경우
//   "{sigungu} 유사 연식"으로 별도 표현한다.
export function regionLabelForPeerLevel(
  peerLevel: PeerLevel | null,
  sigungu: string,
  umdName: string | null,
  isDecadeBandLocal: boolean
): string {
  if (peerLevel === 'LOCAL') {
    if (isDecadeBandLocal) return `${sigungu} 유사 연식`;
    return umdName || sigungu;
  }
  if (peerLevel === 'REGION_WIDE') return '부산 전체';
  return sigungu; // SIGUNGU 또는 peerLevel 없음(NOT_SCORED 등 안전 폴백)
}
