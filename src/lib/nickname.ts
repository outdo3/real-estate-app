// USER_NICKNAME_EDIT_V1 §3 — 닉네임 검증 규칙(순수 함수).
//
// 규칙은 **최소한**으로만 둔다. 금칙어 사전이나 정규식 필터를 새로 만들지 않는다 —
// 운영 기준 없이 만든 필터는 멀쩡한 이름을 막고, 막아야 할 것은 못 막는다.
//
// 중복 닉네임은 **허용한다.** User.name에는 unique 제약이 없고(스키마 확인),
// 커뮤니티도 표시명으로만 쓰므로 지금 정책을 그대로 따른다. 여기서 임의로 유일성을
// 강제하면 이미 같은 이름을 쓰고 있는 기존 사용자가 저장에 실패하게 된다.

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

/**
 * 제어문자(개행·탭·NULL 등)가 섞였는가. 표시명에 들어가면 레이아웃을 깨거나 로그를
 * 오염시킨다. C0(0x00-0x1F)와 DEL/C1(0x7F-0x9F)을 막는다.
 *
 * 정규식 문자 클래스 대신 코드 포인트로 비교한다 — 제어문자를 소스에 리터럴로 적으면
 * 에디터/도구마다 다르게 보이고 diff가 조용히 깨진다.
 */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export type NicknameValidation =
  | { valid: true; nickname: string }
  | { valid: false; error: string };

/**
 * 길이는 **코드 포인트** 기준으로 센다.
 *
 * `'가나다'.length`는 3이지만 이모지는 문자 하나가 length 2를 차지한다(surrogate pair).
 * 사용자가 보는 글자 수와 맞추려면 Array.from을 써야 한다 — 그러지 않으면 이모지 두 개가
 * "4자"로 계산돼 짧은 닉네임이 거부된다.
 */
export function nicknameLength(value: string): number {
  return Array.from(value).length;
}

/**
 * 요청 본문에서 닉네임을 검증해 **정규화된 값**을 돌려준다.
 *
 * 앞뒤 공백은 잘라낸다 — 공백만으로 된 이름이나 눈에 보이지 않는 들여쓰기가 저장되면
 * 커뮤니티 작성자명이 빈칸처럼 보인다.
 */
export function validateNickname(body: unknown): NicknameValidation {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '요청 형식이 올바르지 않습니다.' };
  }
  const raw = (body as Record<string, unknown>).nickname;
  if (typeof raw !== 'string') {
    return { valid: false, error: '닉네임을 입력해주세요.' };
  }

  const nickname = raw.trim();

  if (nickname.length === 0) {
    return { valid: false, error: '닉네임을 입력해주세요.' };
  }
  if (hasControlChar(nickname)) {
    return { valid: false, error: '닉네임에 사용할 수 없는 문자가 있습니다.' };
  }

  const length = nicknameLength(nickname);
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return {
      valid: false,
      error: `닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자로 입력해주세요.`,
    };
  }

  return { valid: true, nickname };
}
