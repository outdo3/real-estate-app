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

// CRON ACTIVATION §8 — scheduler 상태 표기. 등록(SCHEDULED)과 실행 성공을 섞지 않는다.
const SCHEDULER_LABELS: Record<string, string> = {
  OFF: 'OFF',
  SCHEDULED: '예약됨',
  UNKNOWN: '확인 불가',
};

function EvidenceBadge({ type }: { type: string }) {
  const cls = type === 'LIVE' ? styles.evidenceLive : type === 'SNAPSHOT' ? styles.evidenceSnapshot : type === 'UNKNOWN' ? styles.evidenceUnknown : styles.evidenceConfig;
  return <span className={`${styles.evidenceBadge} ${cls}`}>{EVIDENCE_LABELS[type] || type}</span>;
}

export default function AdminOpsPage() {
  const { data: session, status } = useSession();
  // ADMIN_ACCESS_FIX_V1 — role만 보면 ADMIN_EMAIL로 부트스트랩된 운영자가 proxy/API는
  // 통과하고도 이 화면에서만 non-admin으로 판정돼 데이터를 아예 요청하지 않았다.
  // 서버가 계산해 세션에 실어준 isAdmin을 쓴다(실제 권한은 서버가 다시 검증).
  const isAdmin = session?.user?.isAdmin === true;

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
                {/* CRON ACTIVATION §8 — 예전에는 "OFF"가 하드코딩돼 있었다(그때는 사실이었다).
                    cron 등록 후에도 그대로면 화면이 거짓말을 하므로 실제 등록 상태를 쓴다.
                    "예약됨"은 스케줄이 등록됐다는 뜻일 뿐 무인 실행 성공을 뜻하지 않는다. */}
                <StatusPill label={SCHEDULER_LABELS[d.incrementalSync.scheduler.value] ?? d.incrementalSync.scheduler.value} />
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
                <div className={styles.kv}>
                  <span>다음 예정 수집</span>
                  <b>{d.incrementalSync.nextScheduledSync.value ?? '자동 일정 없음'}</b>
                  {d.incrementalSync.scheduler.scheduleUtc && (
                    <span className={styles.kvNote}>{d.incrementalSync.scheduler.scheduleUtc} UTC</span>
                  )}
                </div>
                {/* CRON ACTIVATION §8 — "등록됨"과 "실제로 돌았다"를 분리해서 보여준다. */}
                <div className={styles.kv}>
                  <span>마지막 실행(coverage 기록 기준) <EvidenceBadge type={d.incrementalSync.lastRun.evidenceType} /></span>
                  <b>{formatDateTime(d.incrementalSync.lastRun.at)}</b>
                  <span className={styles.kvNote}>
                    {d.incrementalSync.lastRun.runId ? `runId ${d.incrementalSync.lastRun.runId} · ` : ''}
                    {d.incrementalSync.lastRun.note}
                  </span>
                </div>
              </div>
              {/* ADMIN_ACCESS_FIX_V1 §5 — 위 숫자들은 git-tracked 파일 manifest(과거 CLI QA
                  실행 기록)이라, Cron 경로로 실제 적용된 결과는 여기에 반영되지 않는다.
                  실제 적용 상태는 아래 DB coverage가 사실이다 — 둘을 나란히 보여주고 출처를
                  분명히 밝혀, 파일 숫자가 최신 상태인 것처럼 오해하지 않게 한다. */}
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>동기화 coverage(DB) <EvidenceBadge type={d.incrementalSync.coverageCells.evidenceType} /></span>
                  <b>{d.incrementalSync.coverageCells.total}개 cell</b>
                  <span className={styles.kvNote}>
                    {d.incrementalSync.coverageCells.total === 0
                      ? '아직 Cron 경로로 적용된 기록이 없다(위 숫자는 과거 CLI QA 실행 기록이다).'
                      : `${Object.entries(d.incrementalSync.coverageCells.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')} · 최근 검증 ${formatDateTime(d.incrementalSync.coverageCells.latestVerifiedAt)}`}
                  </span>
                </div>
              </div>
              {/* SALE_CANCELLATION_COVERAGE_V1 §9 — daily overlap 바깥(4~12개월)의 late
                  cancellation을 훑는 별도 sweep. daily sync와 같은 칸에 섞지 않는다. */}
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>취소 recheck sweep <EvidenceBadge type={d.incrementalSync.recheckSweep.scheduler.evidenceType} /></span>
                  <b>
                    {d.incrementalSync.recheckSweep.scheduler.value}
                    {d.incrementalSync.recheckSweep.scheduler.scheduleKst ? ` · ${d.incrementalSync.recheckSweep.scheduler.scheduleKst}` : ''}
                  </b>
                  <span className={styles.kvNote}>
                    {`${d.incrementalSync.recheckSweep.bandMonthsBack.from}~${d.incrementalSync.recheckSweep.bandMonthsBack.to}개월 전 구간 · `}
                    {d.incrementalSync.recheckSweep.note}
                  </span>
                </div>
                <div className={styles.kv}>
                  <span>sweep 마지막 실행 <EvidenceBadge type={d.incrementalSync.recheckSweep.evidenceType} /></span>
                  <b>{formatDateTime(d.incrementalSync.recheckSweep.lastRunAt)}</b>
                  <span className={styles.kvNote}>
                    {d.incrementalSync.recheckSweep.lastRunId
                      ? `runId ${d.incrementalSync.recheckSweep.lastRunId} · sweep이 마지막으로 검증한 cell ${d.incrementalSync.recheckSweep.cellsCoveredBySweep}개`
                      : '아직 sweep이 coverage를 기록한 적이 없다.'}
                  </span>
                </div>
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
                <div className={styles.kv}>
                  <span>다음 예정 수집</span>
                  <b>{d.rentCoverage.scheduler.scheduleKst ?? '자동 일정 없음'}</b>
                  {d.rentCoverage.scheduler.scheduleUtc && (
                    <span className={styles.kvNote}>{d.rentCoverage.scheduler.scheduleUtc} UTC</span>
                  )}
                </div>
                <div className={styles.kv}>
                  <span>마지막 실행(coverage 기록 기준) <EvidenceBadge type={d.rentCoverage.lastRun.evidenceType} /></span>
                  <b>{formatDateTime(d.rentCoverage.lastRun.at)}</b>
                  <span className={styles.kvNote}>
                    {d.rentCoverage.lastRun.runId ? `runId ${d.rentCoverage.lastRun.runId} · ` : ''}
                    {d.rentCoverage.lastRun.note}
                  </span>
                </div>
              </div>
              {/* ADMIN_ACCESS_FIX_V1 §5 — rent coverage도 파일이 아니라 DB가 사실이다. */}
              <div className={styles.kvGrid}>
                <div className={styles.kv}>
                  <span>동기화 coverage(DB) <EvidenceBadge type={d.rentCoverage.coverageCells.evidenceType} /></span>
                  <b>{d.rentCoverage.coverageCells.total}개 cell</b>
                  <span className={styles.kvNote}>
                    {d.rentCoverage.coverageCells.total === 0
                      ? '아직 적용된 rent sync 기록이 없다 — 검증 범위는 아래 legacy bootstrap 기준이다.'
                      : `${Object.entries(d.rentCoverage.coverageCells.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')} · 최근 검증 ${formatDateTime(d.rentCoverage.coverageCells.latestVerifiedAt)}`}
                  </span>
                </div>
                <div className={styles.kv}>
                  <span>legacy bootstrap</span>
                  <b>{d.rentCoverage.legacyBootstrap ? `${d.rentCoverage.legacyBootstrap.from} ~ ${d.rentCoverage.legacyBootstrap.to}` : '정보 없음'}</b>
                  <span className={styles.kvNote}>{d.rentCoverage.coverageCells.note}</span>
                </div>
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
