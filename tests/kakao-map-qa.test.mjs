import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTs(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, createRequire(url));
  return module.exports;
}

// 1. CSP 검증 테스트
test('CSP allows Kakao secondary script host t1.kakaocdn.net without global relaxations', () => {
  const proxySrc = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  assert.ok(
    proxySrc.includes("https://t1.kakaocdn.net"),
    'CSP script-src must include https://t1.kakaocdn.net'
  );
  assert.doesNotMatch(
    proxySrc,
    /'unsafe-eval'/,
    'CSP must not include unsafe-eval'
  );

  // script-src 호스트 검증
  const cspMatch = proxySrc.match(/script-src[^"]+/);
  assert.ok(cspMatch, 'script-src directive found');
  const scriptSrc = cspMatch[0];
  assert.ok(scriptSrc.includes('https://t1.kakaocdn.net'), 'script-src contains t1.kakaocdn.net');
  assert.ok(scriptSrc.includes('https://dapi.kakao.com'), 'script-src contains dapi.kakao.com');
  assert.ok(scriptSrc.includes('https://*.daumcdn.net'), 'script-src contains daumcdn.net');
  assert.ok(scriptSrc.includes('https://*.daum.net'), 'script-src contains daum.net');
});

// Mock DOM 환경 구축 헬퍼
function createMockDom() {
  const listeners = new Map();
  const elements = new Map();

  const scriptElement = {
    id: '',
    src: '',
    async: false,
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeEventListener(event, handler) {
      if (listeners.has(event)) {
        const list = listeners.get(event).filter(h => h !== handler);
        listeners.set(event, list);
      }
    },
    trigger(event) {
      const list = listeners.get(event) || [];
      for (const handler of [...list]) handler();
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    }
  };

  const documentMock = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tag) {
      if (tag === 'script') return scriptElement;
      return {};
    },
    head: {
      appendChild(el) {
        if (el.id) elements.set(el.id, el);
      }
    }
  };

  const windowMock = {
    document: documentMock,
    kakao: undefined,
  };

  return { windowMock, documentMock, scriptElement };
}

// 2. SDK 정상 로딩 테스트 (kakao.maps.load 콜백 정상 실행)
test('SDK resolves when kakao.maps.load is already present and callback executes', async () => {
  const { windowMock, documentMock } = createMockDom();
  let loadCallbackExecuted = false;

  windowMock.kakao = {
    maps: {
      load(callback) {
        loadCallbackExecuted = true;
        callback();
      }
    }
  };

  // Mock global window/document
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevEnv = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

  try {
    globalThis.window = windowMock;
    globalThis.document = documentMock;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = 'test_key';

    const { loadKakaoMapsSdk, resetKakaoMapsSdkCacheForTest } = loadTs('../src/lib/kakao/maps-sdk.ts');
    resetKakaoMapsSdkCacheForTest();

    await loadKakaoMapsSdk();
    assert.equal(loadCallbackExecuted, true, 'kakao.maps.load callback should have executed');
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});

// 3. 콜백 미실행 시 타임아웃 테스트 (kakao.maps.load 콜백이 호출되지 않을 때)
test('SDK times out with KAKAO_SDK_TIMEOUT when kakao.maps.load callback is never executed', async () => {
  const { windowMock, documentMock } = createMockDom();

  // load 함수는 존재하지만 콜백을 영영 호출하지 않는 시나리오
  windowMock.kakao = {
    maps: {
      load(_callback) {
        // never calls callback
      }
    }
  };

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevEnv = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

  // 타이머를 빠르게 테스트하기 위해 setTimeout을 가상 타이머로 제어
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  let timerCallback = null;
  let timerDelay = null;
  let timerCleared = false;

  globalThis.setTimeout = (cb, delay) => {
    timerCallback = cb;
    timerDelay = delay;
    return 12345;
  };
  globalThis.clearTimeout = (id) => {
    if (id === 12345) timerCleared = true;
  };

  try {
    globalThis.window = windowMock;
    globalThis.document = documentMock;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = 'test_key';

    const { loadKakaoMapsSdk, resetKakaoMapsSdkCacheForTest } = loadTs('../src/lib/kakao/maps-sdk.ts');
    resetKakaoMapsSdkCacheForTest();

    const promise = loadKakaoMapsSdk();

    // 10초(10000ms) 타이머가 등록되었는지 확인
    assert.equal(timerDelay, 10000, 'timeout timer must be set to 10000ms');
    assert.ok(timerCallback, 'timeout callback must be registered');

    // 타임아웃 트리거
    timerCallback();

    await assert.rejects(
      promise,
      /KAKAO_SDK_TIMEOUT/,
      'should reject with KAKAO_SDK_TIMEOUT when callback never fires'
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});

// 4. 중복 초기화 및 재시도 테스트
test('SDK caches promise on success and allows retry after failure', async () => {
  const { windowMock, documentMock } = createMockDom();
  let failFirst = true;

  windowMock.kakao = {
    maps: {
      load(callback) {
        if (failFirst) {
          throw new Error('Simulated load error');
        }
        callback();
      }
    }
  };

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevEnv = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

  try {
    globalThis.window = windowMock;
    globalThis.document = documentMock;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = 'test_key';

    const { loadKakaoMapsSdk, resetKakaoMapsSdkCacheForTest } = loadTs('../src/lib/kakao/maps-sdk.ts');
    resetKakaoMapsSdkCacheForTest();

    // 1회차: 실패
    await assert.rejects(loadKakaoMapsSdk(), /Simulated load error/);

    // 실패 후 캐시가 비워져 재시도 가능해야 함
    failFirst = false;
    const p1 = loadKakaoMapsSdk();
    const p2 = loadKakaoMapsSdk();

    // 중복 초기화 방지: 동일한 Promise 인스턴스가 반환되어야 함
    assert.equal(p1, p2, 'concurrent calls must share the same cached promise');

    await p1;
    await p2;

    // 성공 후 추가 호출도 캐시된 Promise 반환
    const p3 = loadKakaoMapsSdk();
    assert.equal(p1, p3, 'call after success must return cached promise');
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});

// 5. 최초 스크립트 주입 및 load 이벤트 경로 테스트
test('SDK injects script and resolves after script load event triggers kakao.maps.load', async () => {
  const { windowMock, documentMock, scriptElement } = createMockDom();

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevEnv = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

  try {
    globalThis.window = windowMock;
    globalThis.document = documentMock;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = 'test_key';

    const { loadKakaoMapsSdk, resetKakaoMapsSdkCacheForTest } = loadTs('../src/lib/kakao/maps-sdk.ts');
    resetKakaoMapsSdkCacheForTest();

    const promise = loadKakaoMapsSdk();

    // 스크립트가 DOM에 주입되었는지 확인
    assert.equal(scriptElement.id, 'kakao-map-script-main');
    assert.ok(scriptElement.src.includes('appkey=test_key'));

    // 스크립트 실행 결과로 window.kakao가 채워지고 load 이벤트 발생
    windowMock.kakao = {
      maps: {
        load(callback) {
          callback();
        }
      }
    };

    scriptElement.trigger('load');
    await promise;

    // cleanup 확인: 이벤트 리스너가 제거되었는지 확인
    assert.equal(scriptElement.listenerCount('load'), 0, 'load listener should be cleaned up');
    assert.equal(scriptElement.listenerCount('error'), 0, 'error listener should be cleaned up');
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});
