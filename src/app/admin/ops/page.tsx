'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Header from '@/components/Header';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const REFRESH_INTERVAL_MS = 60 * 1000;

function formatDateTime(iso: string | null) {
  if (!iso) return '기록 없음';
  try {
    return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function StatusPill({ label }: { label: string }) {
  const cls =
    label === '정상' || label === 'SAFE'
      ? styles.pillOk
      : label === '확인 필요' || label === '확인 불가'
        ? styles.pillWarn
        : label === '문제'
          ? styles.pillCritical
          : styles.pillNeutral;
  return <span className={`${styles.pill} ${cls}`}>{label}</span>;
}

export default function AdminOpsPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  const { data, isLoading, error: swrError } = useSWR(
    isAdmin ? '/api/admin/ops' : null,
    fetcher,
    { refreshInterval: REFRESH_INTERVAL_MS, revalidateOnFocus: false }
  );

  const d = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : swrError ? '운영 데이터를 불러오지 못했습니다.' : null;

  return (
    <div className={styles.main}>
      <Header pageTitle="데이터 운영 센터" />
      <div className="container">
        {status === 'loading' ? (
          <div className={styles.emptyState}>불러오는 중입니다...</div>
        ) : !isAdmin ? (
          <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
        ) : isLoading ? (
          <div className={styles.emptyState}>불러오는 중입니다...</div>
        ) : fetchError ? (
          <div className={styles.emptyState}>{fetchError}</div>
        ) : d ? (
          <>
            {/* 최상단 — §33/§48: 30초 안에 판단 가능해야 하는 핵심 질문 */}
            <div className={`${styles.overallBanner} ${d.overall.status === '정상' ? styles.overallOk : styles.overallWarn}`}>
              <div className={styles.overallStatus}>
                <span className={styles.overallLabel}>전체 상태</span>
                <StatusPill label={d.overall.status} />
              </div>
              <div className={styles.overallMeta}>
                마지막 확인 {formatDateTime(d.overall.lastCheckedAt)} · 경고 {d.overall.warningsCount}건
              </div>
            </div>

            {/* 경고 영역 — 있을 때만, 최상단 가까이 */}
            {d.warnings.length > 0 && (
              <div className={styles.warningBox}>
                <div className={styles.warningTitle}>확인이 필요한 항목</div>
                <ul className={styles.warningList}>
                  {d.warnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 핵심 status 4~5개 — §34 카드 남발 금지, 요약만 */}
            <div className={styles.statusGrid}>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>실거래 DB(부산)</div>
                <StatusPill label={d.tradeHistory.aptSeqMissing === 0 ? '정상' : '확인 필요'} />
              </div>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>지역 coverage</div>
                <StatusPill label={d.coverage.busan.covered === d.coverage.busan.total ? '정상' : '확인 필요'} />
              </div>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>24개월 취소검증</div>
                <StatusPill label={d.cancellation.window24m.verdict} />
              </div>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>전국 sync engine</div>
                <StatusPill label={d.incrementalSync.failed === 0 && d.incrementalSync.invalid === 0 ? '정상' : '확인 필요'} />
              </div>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>자동 수집</div>
                <StatusPill label="OFF" />
              </div>
            </div>

            {/* 섹션 B — TradeHistory */}
            <section className={styles.section}>
              <div className={styles.sectionTitle}>실거래 DB(TradeHistory) — 부산 스코프</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>전체 row</span><b>{d.tradeHistory.busanTotal.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>유효(active)</span><b>{d.tradeHistory.busanActive.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>취소</span><b>{d.tradeHistory.busanCanceled.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>최근 거래일</span><b>{d.tradeHistory.latestDealDate || '확인 불가'}</b></div>
                <div className={styles.kv}><span>aptSeq 없는 row</span><b>{d.tradeHistory.aptSeqMissing}</b></div>
                <div className={styles.kv}>
                  <span>자연키 중복</span>
                  <b>{d.tradeHistory.naturalKeyDuplicates.value}<span className={styles.kvNote}> (DB 스키마 제약으로 구조적 보장)</span></b>
                </div>
                <div className={styles.kv}><span>검토 필요(REVIEW_REQUIRED)</span><b>{d.tradeHistory.reviewRequired}</b></div>
              </div>
            </section>

            {/* 섹션 C — Coverage */}
            <section className={styles.section}>
              <div className={styles.sectionTitle}>지역 Coverage</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>부산 구·군</span><b>{d.coverage.busan.covered} / {d.coverage.busan.total}</b></div>
                <div className={styles.kv}><span>전국 시·도</span><b>{d.coverage.nationwide.sido} / 17</b></div>
                <div className={styles.kv}><span>전국 sync-target</span><b>{d.coverage.nationwide.syncTargets.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>세종 — region model</span><b>{d.coverage.sejong.regionModel}</b></div>
                <div className={styles.kv}><span>세종 — 실거래 DB 적재</span><b>{d.coverage.sejong.tradeDbCoverage}</b></div>
              </div>
              <div className={styles.note}>{d.coverage.nationwideDbCoverageNote}</div>
            </section>

            {/* 섹션 D — Incremental Sync */}
            <section className={styles.section}>
              <div className={styles.sectionTitle}>전국 Incremental Sync</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>마지막 sync</span><b>{formatDateTime(d.incrementalSync.lastSyncAt)}</b></div>
                <div className={styles.kv}><span>처리된 cell</span><b>{d.incrementalSync.cells}</b></div>
                <div className={styles.kv}><span>COMPLETE</span><b>{d.incrementalSync.complete}</b></div>
                <div className={styles.kv}><span>EMPTY_VALID</span><b>{d.incrementalSync.emptyValid}</b></div>
                <div className={styles.kv}><span>FAILED</span><b className={d.incrementalSync.failed > 0 ? styles.badValue : ''}>{d.incrementalSync.failed}</b></div>
                <div className={styles.kv}><span>INVALID</span><b className={d.incrementalSync.invalid > 0 ? styles.badValue : ''}>{d.incrementalSync.invalid}</b></div>
                <div className={styles.kv}><span>누적 신규 row</span><b>{d.incrementalSync.rowsInserted}</b></div>
                <div className={styles.kv}><span>누적 취소 반영</span><b>{d.incrementalSync.cancellationsUpdated}</b></div>
              </div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>자동 수집(scheduler)</span><b>OFF</b></div>
                <div className={styles.kv}><span>다음 예정 수집</span><b>자동 일정 없음</b></div>
              </div>
            </section>

            {/* 섹션 E — Cancellation */}
            <section className={styles.section}>
              <div className={styles.sectionTitle}>취소거래 검증 범위</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>최근 {d.cancellation.coverageLabel}({d.cancellation.lookbackMonths}개월) 취소검증</span>
                  <b><StatusPill label={d.cancellation.window24m.verdict} /></b>
                </div>
                <div className={styles.kv}><span>전체 역사(2006년~) 취소검증</span><b><StatusPill label={d.cancellation.allTime.verdict === 'NOT_VERIFIED' ? '미검증' : d.cancellation.allTime.verdict} /></b></div>
              </div>
              <div className={styles.note}>
                {d.cancellation.window24m.source} · older window manifest FAILED={d.cancellation.window24m.olderWindowFailed}/INVALID={d.cancellation.window24m.olderWindowInvalid}
              </div>
              <div className={styles.note}>{d.cancellation.allTime.note}</div>
            </section>

            {/* 섹션 F — Feature Health */}
            <section className={styles.section}>
              <div className={styles.sectionTitle}>DB-FIRST 기능 상태(부산)</div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>기능</th>
                      <th>데이터 소스</th>
                      <th>부산</th>
                      <th>신뢰 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.features.map((f: any) => (
                      <tr key={f.name}>
                        <td>{f.name}</td>
                        <td>{f.source}</td>
                        <td>{f.busan}</td>
                        <td><StatusPill label={f.trust === '정상' ? '정상' : f.trust} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
