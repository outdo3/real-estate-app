// COMPARE_SHARE_URL_COMPACT_FIX_V1 — 비교 화면의 URL 계약.
//
// ── 예전 계약과 왜 바꿨는가 ────────────────────────────────────────────────
// COMPARE_V2_PHASE2는 aptSeq를 실으면서도 **이름·법정동·구코드를 동반 파라미터로
// 함께** 실었다. 이유는 명확했다: 복원할 때 부르는 API가 전부 이름 기반이라
// aptSeq만으로는 단지를 되살릴 수 없었고, aptSeq 조회 경로를 만드는 것은 그 단계의
// 범위 밖이었다.
//
// 그 대가는 공유 링크에서 드러났다. 한글은 퍼센트 인코딩되므로 URL이 300자를 넘고,
// 카카오톡에서는 OG 카드 위에 %EB%... 덩어리가 그대로 말풍선으로 보인다.
// 실측(부산 실제 단지):
//     진흥목화 vs 송암파크빌                292자
//     해운대경동제이드 vs 대원아파트         303자
//     해운대역푸르지오더원 vs 해운대경동제이드 340자
//
// 이제 서버가 aptSeq로 단지를 복원하므로(app/stats/compare/page.tsx) 동반
// 파라미터가 필요 없다. canonical identity 둘이면 충분하다.
//
//     /stats/compare?a=26350-2611&b=26350-2206      (81자 → 76% 감소)
//
// ── 남아 있는 legacy 형태 ─────────────────────────────────────────────────
// 이미 공유된 긴 링크가 세상에 있으므로 parse는 계속 받는다(§5). 다만 **새로 만들지는
// 않는다** — 열리는 순간 내부 상태는 canonical로 정규화되고, 이후 공유는 짧은 형태가
// 나간다.
//
// 예외는 하나다: 검색 결과에 aptSeq가 없어 canonical identity를 얻지 못한 슬롯.
// 그 슬롯만 동반 파라미터를 유지한다 — 링크를 짧게 만들자고 복원 불가능한 링크를
// 만들 수는 없다.
export interface CompareSlotSeed {
  name: string;
  lawdCd: string;
  dong: string;
  aptSeq?: string;
}

export const COMPARE_PATH = '/stats/compare';

/**
 * 공유용 canonical URL. **canonical aptSeq 둘만** 들어간다.
 *
 * 이름·법정동·구코드·가격·사용자 입력은 넣지 않는다(§2/§11). 둘 중 하나라도 없으면
 * null — 짧지만 열리지 않는 링크를 만드느니 만들지 않는다.
 */
export function buildCompareSharePath(aptSeqA?: string | null, aptSeqB?: string | null): string | null {
  if (!aptSeqA || !aptSeqB) return null;
  return `${COMPARE_PATH}?a=${encodeURIComponent(aptSeqA)}&b=${encodeURIComponent(aptSeqB)}`;
}

/**
 * 브라우저 주소창에 반영할 URL(router.replace용).
 *
 * aptSeq를 아는 슬롯은 `a`/`b` 하나로 끝내고, 모르는 슬롯만 동반 파라미터를 남긴다.
 */
export function buildCompareUrl(a: CompareSlotSeed, b?: CompareSlotSeed): string {
  const qs = new URLSearchParams();

  const appendSlot = (slot: CompareSlotSeed | undefined, key: 'a' | 'b') => {
    if (!slot) return;
    if (slot.aptSeq) {
      qs.set(key, slot.aptSeq);
      return;
    }
    // canonical identity가 없는 슬롯만 예전 형태를 유지한다(복원 가능성 우선).
    if (!slot.name) return;
    const prefix = key === 'a' ? 'a' : 'b';
    qs.set(`${prefix}Name`, slot.name);
    qs.set(`${prefix}LawdCd`, slot.lawdCd);
    qs.set(`${prefix}Dong`, slot.dong);
  };

  appendSlot(a, 'a');
  appendSlot(b, 'b');
  return `${COMPARE_PATH}?${qs.toString()}`;
}

/** `a`/`b`로 들어온 canonical aptSeq. 서버가 이 값으로 단지를 복원한다. */
export function parseCompareAptSeqs(searchParams: URLSearchParams | { a?: string; b?: string }): {
  a: string | null;
  b: string | null;
} {
  const read = (key: 'a' | 'b') =>
    searchParams instanceof URLSearchParams ? searchParams.get(key) : searchParams[key];
  const clean = (v: string | null | undefined) => {
    const s = (v || '').trim();
    return s || null;
  };
  return { a: clean(read('a')), b: clean(read('b')) };
}

/**
 * legacy 긴 URL의 동반 파라미터를 읽는다(§5 호환).
 *
 * 예전 형태는 `aptSeq=A,B` + `aName/aLawdCd/aDong` + `bName/...`이었다.
 * 새 형태에서 aptSeq는 `a`/`b`로 오고 서버가 복원하므로, 여기서는 **이름이 실려 있는
 * 슬롯만** 만들어 준다 — 그게 legacy 링크의 식별 방식이다.
 */
export function parseCompareUrl(searchParams: URLSearchParams): { a?: CompareSlotSeed; b?: CompareSlotSeed } {
  const legacySeqs = (searchParams.get('aptSeq') || '').split(',').filter(Boolean);
  const aName = searchParams.get('aName');
  const bName = searchParams.get('bName');

  const a: CompareSlotSeed | undefined = aName
    ? {
        name: aName,
        lawdCd: searchParams.get('aLawdCd') || '',
        dong: searchParams.get('aDong') || '',
        aptSeq: legacySeqs[0] || undefined,
      }
    : undefined;

  const b: CompareSlotSeed | undefined = bName
    ? {
        name: bName,
        lawdCd: searchParams.get('bLawdCd') || '',
        dong: searchParams.get('bDong') || '',
        aptSeq: legacySeqs[1] || undefined,
      }
    : undefined;

  return { a, b };
}
