'use client';

// REALTOR_PRO_MVP_V1 — 설정: 표시 정보 수정(PATCH /api/pro/me) · 플랜과 기능 한도(plan-limits 단일 정의) · 결제 미제공 안내.

import Link from 'next/link';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PLAN_CAPABILITIES, PLAN_LABELS, type PlanCapabilities } from '@/lib/pro/plan-limits';
import { TEXT_LIMITS, type PlanCode } from '@/lib/pro/rules';
import type { MyProStatus, ProfileDto } from '@/lib/pro/profile-service';
import type { Wire } from '@/components/pro/api';
import { LoadingState, ProErrorState, ReadOnlyBanner, useProMe } from '@/components/pro/ProStateGate';
import { SaverFeedback, useSaver } from '@/components/pro/useSaver';
import s from '@/components/pro/pro.module.css';

const CAP_ROWS: { label: string; get: (c: PlanCapabilities) => string }[] = [
  { label: '활성 매물', get: (c) => `${c.activeListings}건` },
  { label: '고객', get: (c) => `${c.customers}명` },
  { label: '고객당 조건 세트', get: (c) => `${c.preferenceSetsPerCustomer}개` },
  { label: '매칭 결과', get: (c) => (c.manualMatchTopN == null ? '전체' : `상위 ${c.manualMatchTopN}건`) },
  { label: '하루 브리핑', get: (c) => `${c.briefingsPerDay}건` },
  { label: '브리핑 유효기간', get: (c) => (c.briefingExpiryDays.min === c.briefingExpiryDays.max ? `${c.briefingExpiryDays.min}일` : `${c.briefingExpiryDays.min}~${c.briefingExpiryDays.max}일`) },
  { label: '고객당 진행 중 팔로업', get: (c) => `${c.followupsPerCustomer}개` },
  { label: '반복 팔로업', get: (c) => (c.repeatFollowups ? '가능' : '불가') },
  { label: '매물 노트 기록', get: (c) => (c.listingNoteHistory === 'FULL' ? '전체' : '최근 1건') },
  { label: '대시보드 섹션', get: (c) => `${c.dashboardSections.length}개` },
];

function ProfileEdit({ profile, onSaved }: { profile: Wire<ProfileDto>; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [officeName, setOfficeName] = useState(profile.officeName ?? '');
  const [officePhone, setOfficePhone] = useState(profile.officePhone ?? '');
  const [officeAddress, setOfficeAddress] = useState(profile.officeAddress ?? '');
  const [saved, setSaved] = useState(false);
  const saver = useSaver<ProfileDto>();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void saver.run(
      '/api/pro/me',
      'PATCH',
      { displayName: displayName.trim(), officeName: officeName.trim() || null, officePhone: officePhone.trim() || null, officeAddress: officeAddress.trim() || null },
      () => {
        setSaved(true);
        onSaved();
      }
    );
  };
  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <div className={s.field}>
        <label className={s.label} htmlFor="st-name">
          표시 이름<span className={s.required}>*</span>
        </label>
        <input id="st-name" className={s.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={TEXT_LIMITS.name} />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="st-office">
          사무소 이름
        </label>
        <input id="st-office" className={s.input} value={officeName} onChange={(e) => setOfficeName(e.target.value)} maxLength={TEXT_LIMITS.officeName} />
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="st-phone">
          사무소 전화
        </label>
        <input id="st-phone" className={s.input} type="tel" inputMode="tel" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} maxLength={TEXT_LIMITS.phone} />
        <p className={s.help}>새로 만드는 브리핑에 표시됩니다. 이미 보낸 브리핑은 만든 시점의 정보가 유지됩니다.</p>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="st-addr">
          사무소 주소
        </label>
        <input id="st-addr" className={s.input} value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} maxLength={TEXT_LIMITS.officeAddress} />
      </div>
      <SaverFeedback saver={saver} />
      {saved ? (
        <p className={s.successBox} role="status">
          저장했습니다.
        </p>
      ) : null}
      <button type="submit" className={s.btnPrimary} disabled={saver.busy || !displayName.trim()}>
        {saver.busy ? '저장 중' : '저장'}
      </button>
    </form>
  );
}

export default function ProSettingsPage() {
  const { data, failure, loading, reload } = useProMe();
  if (loading && !data) return <LoadingState />;
  if (failure) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;
  const me = data as Wire<MyProStatus>;
  if (!me.profile) return <ProErrorState failure={{ ok: false, status: 403, code: 'NOT_VERIFIED_REALTOR', error: '' }} />;
  const plans: PlanCode[] = ['FREE', 'PRO'];

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>설정</h1>
      {me.state === 'SUSPENDED' ? <ReadOnlyBanner /> : null}
      <div className={s.grid2}>
        <section className={s.card}>
          <h2 className={s.sectionTitle}>중개사 표시 정보</h2>
          {me.state === 'SUSPENDED' ? (
            <dl className={s.kv}>
              <dt>표시 이름</dt>
              <dd>{me.profile.displayName}</dd>
              <dt>사무소</dt>
              <dd>{me.profile.officeName ?? '-'}</dd>
              <dt>전화</dt>
              <dd>{me.profile.officePhone ?? '-'}</dd>
            </dl>
          ) : (
            <ProfileEdit profile={me.profile} onSaved={reload} />
          )}
          <hr className={s.divider} style={{ margin: '14px 0' }} />
          <dl className={s.kv}>
            <dt>자격번호</dt>
            <dd>{me.profile.hasLicenseNumber ? '등록됨' : '미등록'}</dd>
            <dt>등록번호</dt>
            <dd>{me.profile.hasOfficeRegNo ? '등록됨' : '미등록'}</dd>
            <dt>사업자번호</dt>
            <dd>{me.profile.hasBusinessRegNo ? '등록됨' : '미등록'}</dd>
          </dl>
          <p className={s.help}>자격번호·등록번호는 암호화되어 보관되며 화면에 다시 표시하지 않습니다.</p>
        </section>

        <section className={s.card}>
          <h2 className={s.sectionTitle}>
            플랜
            <span className={`${s.badge} ${me.plan === 'PRO' ? s.badgeBrand : ''}`}>{PLAN_LABELS[me.plan]}</span>
          </h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">기능</th>
                  {plans.map((p) => (
                    <th key={p} scope="col">
                      {PLAN_LABELS[p]}
                      {p === me.plan ? ' (현재)' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAP_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {plans.map((p) => (
                      <td key={p} style={p === me.plan ? { fontWeight: 600 } : undefined}>
                        {row.get(PLAN_CAPABILITIES[p])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={s.help} style={{ marginTop: 10 }}>
            결제는 아직 제공하지 않습니다. 베타 기간에는 운영자가 Pro 기능을 부여할 수 있습니다.
          </p>
        </section>
      </div>

      <section className={s.card}>
        <h2 className={s.sectionTitle}>
          <ShieldCheck size={18} aria-hidden="true" />
          개인정보
        </h2>
        <ul className={s.list} style={{ gap: 6, fontSize: 'var(--font-size-body-sm)' }}>
          <li>고객·소유자 연락처는 암호화되어 저장되며, &quot;연락처 보기&quot;를 누를 때마다 조회 기록이 남습니다.</li>
          <li>출입 비밀번호·열쇠 위치·공동현관 번호·주민등록번호는 어떤 입력칸에도 적지 마세요.</li>
          <li>고객 브리핑에는 소유자 정보, 동·호수, 비공개 메모, 고객 예산 금액이 포함되지 않습니다.</li>
          <li>고객 개인정보 수집·이용 동의 여부는 고객 정보의 &quot;개인정보 동의&quot;에 기록하세요.</li>
        </ul>
        <Link href="/privacy" className={s.linkBtn}>
          이집 개인정보처리방침 보기
        </Link>
      </section>
    </div>
  );
}
