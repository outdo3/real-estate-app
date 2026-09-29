'use client';

// REALTOR_PRO_MVP_V1 — API 오류 코드별 중립 상태 화면 + 공용 조회 훅.
// 데이터가 없거나 저장소가 준비되지 않은 상태를 "오류"로 단정하지 않는다. 가짜 데이터로 채우지 않는다.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, Clock, Database, Loader2, Lock, LogIn, ShieldAlert, UserCheck } from 'lucide-react';
import type { MyProStatus } from '@/lib/pro/profile-service';
import { proFetch, type ApiFailure, type Wire } from './api';
import s from './pro.module.css';

export function LoadingState({ label = '불러오는 중입니다' }: { label?: string }) {
  return (
    <div className={s.stateBox} role="status" aria-live="polite">
      <Loader2 size={22} aria-hidden="true" />
      <p className={s.stateText}>{label}</p>
    </div>
  );
}

export function ProErrorState({ failure, onRetry }: { failure: ApiFailure; onRetry?: () => void }) {
  const { status, code, error } = failure;
  if (code === 'PRO_NOT_MIGRATED' || code === 'PRO_STORE_UNAVAILABLE') {
    return (
      <div className={s.stateBox}>
        <Database size={24} aria-hidden="true" />
        <p className={s.stateTitle}>중개사 Pro 저장소 준비 중</p>
        <p className={s.stateText}>저장소가 아직 준비되지 않았습니다. 준비가 끝나면 이 화면에서 바로 이용할 수 있습니다.</p>
      </div>
    );
  }
  if (code === 'PRO_DISABLED' || (status === 404 && code === 'PRO_DISABLED')) {
    return (
      <div className={s.stateBox}>
        <Clock size={24} aria-hidden="true" />
        <p className={s.stateTitle}>준비 중인 기능입니다</p>
      </div>
    );
  }
  if (status === 401 || code === 'LOGIN_REQUIRED') {
    return (
      <div className={s.stateBox}>
        <LogIn size={24} aria-hidden="true" />
        <p className={s.stateTitle}>로그인이 필요합니다</p>
        <p className={s.stateText}>중개사 Pro는 로그인한 회원만 이용할 수 있습니다.</p>
        <Link href="/my" className={s.btnPrimary}>
          로그인하러 가기
        </Link>
      </div>
    );
  }
  if (code === 'NOT_VERIFIED_REALTOR') {
    return (
      <div className={s.stateBox}>
        <UserCheck size={24} aria-hidden="true" />
        <p className={s.stateTitle}>인증된 중개사만 사용할 수 있습니다</p>
        <p className={s.stateText}>중개사 Pro 베타를 신청하면 심사 후 이용할 수 있습니다.</p>
        <Link href="/pro" className={s.btnPrimary}>
          Pro 신청·상태 확인
        </Link>
      </div>
    );
  }
  if (code === 'SUSPENDED') {
    return (
      <div className={s.banner} role="status">
        <Lock size={16} aria-hidden="true" />
        <span>{error || '이용이 정지된 계정입니다. 조회만 가능합니다.'}</span>
      </div>
    );
  }
  if (code === 'PLAN_LIMIT' || code === 'PLAN_FEATURE') {
    return (
      <div className={s.banner} role="alert">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }
  if (code === 'NOT_FOUND') {
    return (
      <div className={s.stateBox}>
        <CircleAlert size={24} aria-hidden="true" />
        <p className={s.stateTitle}>찾을 수 없습니다</p>
        <p className={s.stateText}>삭제되었거나 접근할 수 없는 항목입니다.</p>
      </div>
    );
  }
  return (
    <div className={s.stateBox} role="alert">
      <CircleAlert size={24} aria-hidden="true" />
      <p className={s.stateTitle}>불러오지 못했습니다</p>
      <p className={s.stateText}>{error}</p>
      {onRetry ? (
        <button type="button" className={s.btn} onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

/** 쓰기 요청 실패를 폼 아래 한 줄로 보여줄 때(403 SUSPENDED/PLAN_LIMIT 등 포함). */
export function InlineFailure({ failure }: { failure: ApiFailure | null }) {
  if (!failure || failure.code === 'ABORTED') return null;
  if (failure.code === 'PLAN_LIMIT' || failure.code === 'PLAN_FEATURE' || failure.code === 'SUSPENDED') {
    return (
      <div className={s.banner} role="alert">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>{failure.error}</span>
      </div>
    );
  }
  if (failure.code === 'PRO_NOT_MIGRATED' || failure.code === 'PRO_STORE_UNAVAILABLE') {
    return <div className={s.banner} role="alert">중개사 Pro 저장소 준비 중입니다. 저장되지 않았습니다.</div>;
  }
  return (
    <div className={s.errorBox} role="alert">
      {failure.error}
    </div>
  );
}

export function ReadOnlyBanner() {
  return (
    <div className={s.banner} role="status">
      <Lock size={16} aria-hidden="true" />
      <span>이용이 정지된 계정입니다. 조회만 가능하며 등록·수정은 할 수 없습니다.</span>
    </div>
  );
}

/** GET 조회 훅: 요청 취소·늦게 온 응답 무시. url이 null이면 요청하지 않는다. */
export function useProQuery<T>(url: string | null) {
  const [data, setData] = useState<Wire<T> | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    const r = await proFetch<T>(url);
    if (my !== seq.current) return;
    if (r.ok) {
      setData(r.data);
      setFailure(null);
    } else if (r.code !== 'ABORTED') {
      setFailure(r);
    }
    setLoading(false);
  }, [url]);

  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);

  return { data, failure, loading, reload: load, setData };
}

export function useProMe() {
  return useProQuery<MyProStatus>('/api/pro/me');
}
