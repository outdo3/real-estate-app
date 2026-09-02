import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSearchQuery } from './search-redaction';

test('이메일이 [이메일]로 치환된다', () => {
  assert.equal(redactSearchQuery('연락처는 abc@example.com 입니다', 200), '연락처는 [이메일] 입니다');
});

test('010-1234-5678 형식 전화번호가 [전화번호]로 치환된다', () => {
  assert.equal(redactSearchQuery('010-1234-5678로 연락 가능한 해운대 아파트', 200), '[전화번호]로 연락 가능한 해운대 아파트');
});

test('하이픈 없는 01012345678도 치환된다', () => {
  assert.equal(redactSearchQuery('01012345678로 연락주세요', 200), '[전화번호]로 연락주세요');
});

test('지역번호 포함 051-123-4567도 치환된다', () => {
  assert.equal(redactSearchQuery('051-123-4567 사무실', 200), '[전화번호] 사무실');
});

test('일반 부동산 검색문은 그대로 유지된다', () => {
  assert.equal(redactSearchQuery('해운대구 84제곱미터 3억 이하 아파트', 200), '해운대구 84제곱미터 3억 이하 아파트');
});

test('금액/아파트명은 PII가 아니므로 redaction하지 않는다', () => {
  assert.equal(redactSearchQuery('대신롯데캐슬 6억 2천만원', 200), '대신롯데캐슬 6억 2천만원');
});

test('200자 초과 문자열은 redaction 이후 truncate된다', () => {
  const long = 'a'.repeat(250);
  const result = redactSearchQuery(long, 200);
  assert.equal(result.length, 200);
});

test('truncate 경계에 걸치는 전화번호도 안전하게 redaction된 뒤 잘린다(원문 노출 없음)', () => {
  const padding = 'a'.repeat(190);
  const raw = `${padding} 010-1234-5678`;
  const result = redactSearchQuery(raw, 200);
  // redaction이 먼저 일어나므로 "010-1234-5678" 원문 숫자열이 결과에 남아있으면 안 된다.
  assert.equal(/01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(result), false);
});

test('앞뒤 공백은 normalize로 제거된다', () => {
  assert.equal(redactSearchQuery('  해운대 아파트  ', 200), '해운대 아파트');
});
