// SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 — 이집점수가 "어느 단지의 점수인가"를
// 정하는 단 하나의 자리.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 점수 라우트는 단지를 (sggCd + 법정동 + 정규화된 이름)으로 해소하고 canonical
// identity인 aptSeq를 **아예 읽지 않았다**. 이름 정규화는 끝의 "아파트"를 지우므로
// `대원아파트` → `대원`이 되는데, MASTER_COVERAGE_SYNC로 부산진구에 `대원`
// (26230-1810, 부전동)이 새로 들어오자 기존 `대원아파트`(26230-149, 범천동)와
// 같은 정규화 이름이 됐다. 법정동을 싣지 않고 들어오는 경로에서는 후보가 둘이 되어
// 멀쩡한 점수가 AMBIGUOUS로 사라졌다.
//
// 틀린 점수를 주지 않은 것은 옳았다. 문제는 **답을 알 수 있는데도 포기했다**는 것이다.
// 호출부가 이미 검증한 aptSeq를 들고 있으면 이름으로 다시 찾을 이유가 없다.
//
// ── 해소 우선순위(§2) ──────────────────────────────────────────────────────
//   1. canonical aptSeq — 있으면 여기서 끝. 이름으로 재해소하지 않는다.
//   2. sggCd(+법정동) 안에서 정규화 이름 완전 일치
//   3. 완전 일치가 하나도 없을 때만 aptNamesMatch의 부분포함 폴백
//   4. 후보가 둘 이상이면 AMBIGUOUS — 절대 첫 번째를 고르지 않는다
//
// 2~4는 기존 라우트 규칙 **그대로**다. 이 STEP이 더한 것은 1번 한 층뿐이고,
// 어느 경로도 넓히지 않았다.
import { aptNamesMatch, normalizeAptName } from '@/lib/apt-name-match';
import type { PrismaClient } from '@prisma/client';

/**
 * MOLIT aptSeq는 `{lawdCd 5자리}-{일련번호}` 형태다. 실측: ApartmentMaster 3,438건과
 * TradeHistory의 distinct aptSeq 4,977건 **전부** 이 형태이며 예외가 없다.
 *
 * 이 가드는 보안 장치가 아니라 **정직성 장치**다. 형태부터 aptSeq가 아닌 값은 DB에
 * 물어볼 것도 없이 "그런 단지 없음"이며, 그걸 이름 경로로 흘려보내 엉뚱한 단지의
 * 점수로 이어지게 두지 않는다.
 */
const APT_SEQ_PATTERN = /^\d{5}-\d+$/;

export function isWellFormedAptSeq(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && APT_SEQ_PATTERN.test(raw.trim());
}

export type ScoreIdentity =
  /** 이 단지로 확정됐다. */
  | { kind: 'RESOLVED'; aptSeq: string; via: 'APT_SEQ' | 'EXACT_NAME' | 'LOOSE_NAME' }
  /** 요청한 identity에 해당하는 단지가 없다. */
  | { kind: 'NOT_FOUND' }
  /** 후보가 둘 이상이라 확정할 수 없다. 추측하지 않는다. */
  | { kind: 'AMBIGUOUS' };

export interface ResolveScoreIdentityInput {
  /** 호출부가 검증을 마친 canonical aptSeq. 확신이 없으면 넘기지 않는다. */
  aptSeqParam?: string | null;
  aptName: string;
  lawdCd: string;
  dong: string;
}

/**
 * 점수를 계산할 단지를 확정한다.
 *
 * aptSeq가 오면 **존재 여부만** 확인하고 그대로 쓴다. 이름이 맞는지 되묻지 않는다 —
 * aptSeq가 canonical identity이고 이름은 그보다 약한 단서이므로, 약한 쪽이 강한 쪽을
 * 뒤집게 두면 애초에 aptSeq를 받는 의미가 없다(§2 "weaker identity overriding aptSeq").
 * 대신 **호출부가 무엇을 보내는지**가 계약의 절반이다: 상세페이지는 URL의 aptSeq를
 * 그대로 보내지 않고, 이 페이지의 거래 목록에서 검증된 canonical aptSeq만 보낸다
 * (deriveCanonicalAptSeq).
 *
 * aptSeq가 왔는데 그런 master가 없으면 **이름 경로로 폴백하지 않는다.** 폴백하면
 * "26230-9999의 점수"를 물었는데 다른 단지의 점수를 받게 된다 — 없는 것은 없다고
 * 말하는 편이 낫다(§9).
 */
export async function resolveScoreIdentity(
  prisma: Pick<PrismaClient, 'apartmentMaster'>,
  input: ResolveScoreIdentityInput
): Promise<ScoreIdentity> {
  const fromParam = (input.aptSeqParam || '').trim();

  if (fromParam) {
    // 형태가 아예 aptSeq가 아니면 DB에 묻지 않는다. 이름 경로로 흘리지도 않는다.
    if (!isWellFormedAptSeq(fromParam)) return { kind: 'NOT_FOUND' };
    const master = await prisma.apartmentMaster.findUnique({
      where: { aptSeq: fromParam },
      select: { aptSeq: true },
    });
    if (!master?.aptSeq) return { kind: 'NOT_FOUND' };
    return { kind: 'RESOLVED', aptSeq: master.aptSeq, via: 'APT_SEQ' };
  }

  // ── 이하 기존 라우트 규칙 그대로(폴백 경로) ────────────────────────────────
  // lawdCd 없이 이름만으로는 절대 해소하지 않는다 — 타 지역 동명 단지를 집어올 수 있다
  // (실측: 대신롯데캐슬 서울/부산 충돌).
  if (!input.lawdCd) return { kind: 'AMBIGUOUS' };

  const candidates = await prisma.apartmentMaster.findMany({
    where: {
      sggCd: input.lawdCd,
      aptSeq: { not: null },
      ...(input.dong ? { umdName: input.dong } : {}),
    },
    select: { aptSeq: true, name: true },
  });

  // 정확히 같은 이름이 하나라도 있으면 그것만 본다. 없을 때만 부분포함으로 내려간다
  // (실측 "구덕" ⊂ "구덕하이츠" — 정확한 이름이 있는데도 AMBIGUOUS로 떨어지던 문제).
  const exact = candidates.filter((c) => normalizeAptName(c.name) === normalizeAptName(input.aptName));
  const via: 'EXACT_NAME' | 'LOOSE_NAME' = exact.length > 0 ? 'EXACT_NAME' : 'LOOSE_NAME';
  const matched = exact.length > 0 ? exact : candidates.filter((c) => aptNamesMatch(c.name, input.aptName));

  if (matched.length === 0) return { kind: 'NOT_FOUND' };
  if (matched.length > 1) return { kind: 'AMBIGUOUS' };
  return { kind: 'RESOLVED', aptSeq: matched[0].aptSeq!, via };
}
