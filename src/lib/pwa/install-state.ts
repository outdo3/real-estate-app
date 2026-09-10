// PWA_INSTALL_UX_V1 §5 — 설치 상태 판정의 **단일 출처**.
//
// UA 스니핑을 여러 컴포넌트에 흩어놓으면 곧 서로 다른 판단을 하게 된다.
// 여기 있는 함수는 전부 순수하다(입력을 인자로 받는다) — 테스트 가능하고,
// 서버 렌더 중에 window를 만지지 않는다.

export type InstallCapability =
  /** 이미 홈 화면에서 실행 중 — 설치 UI를 보여줄 이유가 없다. */
  | 'INSTALLED'
  /** beforeinstallprompt를 받은 상태. 네이티브 설치 프롬프트를 띄울 수 있다. */
  | 'PROMPTABLE'
  /** iOS Safari — 네이티브 프롬프트가 없고 공유 시트 안내가 필요하다. */
  | 'IOS_SAFARI'
  /** 카카오톡 인앱 브라우저 — 홈 화면 추가를 지원하지 않는다. */
  | 'KAKAO_INAPP'
  /** 그 외 인앱 브라우저(라인/인스타/페북 등) — 역시 외부 브라우저 안내. */
  | 'OTHER_INAPP'
  /** 설치를 지원하지 않거나 아직 프롬프트를 받지 못한 상태. */
  | 'UNSUPPORTED';

export interface InstallEnv {
  userAgent: string;
  /** display-mode: standalone 매칭 결과. */
  displayStandalone: boolean;
  /** iOS Safari 전용 navigator.standalone. */
  navigatorStandalone: boolean;
  /** beforeinstallprompt를 받아 보관 중인가. */
  hasPrompt: boolean;
  /** 터치 가능한 좁은 화면인가(모바일 판정에 사용). */
  isNarrow: boolean;
}

/** 카카오톡 인앱 브라우저. UA에 KAKAOTALK이 들어간다. */
export function isKakaoInApp(ua: string): boolean {
  return /KAKAOTALK/i.test(ua);
}

/** 그 외 대표적인 인앱 브라우저들. */
export function isOtherInApp(ua: string): boolean {
  return /(Line\/|Instagram|FBAN|FBAV|NAVER\(inapp|DaumApps|everytimeApp|wv\))/i.test(ua);
}

export function isIos(ua: string): boolean {
  // iPadOS 13+는 데스크톱 Mac UA를 보내지만, 그 경우 터치 지원으로 걸러야 한다.
  // 여기서는 명시적인 iPhone/iPad/iPod만 iOS로 본다(오탐이 오히려 위험하다).
  return /iPhone|iPad|iPod/i.test(ua);
}

/** iOS에서 "홈 화면에 추가"가 가능한 브라우저는 사실상 Safari뿐이다. */
export function isIosSafari(ua: string): boolean {
  if (!isIos(ua)) return false;
  if (isKakaoInApp(ua) || isOtherInApp(ua)) return false;
  // iOS의 Chrome(CriOS)/Firefox(FxiOS)/Edge(EdgiOS)는 홈 화면 추가를 제공하지 않는다.
  if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return false;
  return /Safari/i.test(ua);
}

export function isAndroid(ua: string): boolean {
  return /Android/i.test(ua);
}

/** 설치 UI를 노출할 모바일 환경인가(§9 — 모바일 전용). */
export function isMobileEnv(env: Pick<InstallEnv, 'userAgent' | 'isNarrow'>): boolean {
  return isIos(env.userAgent) || isAndroid(env.userAgent) || env.isNarrow;
}

/** 이미 설치되어 standalone으로 실행 중인가(§11). */
export function isStandalone(env: Pick<InstallEnv, 'displayStandalone' | 'navigatorStandalone'>): boolean {
  return env.displayStandalone || env.navigatorStandalone;
}

/**
 * 이 환경에서 설치를 어떻게 안내해야 하는가.
 *
 * 순서가 중요하다: 이미 설치됨 → 네이티브 프롬프트 → 인앱 브라우저 → iOS → 그 외.
 * 인앱 브라우저를 iOS보다 먼저 보는 이유는, 카카오 인앱은 iOS에서도 공유 시트로
 * 홈 화면 추가를 할 수 없기 때문이다(§8).
 */
export function resolveInstallCapability(env: InstallEnv): InstallCapability {
  if (isStandalone(env)) return 'INSTALLED';
  if (env.hasPrompt) return 'PROMPTABLE';
  if (isKakaoInApp(env.userAgent)) return 'KAKAO_INAPP';
  if (isOtherInApp(env.userAgent)) return 'OTHER_INAPP';
  if (isIosSafari(env.userAgent)) return 'IOS_SAFARI';
  return 'UNSUPPORTED';
}

/** 배너를 띄울 수 있는 상태인가. UNSUPPORTED/INSTALLED에서는 띄우지 않는다. */
export function canOfferInstall(cap: InstallCapability): boolean {
  return cap === 'PROMPTABLE' || cap === 'IOS_SAFARI' || cap === 'KAKAO_INAPP' || cap === 'OTHER_INAPP';
}

// ── 노출/거절 정책 (§10) ───────────────────────────────────────────────────

export const DISMISS_STORAGE_KEY = 'ejip:pwa-install-dismissed-at';
/** 한 번 닫으면 14일간 다시 띄우지 않는다. 영구 억제는 하지 않는다(§10). */
export const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * 지금 배너를 보여도 되는가.
 * `dismissedAt`이 없거나(=닫은 적 없음) 쿨다운이 지났으면 true.
 * 값이 깨져 있으면 **보여준다** — 저장소 오류로 기능이 영구히 사라지지 않게.
 */
export function shouldShowBanner(dismissedAtRaw: string | null, now: number): boolean {
  if (!dismissedAtRaw) return true;
  const at = Number(dismissedAtRaw);
  if (!Number.isFinite(at) || at <= 0) return true;
  // 시계가 뒤로 간 경우(미래 타임스탬프)도 그냥 보여준다.
  if (at > now) return true;
  return now - at >= DISMISS_COOLDOWN_MS;
}

/** 사용자에게 보여줄 안내 문구. 지원하지 않는 걸 지원한다고 말하지 않는다(§8). */
export function installGuideFor(cap: InstallCapability): { title: string; steps: string[] } | null {
  switch (cap) {
    case 'IOS_SAFARI':
      return {
        title: '이집을 홈 화면에 추가하면 앱처럼 바로 열 수 있어요.',
        steps: ['Safari 하단의 공유 버튼을 누르세요', '"홈 화면에 추가"를 선택하세요', '오른쪽 위 "추가"를 누르세요'],
      };
    case 'KAKAO_INAPP':
    case 'OTHER_INAPP':
      return {
        title: '홈 화면에 추가하려면 Safari 또는 Chrome에서 열어주세요.',
        steps: ['오른쪽 위 메뉴(⋮ 또는 ···)를 누르세요', '"다른 브라우저로 열기"를 선택하세요', '열린 브라우저에서 홈 화면에 추가하세요'],
      };
    default:
      return null;
  }
}
