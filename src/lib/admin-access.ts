// ADMIN_ACCESS_FIX_V1 — 관리자 판정의 **단일 소스**.
//
// 이전에는 같은 판정이 세 곳에 흩어져 있었고, 그중 하나가 달랐다:
//   - src/lib/auth-helpers.ts requireAdmin()  : role==='ADMIN' || email===ADMIN_EMAIL
//   - src/proxy.ts (admin route gate)         : 같은 로직을 **복제**
//   - src/app/admin/*/page.tsx                : role==='ADMIN' **만** ← 불일치
//
// 그 결과 ADMIN_EMAIL로 승격된 운영자는 proxy와 API는 통과하지만 페이지 컴포넌트가
// 스스로를 non-admin으로 판정해 데이터를 아예 요청하지 않는 상태가 된다. 판정을 이
// 파일 하나로 모아 그 계열의 버그를 구조적으로 막는다.
//
// 이 파일은 **아무것도 import하지 않는다** — auth.ts(세션 콜백)와 auth-helpers.ts가
// 서로를 import하면 순환 참조가 되기 때문이다(auth-helpers는 authOptions를 쓴다).
// 또한 proxy(edge/node 런타임)에서도 안전하게 쓸 수 있어야 한다.

/**
 * 서버 환경변수 ADMIN_EMAIL과 로그인 이메일이 일치하는가.
 *
 * 부트스트랩 경로다: DB role이 아직 ADMIN으로 승격되지 않은 상태에서도 운영자가 처음
 * 관리자 화면에 들어올 수 있어야 한다(role 컬럼만 신뢰 소스로 두면 "아무도 ADMIN이
 * 아니라 아무도 들어갈 수 없는" 교착이 생긴다 — 실제로 Production에서 그 상태였다).
 *
 * 값은 서버 전용이다. NEXT_PUBLIC_ 접두사가 아니므로 클라이언트 번들에 포함되지 않고,
 * 세션에는 이메일 목록이 아니라 **boolean 하나(isAdmin)** 만 실려 나간다.
 */
export function isAdminByEnvEmail(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}

/**
 * 이 세션 사용자가 관리자인가. DB role 승격과 env 이메일 부트스트랩 둘 다 인정한다.
 * 클라이언트가 보내온 값을 신뢰하지 않는다 — 호출부는 항상 서버에서 확인한 세션/토큰을
 * 넘겨야 한다(페이지의 isAdmin은 UI 노출용일 뿐, 실제 데이터는 requireAdmin()이 지킨다).
 */
export function isAdminSessionUser(user: { role?: string | null; email?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'ADMIN' || isAdminByEnvEmail(user.email);
}
