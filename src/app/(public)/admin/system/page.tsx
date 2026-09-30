'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { ChevronDown, Copy, Check } from 'lucide-react';
import Header from '@/components/Header';
import {
  SEVERITY_LABELS,
  KIND_LABELS,
  WINDOW_LABELS,
  type HealthWindow,
  type LogSeverity,
  type LogKind,
  type ParsedLogEntry,
  type RepeatedError,
} from '@/lib/admin/system-health';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const REFRESH_INTERVAL_MS = 60 * 1000;

function formatDateTime(iso: string | null) {
  if (!iso) return '기록 없음';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ADMIN_SYSTEM_HEALTH_V1 — pill 배색은 /admin/ops와 같은 뜻을 갖게 맞춘다.
function SeverityPill({ severity }: { severity: LogSeverity }) {
  const cls =
    severity === 'LOW' ? styles.pillOk
      : severity === 'MEDIUM' ? styles.pillWarn
        : severity === 'HIGH' ? styles.pillHigh
          : styles.pillCritical;
  return <span className={`${styles.pill} ${cls}`}>{SEVERITY_LABELS[severity]}</span>;
}

function ratioText(ratio: number | null): string {
  if (ratio === null) return '비율 확인 불가';
  return `${Math.round(ratio * 100)}%`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 권한이 없을 수 있다 — 실패를 성공처럼 표시하지 않는다.
        }
      }}
      aria-label="원문 복사"
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

function LogRow({ entry }: { entry: ParsedLogEntry }) {
  const [open, setOpen] = React.useState(false);
  const m = entry.molit;

  return (
    <div className={styles.logRow}>
      <button
        type="button"
        className={styles.logHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.logHeadTop}>
          <SeverityPill severity={entry.severity} />
          <span className={styles.logKind}>{KIND_LABELS[entry.kind]}</span>
          <span className={styles.logTime}>{formatTimeOnly(entry.occurredAt)}</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={open ? styles.chevronOpen : styles.chevron}
          />
        </span>
        <span className={styles.logSummary}>{entry.summary}</span>
        {m && m.reason && <span className={styles.logReason}>{m.reason}</span>}
      </button>

      {open && (
        <div className={styles.logDetail}>
          <dl className={styles.detailGrid}>
            {entry.route && (
              <>
                <dt>API route</dt>
                <dd>{entry.route}</dd>
              </>
            )}
            <dt>발생 시각</dt>
            <dd>{formatDateTime(entry.occurredAt)}</dd>
            {m && (
              <>
                {m.type && (<><dt>유형</dt><dd>{m.type}</dd></>)}
                {m.lawdCd && (<><dt>지역 코드</dt><dd>{m.lawdCd}</dd></>)}
                {m.dong && (<><dt>동</dt><dd>{m.dong}</dd></>)}
                {m.period !== null && (<><dt>요청 기간</dt><dd>{m.period}개월</dd></>)}
                {m.monthsRequested !== null && (
                  <><dt>성공 / 실패</dt><dd>{m.monthsSucceeded ?? '?'} / {m.failedCount ?? '?'} (총 {m.monthsRequested}개월)</dd></>
                )}
                <dt>실패 비율</dt>
                <dd>{ratioText(entry.failureRatio)}</dd>
                {m.failedMonths.length > 0 && (
                  <>
                    <dt>실패한 월</dt>
                    <dd className={styles.failedMonths}>
                      {m.failedMonths.join(', ')}
                      {m.failedMonthsTruncated > 0 && (
                        <span className={styles.truncNote}> 외 {m.failedMonthsTruncated}개월 (원문에서 잘림)</span>
                      )}
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>
          <div className={styles.rawBlock}>
            <div className={styles.rawHead}>
              <span>원문</span>
              <CopyButton text={entry.rawMessage} />
            </div>
            <pre className={styles.rawText}>{entry.rawMessage}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSystemHealthPage() {
  const { data: session, status } = useSession();
  // /admin/ops와 동일 — 서버가 세션에 실어준 isAdmin을 쓰고, 실제 권한은 API가 다시 검증한다.
  const isAdmin = session?.user?.isAdmin === true;

  // 전역 `window`를 가리지 않도록 이름을 분리한다 — 이 컴포넌트 안에서 브라우저
  // window가 필요해질 때 조용히 문자열을 집는 사고를 막는다.
  const [timeWindow, setTimeWindow] = React.useState<HealthWindow>('24h');
  const [kindFilter, setKindFilter] = React.useState<LogKind | 'ALL'>('ALL');
  const [highOnly, setHighOnly] = React.useState(false);

  const { data, isLoading, error: swrError } = useSWR(
    isAdmin ? `/api/admin/system-health?window=${timeWindow}` : null,
    fetcher,
    { refreshInterval: REFRESH_INTERVAL_MS, revalidateOnFocus: false }
  );

  const d = data?.success ? data.data : null;
  const fetchError = data && !data.success
    ? data.error
    : swrError ? '운영 상태를 불러오지 못했습니다.' : null;

  // 필터는 이미 받아온 목록 안에서만 건다 — 필터를 바꿀 때마다 서버를 다시 때리지 않는다.
  const visible: ParsedLogEntry[] = React.useMemo(() => {
    if (!d) return [];
    return (d.entries as ParsedLogEntry[]).filter((e) => {
      if (kindFilter !== 'ALL' && e.kind !== kindFilter) return false;
      if (highOnly && e.severity !== 'HIGH' && e.severity !== 'CRITICAL') return false;
      return true;
    });
  }, [d, kindFilter, highOnly]);

  return (
    <div className={styles.main}>
      <Header pageTitle="시스템 상태" />
      <div className="container">
        {status === 'loading' ? (
          <div className={styles.emptyState}>불러오는 중입니다...</div>
        ) : !isAdmin ? (
          <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
        ) : isLoading ? (
          <div className={styles.emptyState}>불러오는 중입니다...</div>
        ) : fetchError ? (
          // §13 — 조회 실패를 "오류 없음"으로 표시하지 않는다.
          <div className={styles.errorState} role="alert">{fetchError}</div>
        ) : d ? (
          <>
            <div className={styles.windowTabs} role="tablist" aria-label="조회 기간">
              {(['1h', '24h', '7d'] as HealthWindow[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={timeWindow === w}
                  className={timeWindow === w ? styles.windowTabActive : styles.windowTab}
                  onClick={() => setTimeWindow(w)}
                >
                  {WINDOW_LABELS[w]}
                </button>
              ))}
            </div>

            <div className={styles.cardRow}>
              <div className={styles.card}>
                <div className={styles.cardLabel}>{WINDOW_LABELS[d.window as HealthWindow]} 오류</div>
                <div className={styles.cardValue}>{d.cards.totalInWindow}건</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>MOLIT 부분 실패</div>
                <div className={styles.cardValue}>{d.cards.molitPartial}건</div>
              </div>
              <div className={`${styles.card} ${d.cards.highRisk > 0 ? styles.cardAlert : ''}`}>
                <div className={styles.cardLabel}>고위험 오류</div>
                <div className={styles.cardValue}>{d.cards.highRisk}건</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardLabel}>최근 오류</div>
                <div className={styles.cardValueSm}>{formatDateTime(d.cards.latestAt)}</div>
              </div>
            </div>

            {/* §8 — 데이터 불완전 경고. 관리자 화면 전용 문구다. */}
            {d.incompleteness.anyFailure && (
              <div
                className={d.incompleteness.likelyIncomplete ? styles.warnBannerHigh : styles.warnBanner}
                role="status"
              >
                {d.incompleteness.likelyIncomplete
                  ? `데이터 불완전 가능성 높음 — 최대 실패 비율 ${ratioText(d.incompleteness.worstRatio)}. 해당 지역·기간의 집계가 실제보다 적게 보일 수 있습니다.`
                  : `부분 데이터 가능성 — 일부 월 조회가 실패했습니다(최대 ${ratioText(d.incompleteness.worstRatio)}).`}
              </div>
            )}

            {d.truncated && (
              <div className={styles.noteBanner}>
                이 기간의 로그가 {d.maxRows}건을 넘어 최근 {d.maxRows}건만 표시합니다.
              </div>
            )}

            {/* §7 — 반복 오류 요약. 같은 사실이 20줄로 흩어지지 않게 접는다. */}
            {d.repeated.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>반복된 오류</h2>
                <p className={styles.sectionNote}>
                  같은 유형·지역·원인을 묶은 것입니다. 건수는 <strong>기록된 횟수</strong>이며,
                  같은 (유형, 지역) 부분 실패는 5분에 한 번만 기록되므로 실제 발생 횟수는 더 많을 수 있습니다.
                </p>
                {(d.repeated as RepeatedError[]).map((r) => (
                  <div key={r.signature} className={styles.repeatRow}>
                    <SeverityPill severity={r.worstSeverity} />
                    <span className={styles.repeatSummary}>{r.sampleSummary}</span>
                    <span className={styles.repeatMeta}>
                      {r.loggedCount}회 기록
                      {r.worstFailureRatio !== null && ` · 최악 ${ratioText(r.worstFailureRatio)}`}
                      {` · 최근 ${formatTimeOnly(r.latestAt)}`}
                    </span>
                  </div>
                ))}
              </section>
            )}

            <section className={styles.section}>
              <div className={styles.filterBar}>
                <h2 className={styles.sectionTitle}>최근 오류</h2>
                <div className={styles.filters}>
                  <select
                    className={styles.select}
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value as LogKind | 'ALL')}
                    aria-label="오류 유형 필터"
                  >
                    <option value="ALL">전체 유형</option>
                    <option value="MOLIT">{KIND_LABELS.MOLIT}</option>
                    <option value="SERVER">{KIND_LABELS.SERVER}</option>
                    <option value="CLIENT">{KIND_LABELS.CLIENT}</option>
                  </select>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={highOnly}
                      onChange={(e) => setHighOnly(e.target.checked)}
                    />
                    고위험만
                  </label>
                </div>
              </div>

              {visible.length === 0 ? (
                <div className={styles.emptyRow}>
                  {d.cards.totalInWindow === 0
                    ? `${WINDOW_LABELS[d.window as HealthWindow]} 기록된 오류가 없습니다.`
                    : '이 필터에 해당하는 오류가 없습니다.'}
                </div>
              ) : (
                visible.map((e) => <LogRow key={e.id} entry={e} />)
              )}
            </section>

            {/* 이 source가 무엇을 담지 않는지 밝힌다 — "0건"을 "멀쩡하다"로 읽지 않게. */}
            <p className={styles.sourceNote}>
              이 화면은 <code>error_logs</code> 테이블에 기록된 것만 보여줍니다.
              OAuth 콜백 실패와 cron/동기화 실패는 현재 서버 콘솔에만 남고 이 테이블에
              저장되지 않으므로, 여기 보이지 않는다고 해서 발생하지 않은 것은 아닙니다.
            </p>
            <div className={styles.refreshHint}>
              {formatDateTime(d.generatedAt)} 기준 · 60초마다 자동 갱신됩니다.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
