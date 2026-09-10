// OFFICETEL_V1 STEP 6 §12 — 카카오 지도 SDK 로더 (단일 지점).
//
// 이 앱에는 지도를 쓰는 화면이 여럿이고(지도 탭, 상세 지도/로드뷰, 분양, 통계, 버스,
// 자동완성 …) 각자 같은 로직을 복붙해 두고 있었다. 스크립트 id(`kakao-map-script-main`)를
// 공유하는 관례 덕에 태그가 중복 주입되지는 않았지만, "로드됐는지"를 컴포넌트마다
// 200ms 폴링으로 각자 판정해서 토글할 때마다 불필요한 대기가 생겼다.
//
// 여기서는 **프로미스 하나를 캐시**한다. 두 번째 호출부터는 네트워크도 폴링도 없이
// 즉시 resolve되므로 지도↔로드뷰 전환에서 SDK를 다시 기다리지 않는다.
//
// 스크립트 src는 기존 KakaoMapEmbed가 쓰던 문자열을 **그대로** 유지한다. 라이브러리
// 목록을 바꾸면 같은 id를 재사용하는 다른 화면의 로딩 동작까지 바뀌므로, 이번 STEP에서
// 건드리지 않는다.
// PERCEIVED_PERFORMANCE_V2_5 §5 — 부트 스크립트(map/layout.tsx)가 **같은 id로** 태그를
// 먼저 심을 수 있게 id를 내보낸다. 같은 id를 쓰면 아래 로더가 기존 태그를 재사용하므로
// 스크립트가 두 번 주입되지 않는다(단일 로드 보장은 여전히 이 파일이 가진다).
export const KAKAO_SDK_SCRIPT_ID = 'kakao-map-script-main';
const SCRIPT_ID = KAKAO_SDK_SCRIPT_ID;
const SDK_LIBRARIES = 'services,clusterer';
const LOAD_TIMEOUT_MS = 10000;

/**
 * PERCEIVED_PERFORMANCE_V2_2 §5 — 로더가 주입할 스크립트 URL을 만드는 **단일 지점**.
 *
 * `/map` 라우트가 이 URL로 `<link rel="preload" as="script">`를 HTML에 심어, 브라우저가
 * hydration을 기다리지 않고 HTML 파싱 중에 SDK를 내려받기 시작하게 한다. 실측(배포 전,
 * n=4): 스크립트 요청이 1,133ms에야 시작됐는데 그건 이 로더가 effect 안에서 호출되기
 * 때문이다(=hydration 이후). 다운로드 자체는 125ms밖에 안 걸린다(preconnect 덕).
 *
 * preload와 실제 주입 URL이 **한 글자라도 다르면 브라우저가 두 번 받는다.** 그래서
 * 양쪽이 반드시 이 함수를 쓴다. 키가 없으면 null — preload를 심지 않는다.
 */
export function kakaoMapsSdkUrl(): string | null {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
  if (!apiKey) return null;
  return `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=${SDK_LIBRARIES}&autoload=false`;
}

/** 실패 원인을 사람이 읽을 문구로 바꾸기 위한 안정적인 코드. */
export type KakaoSdkErrorCode =
  | 'KAKAO_SDK_NO_WINDOW'
  | 'KAKAO_SDK_NO_KEY'
  | 'KAKAO_SDK_SCRIPT_ERROR'
  | 'KAKAO_SDK_TIMEOUT';

let sdkPromise: Promise<void> | null = null;

/**
 * 카카오 지도 SDK를 **한 번만** 로드한다. 이미 준비됐으면 즉시 resolve.
 * 실패하면 캐시를 비워 다음 호출이 다시 시도할 수 있게 한다.
 */
export function loadKakaoMapsSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('KAKAO_SDK_NO_WINDOW'));
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // 어느 경로로 끝나든 타이머를 반드시 정리한다(§12 리스너 누수 방지).
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    // autoload=false 로 받았으므로 maps.load()를 호출해야 실제 모듈이 준비된다.
    const runLoad = () => {
      window.kakao.maps.load(() => done());
    };

    if (typeof window.kakao?.maps?.load === 'function') {
      runLoad();
      return;
    }

    // PERCEIVED_PERFORMANCE_V2 §5 — 예전에는 여기서 100ms 간격 setInterval로
    // `kakao.maps.load`가 생겼는지 확인했다. 폴링은 준비 완료와 감지 사이에 평균
    // 반주기(50ms), 최악 한 주기(100ms)의 고정 지연을 만든다. 스크립트 태그의 `load`
    // 이벤트는 그 지연 없이 정확한 시점을 알려주므로 폴링을 걷어낸다.
    //
    // 이미 로드가 끝난 경우는 위의 동기 검사(`typeof window.kakao?.maps?.load`)가
    // 잡아낸다 — SDK 스크립트는 실행되는 즉시 `window.kakao`를 채우므로 "load는
    // 끝났는데 window.kakao가 아직 없는" 중간 상태가 존재하지 않는다. 따라서
    // 동기 검사 + load 이벤트 두 가지로 모든 정상 경로가 덮인다.
    const onScriptLoad = () => {
      if (typeof window.kakao?.maps?.load === 'function') runLoad();
      else done(new Error('KAKAO_SDK_SCRIPT_ERROR'));
    };

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      const src = kakaoMapsSdkUrl();
      if (!src) {
        done(new Error('KAKAO_SDK_NO_KEY'));
        return;
      }
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      // preload와 **완전히 동일한** URL이어야 브라우저가 받아둔 것을 재사용한다.
      script.src = src;
      script.async = true;
      script.addEventListener('load', onScriptLoad);
      script.addEventListener('error', () => done(new Error('KAKAO_SDK_SCRIPT_ERROR')));
      document.head.appendChild(script);
    } else {
      // 다른 컴포넌트가 이미 주입해 둔 태그를 재사용한다. 두 번 넣지 않는다.
      script.addEventListener('load', onScriptLoad);
      script.addEventListener('error', () => done(new Error('KAKAO_SDK_SCRIPT_ERROR')));
    }

    // 도메인 미등록 등으로 영영 로드되지 않는 경우 무한 대기를 막는다.
    // (폴링을 없앤 뒤에도 이 타임아웃은 그대로 최후의 안전장치로 남는다.)
    timer = setTimeout(() => done(new Error('KAKAO_SDK_TIMEOUT')), LOAD_TIMEOUT_MS);
  });

  sdkPromise = attempt.catch((e) => {
    sdkPromise = null;
    throw e;
  });
  return sdkPromise;
}

/** 테스트/복구용 — 캐시된 로드 결과를 버린다. */
export function resetKakaoMapsSdkCacheForTest(): void {
  sdkPromise = null;
}
