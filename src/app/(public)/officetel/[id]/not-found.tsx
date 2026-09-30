// OFFICETEL_V1 STEP 4B §6/§19 — 없는 오피스텔에 대한 명확한 NOT FOUND 상태.
// 다른 오피스텔을 대신 보여주지 않는다.
import Link from 'next/link';
import { Building2 } from 'lucide-react';

export default function OfficetelNotFound() {
  return (
    <main
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '4rem 1rem 6rem',
        textAlign: 'center',
      }}
    >
      <Building2 size={44} strokeWidth={1.6} color="#0d9488" aria-hidden />
      <h1 style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: '1rem', color: 'var(--text-primary)' }}>
        오피스텔 정보 없음
      </h1>
      <p style={{ marginTop: '0.6rem', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        요청하신 오피스텔을 찾을 수 없습니다.
        <br />
        주소가 정확한지 확인해 주세요.
      </p>
      <Link
        href="/"
        style={{
          display: 'inline-block',
          marginTop: '1.5rem',
          padding: '0.7rem 1.4rem',
          borderRadius: '999px',
          background: '#0d9488',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.9rem',
          textDecoration: 'none',
        }}
      >
        검색으로 돌아가기
      </Link>
    </main>
  );
}
