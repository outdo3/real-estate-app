'use client';

// REALTOR_PRO_MVP_V1 — 고객 조건 ↔ 매물 매칭 결과 표시. 점수는 "이 고객 조건과 매물의 일치도"이며 단지 평가 점수(E-JIP Score)가 아니다.
// 비교할 수 없는 항목은 "확인 필요"로 그대로 보여주고, % 계산이 불가능하면 "정보 부족"으로 표시한다.

import Link from 'next/link';
import { useState } from 'react';
import { Check, CircleHelp, FileText, Star, TriangleAlert, X } from 'lucide-react';
import type { CustomerMatchView } from '@/lib/pro/match-service';
import type { MatchReason, ReasonVerdict } from '@/lib/pro/types';
import { proFetch, type ApiFailure, type Wire } from './api';
import { formatDealPrice, formatM2 } from './format';
import { InlineFailure } from './ProStateGate';
import s from './pro.module.css';

export const MATCH_SCORE_NOTE = '매칭 %는 이 고객 조건과 매물의 일치도이며 단지 평가 점수가 아닙니다.';

const VERDICT_LABEL: Record<ReasonVerdict, string> = { MATCH: '맞음', PARTIAL: '일부 맞음', MISS: '맞지 않음', UNKNOWN: '확인 필요' };

export function VerdictIcon({ v }: { v: ReasonVerdict }) {
  if (v === 'MATCH') return <Check size={16} color="var(--primary-color)" aria-hidden="true" />;
  if (v === 'PARTIAL') return <TriangleAlert size={16} color="var(--warning-color)" aria-hidden="true" />;
  if (v === 'MISS') return <X size={16} color="var(--error-color)" aria-hidden="true" />;
  return <CircleHelp size={16} color="var(--text-secondary)" aria-hidden="true" />;
}

export function ReasonList({ reasons }: { reasons: Wire<MatchReason>[] }) {
  if (!reasons.length) return null;
  return (
    <ul className={s.list} style={{ gap: 6, marginTop: 10 }}>
      {reasons.map((r, i) => (
        <li key={`${r.key}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--font-size-body-sm)' }}>
          <span style={{ flexShrink: 0, marginTop: 2 }}>
            <VerdictIcon v={r.verdict} />
          </span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <strong>{r.label}</strong>
            <span className={s.srOnly}> {VERDICT_LABEL[r.verdict]}</span>
            {r.detail ? <span className={s.muted}> · {r.detail}</span> : null}
            {r.verdict === 'UNKNOWN' ? <span className={s.muted}> (확인 필요)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreBadge({ score, confidence, passedHard }: { score: number | null; confidence: string; passedHard: boolean }) {
  if (!passedHard) return <span className={`${s.badge} ${s.badgeError}`}>조건 밖</span>;
  if (score == null || confidence === 'INSUFFICIENT') return <span className={s.badge}>정보 부족</span>;
  return <span className={`${s.badge} ${s.badgeBrand}`} style={{ fontSize: 'var(--font-size-body-sm)' }}>일치도 {Math.round(score)}%</span>;
}

type ResultW = Wire<CustomerMatchView>['results'][number];

function ResultCard({ r, customerId, readOnly }: { r: ResultW; customerId: string; readOnly: boolean }) {
  const [state, setState] = useState(r.state);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const shortlist = async () => {
    if (!r.matchId) return;
    setBusy(true);
    const next = state === 'SHORTLISTED' ? 'SEEN' : 'SHORTLISTED';
    const res = await proFetch(`/api/pro/matches/${encodeURIComponent(r.matchId)}`, { method: 'PATCH', body: { state: next } });
    setBusy(false);
    if (res.ok) {
      setState(next);
      setFailure(null);
    } else setFailure(res);
  };

  return (
    <li className={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <Link href={`/pro/listings/${encodeURIComponent(r.listing.id)}`} className={s.rowTitle} style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 600 }}>
          {r.listing.aptNameSnapshot}
        </Link>
        <ScoreBadge score={r.score} confidence={r.confidence} passedHard={r.passedHard} />
      </div>
      <p className={s.meta}>
        <span>{formatDealPrice(r.listing)}</span>
        {r.listing.exclusiveAreaM2 != null ? <span>전용 {formatM2(r.listing.exclusiveAreaM2)}</span> : null}
      </p>
      <ReasonList reasons={r.reasons} />
      {r.exclusions.length ? (
        <details style={{ marginTop: 8 }}>
          <summary className={s.muted} style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
            조건 밖 사유 {r.exclusions.length}건
          </summary>
          <ReasonList reasons={r.exclusions} />
        </details>
      ) : null}
      <div className={s.btnRow} style={{ marginTop: 10 }}>
        <Link href={`/pro/briefings/new?listingId=${encodeURIComponent(r.listing.id)}&customerId=${encodeURIComponent(customerId)}`} className={s.btn}>
          <FileText size={16} aria-hidden="true" />
          브리핑 만들기
        </Link>
        {r.matchId && !readOnly ? (
          <button type="button" className={state === 'SHORTLISTED' ? s.btnPrimary : s.btn} onClick={shortlist} disabled={busy} aria-pressed={state === 'SHORTLISTED'}>
            <Star size={16} aria-hidden="true" />
            {state === 'SHORTLISTED' ? '관심 등록됨' : '관심'}
          </button>
        ) : null}
      </div>
      <InlineFailure failure={failure} />
    </li>
  );
}

export default function MatchResults({ views, customerId, readOnly }: { views: Wire<CustomerMatchView>[]; customerId: string; readOnly: boolean }) {
  if (!views.length) return <p className={s.empty}>조건 세트가 없습니다. 조건을 추가하면 맞는 매물을 계산할 수 있습니다.</p>;
  return (
    <div className={s.page}>
      <p className={s.help}>{MATCH_SCORE_NOTE}</p>
      {views.map((v) => {
        const passed = v.results.filter((r) => r.passedHard);
        const outside = v.results.filter((r) => !r.passedHard);
        return (
          <section key={v.preferenceId}>
            <h3 className={s.sectionTitle}>
              {v.preferenceLabel}
              <span className={s.sectionCount}>조건 안 {v.totalCandidates}건</span>
            </h3>
            {v.truncatedTo != null && v.totalCandidates > v.truncatedTo ? (
              <p className={s.help}>Free 플랜은 상위 {v.truncatedTo}건만 보여줍니다.</p>
            ) : null}
            {passed.length === 0 ? <p className={s.empty}>조건에 맞는 활성 매물이 없습니다.</p> : null}
            <ul className={s.list}>
              {passed.map((r) => (
                <ResultCard key={r.listingId} r={r} customerId={customerId} readOnly={readOnly} />
              ))}
            </ul>
            {outside.length ? (
              <details style={{ marginTop: 10 }}>
                <summary className={s.muted} style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
                  조건 밖 매물 {outside.length}건
                </summary>
                <ul className={s.list}>
                  {outside.map((r) => (
                    <ResultCard key={r.listingId} r={r} customerId={customerId} readOnly={readOnly} />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
