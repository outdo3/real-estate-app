'use client';

// REALTOR_PRO_MVP_V1 — Pro 진입: 소개 + 베타 신청 / 심사 상태 / 대시보드 이동.

import Link from 'next/link';
import { useState } from 'react';
import { BadgeCheck, Building2, Clock, FileText, ListChecks, Lock, Users } from 'lucide-react';
import { TEXT_LIMITS } from '@/lib/pro/rules';
import type { MyProStatus, ProfileDto } from '@/lib/pro/profile-service';
import type { Wire } from '@/components/pro/api';
import { LoadingState, ProErrorState, useProMe } from '@/components/pro/ProStateGate';
import { SaverFeedback, useSaver } from '@/components/pro/useSaver';
import s from '@/components/pro/pro.module.css';

const FEATURES = [
  { Icon: Building2, title: '매물관리', text: '단지 정보와 연결된 비공개 매물 노트' },
  { Icon: Users, title: '고객관리', text: '고객별 조건 세트와 팔로업 일정' },
  { Icon: ListChecks, title: '자동매칭', text: '조건별로 맞음·차이·확인 필요를 설명하는 매칭' },
  { Icon: FileText, title: '고객 설명', text: '공공 실거래와 함께 보내는 브리핑 링크' },
];

function ApplyForm({ profile, onDone }: { profile: Wire<ProfileDto> | null; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [officeName, setOfficeName] = useState(profile?.officeName ?? '');
  const [officePhone, setOfficePhone] = useState(profile?.officePhone ?? '');
  const [officeAddress, setOfficeAddress] = useState(profile?.officeAddress ?? '');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [officeRegNo, setOfficeRegNo] = useState('');
  const [businessRegNo, setBusinessRegNo] = useState('');
  const [agree, setAgree] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const saver = useSaver<ProfileDto>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return setLocalError('표시 이름을 입력해 주세요.');
    if (!agree) return setLocalError('약관에 동의해야 신청할 수 있습니다.');
    setLocalError(null);
    void saver.run(
      '/api/pro/me',
      'POST',
      {
        displayName: displayName.trim(),
        officeName: officeName.trim() || null,
        officePhone: officePhone.trim() || null,
        officeAddress: officeAddress.trim() || null,
        licenseNumber: licenseNumber.trim() || null,
        officeRegNo: officeRegNo.trim() || null,
        businessRegNo: businessRegNo.trim() || null,
        agreeTerms: true,
      },
      () => onDone()
    );
  };

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>베타 신청</legend>
        <div className={s.field}>
          <label className={s.label} htmlFor="ap-name">
            표시 이름<span className={s.required}>*</span>
          </label>
          <input id="ap-name" className={s.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={TEXT_LIMITS.name} />
          <p className={s.help}>고객 브리핑에 담당 중개사 이름으로 표시됩니다.</p>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ap-office">
            사무소 이름
          </label>
          <input id="ap-office" className={s.input} value={officeName} onChange={(e) => setOfficeName(e.target.value)} maxLength={TEXT_LIMITS.officeName} />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ap-phone">
            사무소 전화
          </label>
          <input id="ap-phone" className={s.input} type="tel" inputMode="tel" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} maxLength={TEXT_LIMITS.phone} />
          <p className={s.help}>브리핑을 받은 고객이 연락할 수 있는 사무소 번호입니다.</p>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ap-addr">
            사무소 주소
          </label>
          <input id="ap-addr" className={s.input} value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} maxLength={TEXT_LIMITS.officeAddress} />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="ap-license">
            공인중개사 자격번호
          </label>
          <input id="ap-license" className={s.input} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} maxLength={TEXT_LIMITS.licenseNumber} autoComplete="off" />
        </div>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="ap-reg">
              중개사무소 등록번호
            </label>
            <input id="ap-reg" className={s.input} value={officeRegNo} onChange={(e) => setOfficeRegNo(e.target.value)} maxLength={TEXT_LIMITS.licenseNumber} autoComplete="off" />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="ap-biz">
              사업자등록번호
            </label>
            <input id="ap-biz" className={s.input} value={businessRegNo} onChange={(e) => setBusinessRegNo(e.target.value)} maxLength={TEXT_LIMITS.licenseNumber} autoComplete="off" />
          </div>
        </div>
        <p className={s.help}>
          <Lock size={12} aria-hidden="true" /> 자격번호·등록번호는 암호화되어 저장되며 화면에는 등록 여부만 표시됩니다. 심사는 운영자가 직접 확인합니다.
        </p>
        <label className={s.checkRow}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Pro 베타 이용약관 및 개인정보 처리위탁에 동의합니다(초안 — 법률 검토 중)</span>
        </label>
      </fieldset>
      {localError ? (
        <div className={s.errorBox} role="alert">
          {localError}
        </div>
      ) : null}
      <SaverFeedback saver={saver} />
      <button type="submit" className={`${s.btnPrimary} ${s.btnBlock}`} disabled={saver.busy}>
        {saver.busy ? '신청 중' : '베타 신청하기'}
      </button>
    </form>
  );
}

function Intro() {
  return (
    <section className={s.card}>
      <h1 className={s.pageTitle}>중개사의 매물관리 + 고객관리 + 자동매칭 + 고객 설명 업무도구</h1>
      <p className={s.pageSub}>이집의 공공 데이터 위에서 매물과 고객 조건을 연결하고, 왜 맞는지 설명할 수 있게 돕습니다.</p>
      <ul className={s.list} style={{ marginTop: 14 }}>
        {FEATURES.map(({ Icon, title, text }) => (
          <li key={title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon size={18} color="var(--primary-color)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>{title}</strong>
              <span className={s.muted}> · {text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ProEntryPage() {
  const { data, failure, loading, reload } = useProMe();

  if (loading && !data) return <LoadingState />;
  if (failure) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;
  const me = data as Wire<MyProStatus>;

  if (me.state === 'VERIFIED' || me.state === 'SUSPENDED') {
    return (
      <div className={s.page}>
        <section className={s.stateBox}>
          <BadgeCheck size={28} color="var(--primary-color)" aria-hidden="true" />
          <p className={s.stateTitle}>{me.profile?.displayName ?? '중개사'}님, 인증된 중개사입니다</p>
          {me.state === 'SUSPENDED' ? <p className={s.stateText}>이용이 정지된 계정입니다. 조회만 가능합니다.{me.profile?.statusReason ? ` 사유: ${me.profile.statusReason}` : ''}</p> : null}
          <Link href="/pro/dashboard" className={s.btnPrimary}>
            대시보드로 이동
          </Link>
        </section>
      </div>
    );
  }

  if (me.state === 'APPLICANT') {
    return (
      <div className={s.page}>
        <section className={s.stateBox}>
          <Clock size={28} aria-hidden="true" />
          <p className={s.stateTitle}>심사 중입니다</p>
          <p className={s.stateText}>신청이 접수되었습니다. 운영자가 확인한 뒤 이용할 수 있습니다.</p>
          {me.profile ? (
            <dl className={s.kv} style={{ textAlign: 'left' }}>
              <dt>표시 이름</dt>
              <dd>{me.profile.displayName}</dd>
              <dt>사무소</dt>
              <dd>{me.profile.officeName ?? '-'}</dd>
            </dl>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <Intro />
      {me.state === 'REJECTED' ? (
        <div className={s.banner} role="status">
          <span>
            이전 신청이 반려되었습니다.{me.profile?.statusReason ? ` 사유: ${me.profile.statusReason}` : ''} 내용을 고쳐 다시 신청할 수 있습니다.
          </span>
        </div>
      ) : null}
      <ApplyForm profile={me.state === 'REJECTED' ? me.profile : null} onDone={reload} />
    </div>
  );
}
