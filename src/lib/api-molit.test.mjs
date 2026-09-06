import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCancellationFields, mapMolitItems, createMolitXmlParser, redactMolitFailureMessage, fetchMolitData } from './api-molit.ts';
import { resolveStrongIdentityAptSeqs } from './apt-name-match.ts';

// TRADE_CANCELLATION_AUDIT_V1 — 실제 live MOLIT 응답은 영문 필드명(cdealType/cdealDay/
// rgstDate)만 내려준다(2026-08-30 실측, 부산 3개구 12개월 13,716건 스캔). 과거 코드는
// 한글 필드명(해제여부/해제사유발생일/등기일자)만 확인해 항상 매칭 실패했다.

test('live 응답 영문 필드명(cdealType=O)이 취소로 인식된다', () => {
  const item = { cdealType: 'O', cdealDay: '26.08.04', rgstDate: '' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
  assert.equal(result.cancelDate, '26.08.04');
});

test('cdealType이 빈 문자열이면 정상(미취소) 거래다', () => {
  const item = { cdealType: '', cdealDay: '', rgstDate: '26.09.01' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
  assert.equal(result.cancelDate, '');
  assert.equal(result.registryDate, '26.09.01');
});

test('cdealType 필드 자체가 없으면(구버전 응답 등) 정상(미취소)으로 처리한다', () => {
  const item = { dealAmount: '65,000' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
  assert.equal(result.cancelDate, '');
  assert.equal(result.registryDate, '');
});

test('한글 필드명(해제여부/해제사유발생일)도 여전히 인식한다(하위 호환)', () => {
  const item = { 해제여부: 'O', 해제사유발생일: '20260804', 등기일자: '20260901' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
  assert.equal(result.cancelDate, '20260804');
  assert.equal(result.registryDate, '20260901');
});

test('cdealType이 O가 아닌 다른 값이면 취소로 오인하지 않는다', () => {
  const item = { cdealType: 'X' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, false);
});

test('cdealType에 공백이 섞여도(원본 오염 대비) trim 후 정확히 매칭한다', () => {
  const item = { cdealType: ' O ' };
  const result = parseCancellationFields(item);
  assert.equal(result.dealCanceled, true);
});

// APT_DETAIL_NAME_TYPE_HOTFIX — /api/apt/[name]에서 반복 발생하던
// "raw.replace is not a function"("e.replace is not a function"의 minify 이전 이름)의
// 재현 테스트. 원인은 XMLParser(parseTagValue: true)가 "숫자로만 이루어진 단지명"
// 태그 텍스트를 number로 변환하는데, mapMolitItems()의 name만 유일하게
// 문자열 정규화(.toString()) 없이 그대로 통과시킨 것이다(dong/buildYear/jibun 등
// 형제 필드는 전부 .toString().trim() 처리됨).

test('createMolitXmlParser: 단지명 태그는 숫자처럼 보여도 원본 텍스트 문자열 그대로 보존한다(선행 0 포함)', () => {
  const xml = '<response><body><items><item>'
    + '<aptNm>0101</aptNm><umdNm>서대신동3가</umdNm><excluUseAr>84.99</excluUseAr>'
    + '<dealYear>2026</dealYear><dealAmount>65,000</dealAmount><aptSeq>26140-1361</aptSeq>'
    + '</item></items></body></response>';
  const item = createMolitXmlParser().parse(xml).response.body.items.item;
  assert.equal(typeof item.aptNm, 'string');
  assert.equal(item.aptNm, '0101', '단지명은 숫자로 변환되면 안 된다(선행 0 손실 금지)');
  // 이름 외 필드의 파싱 타입은 기존과 완전히 동일해야 한다(회귀 금지).
  assert.equal(typeof item.excluUseAr, 'number');
  assert.equal(item.excluUseAr, 84.99);
  assert.equal(typeof item.dealYear, 'number');
  assert.equal(item.dealAmount, '65,000');
  assert.equal(item.aptSeq, '26140-1361');
  assert.equal(item.umdNm, '서대신동3가');
});

test('mapMolitItems: aptNm이 number로 들어와도 name은 항상 문자열이다(형제 필드와 같은 계약)', () => {
  const [mapped] = mapMolitItems(
    [{ aptNm: 101, umdNm: '우동', jibun: 763, buildYear: 2012, excluUseAr: 84.99, dealAmount: '65,000', dealYear: 2026, dealMonth: 9, dealDay: 1, aptSeq: '26350-2206' }],
    'apt',
    '26350',
    '202609'
  );
  assert.equal(typeof mapped.name, 'string');
  assert.equal(mapped.name, '101');
});

test('mapMolitItems: 예상 못한 shape(객체 등)의 단지명은 이름을 지어내지 않고 "이름 없음"으로 둔다', () => {
  const [mapped] = mapMolitItems([{ aptNm: { '@_xsi:nil': 'true' }, umdNm: '우동' }], 'apt', '26350', '202609');
  assert.equal(typeof mapped.name, 'string');
  assert.equal(mapped.name, '이름 없음');
});

test('mapMolitItems: 정상 문자열 단지명은 그대로 보존한다(회귀 확인)', () => {
  const [mapped] = mapMolitItems([{ aptNm: '해운대경동제이드', umdNm: '우동' }], 'apt', '26350', '202609');
  assert.equal(mapped.name, '해운대경동제이드');
});

test('재현: 숫자 단지명이 섞인 MOLIT 원본 XML → mapMolitItems → resolveStrongIdentityAptSeqs가 크래시 없이 정상 단지만 식별한다', () => {
  const xml = '<response><header><resultCode>00</resultCode></header><body><items>'
    + '<item><aptNm>101</aptNm><umdNm>우동</umdNm><aptSeq>26350-9999</aptSeq><excluUseAr>59.9</excluUseAr><dealAmount>30,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>1</dealDay></item>'
    + '<item><aptNm>해운대경동제이드</aptNm><umdNm>우동</umdNm><aptSeq>26350-2206</aptSeq><excluUseAr>84.99</excluUseAr><dealAmount>65,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>2</dealDay></item>'
    + '</items></body></response>';
  const rawItems = createMolitXmlParser().parse(xml).response.body.items.item;
  const items = mapMolitItems(rawItems, 'apt', '26350', '202609');
  const seqs = resolveStrongIdentityAptSeqs(items, '해운대경동제이드', '우동');
  assert.deepEqual([...seqs], ['26350-2206']);
});

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX 중 발견된 비밀값 노출 경로 회귀 방지.
// type은 쿼리스트링으로 외부에서 지정 가능한데, 알 수 없는 값이면 endpoint가 빈 문자열이
// 되어 "?serviceKey=<키>"라는 상대 URL이 만들어지고, fetch 실패 메시지("Failed to parse
// URL from ?serviceKey=...")가 그대로 apiError/ErrorLog로 흘러 인증키가 노출됐다.

test('redactMolitFailureMessage: serviceKey 값을 그대로 흘리지 않는다', () => {
  const leaked = 'Failed to parse URL from ?serviceKey=AbCd%2FEfGh%3D%3D&LAWD_CD=26350&DEAL_YMD=202609';
  const safe = redactMolitFailureMessage(leaked);
  assert.ok(!safe.includes('AbCd'), '키 값이 남아 있으면 안 된다');
  assert.ok(safe.includes('serviceKey=[redacted]'));
  assert.ok(safe.includes('LAWD_CD=26350'), '진단에 필요한 나머지 정보는 유지한다');
});

test('redactMolitFailureMessage: 전체 URL이 들어와도 마스킹한다', () => {
  const leaked = 'request to http://apis.data.go.kr/1613000/X?serviceKey=SECRETKEY&a=1 failed';
  const safe = redactMolitFailureMessage(leaked);
  assert.ok(!safe.includes('SECRETKEY'));
});

test('redactMolitFailureMessage: 비어 있거나 문자열이 아니면 일반 문구로 대체한다', () => {
  assert.equal(redactMolitFailureMessage(undefined), '알 수 없는 오류');
  assert.equal(redactMolitFailureMessage(''), '알 수 없는 오류');
});

test('fetchMolitData: 지원하지 않는 거래 유형은 URL을 만들기 전에 막고 키를 노출하지 않는다', async () => {
  // 이 테스트 환경에는 .env가 로드되지 않아 키 부재 오류가 먼저 날 수도 있다. 어느 쪽이든
  // 검증 대상은 같다: 에러 플레이스홀더 어디에도 serviceKey/키 조각이 남지 않는다.
  const result = await fetchMolitData({ type: 'bogus-type', lawdCd: '26350', dealYmd: '202609' });
  assert.equal(result.length, 1);
  assert.equal(result[0].typeLabel, '에러');
  assert.ok(
    ['API 에러: 지원하지 않는 거래 유형입니다.', 'API 에러: DATA_GO_KR_API_KEY is not defined in environment variables.'].includes(result[0].name),
    `예상치 못한 실패 메시지: ${result[0].name}`
  );
  assert.ok(!result[0].name.includes('serviceKey'));
  assert.equal(result[0].info, '공공데이터 API 호출 실패', '에러 플레이스홀더에 키 조각을 남기지 않는다');
});
