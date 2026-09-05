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
const SCRIPT_ID = 'kakao-map-script-main';
const SDK_LIBRARIES = 'services,clusterer';
const LOAD_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 100;

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
    let poll: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // 어느 경로로 끝나든 타이머/폴링을 반드시 정리한다(§12 리스너 누수 방지).
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
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

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
      if (!apiKey) {
        done(new Error('KAKAO_SDK_NO_KEY'));
        return;
      }
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=${SDK_LIBRARIES}&autoload=false`;
      script.async = true;
      script.addEventListener('error', () => done(new Error('KAKAO_SDK_SCRIPT_ERROR')));
      document.head.appendChild(script);
    } else {
      // 다른 컴포넌트가 이미 주입해 둔 태그를 재사용한다. 두 번 넣지 않는다.
      script.addEventListener('error', () => done(new Error('KAKAO_SDK_SCRIPT_ERROR')));
    }

    poll = setInterval(() => {
      if (typeof window.kakao?.maps?.load === 'function') {
        if (poll) clearInterval(poll);
        poll = null;
        runLoad();
      }
    }, POLL_INTERVAL_MS);

    // 도메인 미등록 등으로 영영 로드되지 않는 경우 무한 대기를 막는다.
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
