// REPORT TEMPLATE REDESIGN V1 — 리포트 공통 표현 부품.
//
// **envelope만 읽는다.** 여기에는 DB 접근도, 수치 재계산도, trust 재해석도 없다.
// 값과 신뢰 상태는 이미 envelope이 정해둔 것을 그대로 그린다.

import styles from './ReportSheet.module.css';
import type { MetricTrust, ReportEnvelope, ReportMetric } from '@/lib/report/types';

/** SAFE는 칩을 붙이지 않는다(모든 줄에 배지가 붙으면 의미가 사라진다).
 *  MISSING도 붙이지 않는다 — 값 자체가 이미 '정보 없음'이라 중복이다. */
export function TrustChip({ trust }: { trust: MetricTrust }) {
  if (trust === 'SAFE' || trust === 'MISSING') return null;
  if (trust === 'LIMITED') return <span className={`${styles.trustChip} ${styles.trustLimited}`}>참고</span>;
  return <span className={`${styles.trustChip} ${styles.trustMissing}`}>미검증</span>;
}

const COMPLETENESS: Record<string, { text: string; foot: string }> = {
  COMPLETE: { text: '검증 완료', foot: 'fComplete' },
  PARTIAL: { text: '일부 제한', foot: 'fPartial' },
  UNVERIFIED: { text: '검증 중', foot: 'fUnverified' },
};

export function completenessLabel(c: string) {
  return COMPLETENESS[c] ?? COMPLETENESS.UNVERIFIED;
}

export function ReportHeader({
  title,
  subtitle,
  tags,
  completeness,
  stamp,
}: {
  title: string;
  subtitle?: string | null;
  tags?: (string | null)[];
  completeness: string;
  stamp?: string | null;
}) {
  const c = completenessLabel(completeness);
  const shown = (tags ?? []).filter((t): t is string => !!t);
  return (
    <header className={styles.header}>
      <div className={styles.headMain}>
        <div className={styles.brand}>이집 E-JIP</div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {shown.length > 0 && (
          <div className={styles.tagRow}>
            {shown.map((t) => (
              <span key={t} className={styles.tag}>{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.headSide}>
        <span className={`${styles.completeness} ${styles[c.foot === 'fComplete' ? 'cComplete' : c.foot === 'fPartial' ? 'cPartial' : 'cUnverified']}`}>
          {c.text}
        </span>
        {stamp && <span className={styles.headStamp}>{stamp}</span>}
      </div>
    </header>
  );
}

export function SectionHead({ title, meta }: { title: string; meta?: string | null }) {
  return (
    <div className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {meta && <span className={styles.sectionMeta}>{meta}</span>}
    </div>
  );
}

/** KPI 카드. MISSING이면 값이 흐리게, 라벨 옆에 신뢰 칩. */
export function KpiCard({ metric, accent, hint }: { metric: ReportMetric; accent?: boolean; hint?: string | null }) {
  const missing = metric.trust === 'MISSING';
  return (
    <div className={`${styles.kpi} ${accent && !missing ? styles.kpiAccent : ''}`}>
      <div className={styles.kpiLabel}>
        {metric.label}
        <TrustChip trust={metric.trust} />
      </div>
      <div
        className={`${styles.kpiValue} ${missing ? styles.kpiValueMissing : ''} ${
          metric.displayValue.length > 12 ? styles.kpiValueLong : ''
        }`}
      >
        {metric.displayValue}
      </div>
      {hint && <div className={styles.kpiHint}>{hint}</div>}
    </div>
  );
}

/** 라벨:값 목록. 값이 없으면 흐리게 — 0으로 채우지 않는다. */
export function DefinitionList({
  rows,
}: {
  rows: { key: string; label: string; value: string; trust?: MetricTrust }[];
}) {
  return (
    <div className={styles.dl}>
      {rows.map((r) => {
        const missing = r.trust === 'MISSING' || /정보 없음|준비 중|확인 중/.test(r.value);
        return (
          <div key={r.key} className={styles.dlRow}>
            <span className={styles.dlKey}>{r.label}</span>
            <span className={`${styles.dlVal} ${missing ? styles.dlValMissing : ''}`}>
              {r.value}
              {r.trust && <TrustChip trust={r.trust} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 점수 다이얼. score가 null이면 그리지 않는다 — 0점으로 보이면 안 된다.
 * conic-gradient 각도는 인라인으로 넣는다(캡처가 computed background-image를 복사한다).
 */
export function ScoreDial({ score, state, desc }: { score: number | null; state: string; desc?: string | null }) {
  if (score == null) {
    return (
      <div className={styles.scoreWrap}>
        <div className={styles.scoreDial} data-export-fixed-size="">
          <div className={styles.scoreDialInner} data-export-fixed-size="">
            <span className={styles.scoreOf}>준비 중</span>
          </div>
        </div>
        <div className={styles.scoreSide}>
          <div className={styles.scoreState}>{state}</div>
          {desc && <p className={styles.scoreDesc}>{desc}</p>}
        </div>
      </div>
    );
  }
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  return (
    <div className={styles.scoreWrap}>
      <div
        className={styles.scoreDial}
        data-export-fixed-size=""
        style={{ backgroundImage: `conic-gradient(#0f9d63 0deg ${deg}deg, #eef2f6 ${deg}deg 360deg)` }}
      >
        <div className={styles.scoreDialInner} data-export-fixed-size="">
          <span className={styles.scoreNum}>{score}</span>
          <span className={styles.scoreOf}>/ 100</span>
        </div>
      </div>
      <div className={styles.scoreSide}>
        <div className={styles.scoreState}>{state}</div>
        {desc && <p className={styles.scoreDesc}>{desc}</p>}
      </div>
    </div>
  );
}

/** 신뢰/출처 푸터 — 파일로 나가도 caveat이 함께 가야 한다. */
export function TrustFooter({
  envelope,
  sourceNote,
  extra,
}: {
  envelope: ReportEnvelope<unknown>;
  sourceNote: string;
  extra?: (string | null)[];
}) {
  const c = completenessLabel(envelope.trust.completeness);
  const dataAsOf = envelope.dataAsOf ? envelope.dataAsOf.slice(0, 10).replace(/-/g, '.') : '확인 중';
  const bits = (extra ?? []).filter((b): b is string => !!b);
  return (
    <footer className={styles.footer}>
      <div className={styles.footerRow}>
        <span className={`${styles.footerChip} ${styles[c.foot]}`}>{c.text}</span>
        <span>데이터 기준 {dataAsOf}</span>
        {bits.map((b) => (
          <span key={b}>{b}</span>
        ))}
      </div>
      {envelope.trust.notes.length > 0 && (
        <ul className={styles.footerNotes}>
          {envelope.trust.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className={styles.sourceNote}>{sourceNote}</p>
      <div className={styles.signature}>
        <span className={styles.signBrand}>이집 E-JIP</span>
        <span>데이터로 확인하는 우리 동네 부동산</span>
      </div>
    </footer>
  );
}
