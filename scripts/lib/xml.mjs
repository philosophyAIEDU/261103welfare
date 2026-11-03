// 공공데이터포털 응답용 최소 XML 파서 (속성 없음, 중첩 요소, 반복 태그 → 배열)
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code === 13 ? '\n' : String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** XML 문자열 → { rootName: value } 객체. 자식 요소가 없으면 문자열, 같은 태그가 반복되면 배열. */
export function parseXml(xml) {
  let i = 0;
  const src = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');

  function parseNode() {
    // src[i] === '<'
    const open = src.indexOf('>', i);
    let tag = src.slice(i + 1, open).trim();
    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1).trim();
    const name = tag.split(/\s+/)[0];
    i = open + 1;
    if (selfClosing) return [name, ''];

    const children = {};
    let text = '';
    let hasChild = false;
    while (i < src.length) {
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i);
        text += src.slice(i + 9, end);
        i = end + 3;
      } else if (src.startsWith('</', i)) {
        i = src.indexOf('>', i) + 1;
        break;
      } else if (src[i] === '<') {
        hasChild = true;
        const [cn, cv] = parseNode();
        if (cn in children) {
          if (!Array.isArray(children[cn]) || !children[cn].__multi) {
            const arr = [children[cn]];
            Object.defineProperty(arr, '__multi', { value: true });
            children[cn] = arr;
          }
          children[cn].push(cv);
        } else {
          children[cn] = cv;
        }
      } else {
        const next = src.indexOf('<', i);
        text += src.slice(i, next === -1 ? src.length : next);
        i = next === -1 ? src.length : next;
      }
    }
    if (hasChild) {
      for (const k of Object.keys(children)) {
        if (Array.isArray(children[k])) children[k] = [...children[k]];
      }
      return [name, children];
    }
    return [name, decodeEntities(text).trim()];
  }

  while (i < src.length && src[i] !== '<') i++;
  if (i >= src.length) return {};
  const [name, value] = parseNode();
  return { [name]: value };
}

/** 값이 하나여도 항상 배열로 */
export const asArray = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);
