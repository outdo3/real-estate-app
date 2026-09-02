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

function formatMonth(ym: string | null) {
  if (!ym || ym.length !== 6) return ym || '기록 없음';
  return `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
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

// ADMIN_OPS_V1.1 §1/§20 — 모든 핵심 값에 근거 종류(LIVE/SNAPSHOT/CONFIG/UNKNOWN)를
// 붙인다. 영문 badge 남발 대신 한국어 우선(§20).
const EVIDENCE_LABELS: Record<string, string> = {
  LIVE: '실시간',
  SNAPSHOT: '검증 시점 기준',
  CONFIG: '설정',
  UNKNOWN: '확인 불가',
};

function EvidenceBadge({ type }: { type: string }) {
  const cls = type === 'LIVE' ? styles.evidenceLive : type === 'SNAPSHOT' ? styles.evidenceSnapshot : type === 'UNKNOWN' ? styles.evidenceUnknown : styles.evidenceConfig;
  return <span className={`${styles.evidenceBadge} ${cls}`}>{EVIDENCE_LABELS[type] || type}</span>;
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
            {/* 최상단 — §18/§19: 확신을 과장하지 않는 subtitle을 항상 붙인다 */}
            <div className={`${styles.overallBanner} ${d.overall.statusCode === 'HEALTHY' ? styles.overallOk : d.overall.statusCode === 'CRITICAL' ? styles.overallCritical : styles.overallWarn}`}>
              <div className={styles.overallStatus}>
                <span className={styles.overallLabel}>전체 상태</span>
                <StatusPill label={d.overall.status} />
              </div>
              <div className={styles.overallSubtitle}>{d.overall.subtitle}</div>
              <div className={styles.overallMeta}>
                마지막 확인 {formatDateTime(d.overall.lastCheckedAt)} · 경고 {d.overall.warningsCount}건
              </div>
            </div>

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
                <div className={styles.statusTileLabel}>최근 QA sync</div>
                <StatusPill label={d.incrementalSync.failed === 0 && d.incrementalSync.invalid === 0 ? '정상' : '확인 필요'} />
              </div>
              <div className={styles.statusTile}>
                <div className={styles.statusTileLabel}>자동 수집</div>
                <StatusPill label="OFF" />
              </div>
            </div>

            {/* 섹션 B — TradeHistory */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>실거래 DB(TradeHistory) — 부산 스코프</div>
                <EvidenceBadge type={d.tradeHistory.evidenceType} />
              </div>
              <div className={styles.sectionMeta}>확인 시각 {formatDateTime(d.tradeHistory.checkedAt)}</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>전체 row</span><b>{d.tradeHistory.busanTotal.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>유효(active)</span><b>{d.tradeHistory.busanActive.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>취소</span><b>{d.tradeHistory.busanCanceled.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>최근 거래일</span><b>{d.tradeHistory.latestDealDate || '확인 불가'}</b></div>
                <div className={styles.kv}><span>aptSeq 없는 row</span><b>{d.tradeHistory.aptSeqMissing}</b></div>
                <div className={styles.kv}>
                  <span>자연키 중복 <EvidenceBadge type={d.tradeHistory.naturalKeyDuplicates.evidenceType} /></span>
                  <b>{d.tradeHistory.naturalKeyDuplicates.value}</b>
                  <span className={styles.kvNote}>{d.tradeHistory.naturalKeyDuplicates.note}</span>
                </div>
                <div className={styles.kv}>
                  <span>검토 필요(REVIEW_REQUIRED) <EvidenceBadge type={d.tradeHistory.reviewRequired.evidenceType} /></span>
                  <b>{d.tradeHistory.reviewRequired.value}</b>
                  <span className={styles.kvNote}>{d.tradeHistory.reviewRequired.note}</span>
                </div>
              </div>
            </section>

            {/* 섹션 C — Coverage */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>지역 Coverage</div>
                <EvidenceBadge type={d.coverage.evidenceType} />
              </div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>부산 구·군(실데이터 존재)</span><b>{d.coverage.busan.covered} / {d.coverage.busan.total}</b></div>
                <div className={styles.kv}><span>전국 시·도(region model)</span><b>{d.coverage.nationwide.sido} / 17</b></div>
                <div className={styles.kv}><span>전국 sync-target(region model)</span><b>{d.coverage.nationwide.syncTargets.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>세종 — region model</span><b>{d.coverage.sejong.regionModel}</b></div>
                <div className={styles.kv}><span>세종 — 실거래 DB 적재</span><b>{d.coverage.sejong.tradeDbCoverage}</b></div>
              </div>
              <div className={styles.note}>{d.coverage.nationwideDbCoverageNote}</div>
              <div className={styles.noteStrong}>주의: 「Region Model」(어떤 지역을 조회할 수 있는가)과 「실거래 DB 적재」(실제 데이터가 있는가)는 서로 다른 지표입니다 — 17/17은 엔진 준비 상태이지 전국 데이터가 채워졌다는 뜻이 아닙니다.</div>
            </section>

            {/* 섹션 D — Incremental Sync */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>최근 제한 QA Sync</div>
                <EvidenceBadge type={d.incrementalSync.evidenceType} />
              </div>
              <div className={styles.noteStrong}>{d.incrementalSync.scopeNote}</div>
              <div className={styles.sectionMeta}>검증 시점 {formatDateTime(d.incrementalSync.verifiedAt)} · 대상 {d.incrementalSync.regionsInScope}개 지역</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>처리된 cell</span><b>{d.incrementalSync.cells}</b></div>
                <div className={styles.kv}><span>COMPLETE</span><b>{d.incrementalSync.complete}</b></div>
                <div className={styles.kv}><span>EMPTY_VALID</span><b>{d.incrementalSync.emptyValid}</b></div>
                <div className={styles.kv}><span>FAILED</span><b className={d.incrementalSync.failed > 0 ? styles.badValue : ''}>{d.incrementalSync.failed}</b></div>
                <div className={styles.kv}><span>INVALID</span><b className={d.incrementalSync.invalid > 0 ? styles.badValue : ''}>{d.incrementalSync.invalid}</b></div>
                <div className={styles.kv}><span>누적 신규 row</span><b>{d.incrementalSync.rowsInserted}</b></div>
                <div className={styles.kv}><span>누적 취소 반영</span><b>{d.incrementalSync.cancellationsUpdated}</b></div>
              </div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>자동 수집(scheduler) <EvidenceBadge type={d.incrementalSync.scheduler.evidenceType} /></span>
                  <b>{d.incrementalSync.scheduler.value}</b>
                  <span className={styles.kvNote}>{d.incrementalSync.scheduler.note}</span>
                </div>
                <div className={styles.kv}><span>다음 예정 수집</span><b>자동 일정 없음</b></div>
              </div>
            </section>

            {/* 섹션 D-2 — Rent(전월세) Coverage */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>전월세(Rent) 데이터 최신성</div>
                <EvidenceBadge type={d.rentCoverage.evidenceType} />
              </div>
              <div className={styles.sectionMeta}>확인 시점 {formatDateTime(d.rentCoverage.checkedAt)}</div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}><span>부산 구·군(실데이터 존재)</span><b>{d.rentCoverage.busan.covered} / {d.rentCoverage.busan.total}</b></div>
                <div className={styles.kv}><span>총 row</span><b>{d.rentCoverage.totalRows.toLocaleString('ko-KR')}</b></div>
                <div className={styles.kv}><span>최신 거래일</span><b>{d.rentCoverage.latestDealDate ?? '정보 없음'}</b></div>
                <div className={styles.kv}><span>검증 범위(자동 산출)</span><b>{d.rentCoverage.verified.from} ~ {d.rentCoverage.verified.to}</b></div>
              </div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>자동 수집(scheduler) <EvidenceBadge type={d.rentCoverage.scheduler.evidenceType} /></span>
                  <b>{d.rentCoverage.scheduler.value}</b>
                  <span className={styles.kvNote}>{d.rentCoverage.scheduler.note}</span>
                </div>
                <div className={styles.kv}><span>다음 예정 수집</span><b>자동 일정 없음</b></div>
              </div>
              <div className={styles.noteStrong}>{d.rentCoverage.note}</div>
            </section>

            {/* 섹션 E — Cancellation */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>취소거래 검증 범위</div>
                <EvidenceBadge type={d.cancellation.window24m.evidenceType} />
              </div>
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>
                    {d.cancellation.window24m.evidenceType === 'SNAPSHOT'
                      ? `완료된 24개월 전체 검증(${formatMonth(d.cancellation.window24m.startMonth)}~${formatMonth(d.cancellation.window24m.endMonth)})`
                      : '24개월 전체 취소검증'}
                  </span>
                  <b><StatusPill label={d.cancellation.window24m.verdict} /></b>
                </div>
                <div className={styles.kv}><span>전체 역사(2006년~) 취소검증</span><b><StatusPill label="미검증" /></b></div>
              </div>
              {d.cancellation.window24m.evidenceType === 'SNAPSHOT' ? (
                <div className={styles.detailBox}>
                  <div className={styles.detailRow}><span>검증 결과</span><b>{d.cancellation.window24m.verdict}</b></div>
                  <div className={styles.detailRow}><span>처리 완료</span><b>{d.cancellation.window24m.complete} / {d.cancellation.window24m.cells}</b></div>
                  <div className={styles.detailRow}><span>EMPTY_VALID</span><b>{d.cancellation.window24m.emptyValid}</b></div>
                  <div className={styles.detailRow}><span>FAILED</span><b className={d.cancellation.window24m.failed > 0 ? styles.badValue : ''}>{d.cancellation.window24m.failed}</b></div>
                  <div className={styles.detailRow}><span>INVALID</span><b className={d.cancellation.window24m.invalid > 0 ? styles.badValue : ''}>{d.cancellation.window24m.invalid}</b></div>
                  <div className={styles.detailRow}><span>충돌(conflicts)</span><b className={d.cancellation.window24m.conflicts > 0 ? styles.badValue : ''}>{d.cancellation.window24m.conflicts}</b></div>
                  <div className={styles.detailRow}><span>false→true 교정 반영</span><b>{d.cancellation.window24m.correctedFalseToTrue ?? '기록 없음'}건</b></div>
                  <div className={styles.detailRow}><span>재검증 시 변경사항</span><b>{d.cancellation.window24m.idempotent ? '없음(멱등)' : '있음'}</b></div>
                  <div className={styles.detailRow}><span>마지막 검증 시각</span><b>{formatDateTime(d.cancellation.window24m.verifiedAt)}</b></div>
                  {d.cancellation.window24m.provenance && (
                    <div className={styles.detailRow}>
                      <span>근거 문서</span>
                      <b>{d.cancellation.window24m.provenance.sourceDocument} ({d.cancellation.window24m.provenance.sourceCommit})</b>
                    </div>
                  )}
                  <div className={styles.detailFooter}>이 결과는 「마지막 검증 Snapshot 기준」의 고정된 과거 검증 범위입니다 — 오늘 날짜에 맞춰 자동으로 갱신되지 않으며, 검증 범위 이후({formatMonth(d.cancellation.window24m.endMonth)} 이후) 발생한 거래·취소는 이 결과에 포함되지 않습니다.</div>
                </div>
              ) : (
                <div className={styles.detailBox}>
                  <div className={styles.detailFooter}>{d.cancellation.window24m.source}</div>
                </div>
              )}
              <div className={styles.note}>{d.cancellation.allTime.note}</div>
            </section>

            {/* 섹션 F — Feature Health */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>DB-FIRST 기능 상태(부산)</div>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>기능</th>
                      <th>데이터 소스</th>
                      <th>부산</th>
                      <th>신뢰 상태</th>
                      <th>근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.features.map((f: any) => (
                      <tr key={f.name}>
                        <td>{f.name}</td>
                        <td>{f.source}</td>
                        <td>{f.busan}</td>
                        <td>{f.trust}</td>
                        <td><EvidenceBadge type={f.evidenceType} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.note}>「신뢰 상태」는 구현 방식(코드 구성) 기준입니다 — 이 화면을 열 때마다 각 기능 API를 직접 호출해 상태를 확인하지 않습니다.</div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
