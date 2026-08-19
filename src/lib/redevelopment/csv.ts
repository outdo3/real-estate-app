// 국토부 CSV 전용 최소 RFC4180 파서 — 이 프로젝트에 CSV 라이브러리 의존성이 없고
// 컬럼이 7개로 고정돼 있어(R1/R2 실측) 새 패키지를 추가할 만큼의 복잡도가 아니다.
// 따옴표로 감싼 필드(콤마/줄바꿈 포함 가능)와 ""이스케이프만 지원한다.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // \r\n의 \r은 무시하고 다음 \n에서 행을 끊는다
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // 마지막 행에 개행이 없는 경우
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
