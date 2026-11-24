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

// 1. SDK 정상 로딩 테스트
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

// 2. 콜백 미실행 시 타임아웃 테스트 (무한 대기 방지)
test('SDK times out with KAKAO_SDK_TIMEOUT when kakao.maps.load callback is never executed', async () => {
  const { windowMock, documentMock } = createMockDom();

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

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  let timerCallback = null;
  let timerDelay = null;

  globalThis.setTimeout = (cb, delay) => {
    timerCallback = cb;
    timerDelay = delay;
    return 12345;
  };
  globalThis.clearTimeout = () => {};

  try {
    globalThis.window = windowMock;
    globalThis.document = documentMock;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = 'test_key';

    const { loadKakaoMapsSdk, resetKakaoMapsSdkCacheForTest } = loadTs('../src/lib/kakao/maps-sdk.ts');
    resetKakaoMapsSdkCacheForTest();

    const promise = loadKakaoMapsSdk();

    assert.equal(timerDelay, 10000, 'timeout timer must be set to 10000ms');
    assert.ok(timerCallback, 'timeout callback must be registered');

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

// 3. 중복 초기화 및 재시도 테스트
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

    await assert.rejects(loadKakaoMapsSdk(), /Simulated load error/);

    failFirst = false;
    const p1 = loadKakaoMapsSdk();
    const p2 = loadKakaoMapsSdk();

    assert.equal(p1, p2, 'concurrent calls must share the same cached promise');

    await p1;
    await p2;

    const p3 = loadKakaoMapsSdk();
    assert.equal(p1, p3, 'call after success must return cached promise');
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});

// 4. 최초 스크립트 주입 및 load 이벤트 경로 테스트
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

    assert.equal(scriptElement.id, 'kakao-map-script-main');
    assert.ok(scriptElement.src.includes('appkey=test_key'));

    windowMock.kakao = {
      maps: {
        load(callback) {
          callback();
        }
      }
    };

    scriptElement.trigger('load');
    await promise;

    assert.equal(scriptElement.listenerCount('load'), 0, 'load listener should be cleaned up');
    assert.equal(scriptElement.listenerCount('error'), 0, 'error listener should be cleaned up');
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = prevEnv;
  }
});
