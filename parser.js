// 네이버페이 '결제' 화면의 innerText에서 주문내역을 뽑아내는 파서.
// 클래스명은 자주 바뀌므로 화면에 보이는 텍스트 패턴만 사용한다.
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");

  const PRICE_ONLY = /^([\d,]+)\s*원$/;
  const DATE_LINE = /^(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.\s*(?:\d{1,2}:\d{2})?\s*결제/;
  const STATUS_LINE_RE = /^(배송준비중|배송중|배송완료|구매확정완료|구매확정|결제완료|취소완료|반품완료|상품준비중|발송완료|입금대기|환불완료|교환완료|출발준비중)(\s|$)/;
  const META_RE = /^(일요배송|새벽배송|배송|N\s*배송|도착보장|무료교환반품|무료반품|무료교환|결제일시|주문 상세 보기|더보기|배송조회|현재 배송 상태|발송준비|배송시작|도착예정|다시 담기|자세히 보기|추가상품|포함\s*\d+건|총|\d+|건|.*펼쳐보기|.*접기|구매확정하고.*|리뷰쓰고.*|.*적립 완료|.*도착보장|.*자동 구매확정 예정|\d+\.\d+\.\(.\).*)$/;

  // 한 줄에 합쳐지지 않은 "가격 / (결제일시) / 날짜" 를 "가격 날짜" 한 줄로 합친다.
  function normalize(text) {
    const raw = text.split(/\n+/).map(s => s.trim()).filter(s => s && s !== "|");
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (PRICE_ONLY.test(raw[i])) {
        let j = i + 1;
        if (raw[j] === "결제일시") j++;
        if (j < raw.length && DATE_LINE.test(raw[j])) { out.push({ price: raw[i], date: raw[j] }); i = j; continue; }
        // "N원 | 날짜 결제" 가 한 줄인 경우는 아래 else 에서 처리
      }
      const one = raw[i].match(/^([\d,]+\s*원)\s*\|?\s*(.*결제.*)$/);
      if (one && DATE_LINE.test(one[2])) { out.push({ price: one[1].replace(/\s+/g, ""), date: one[2] }); continue; }
      out.push(raw[i]);
    }
    return out;
  }

  function findName(items, from, to) {
    for (let k = to; k >= from; k--) {
      const c = items[k];
      if (typeof c !== "string") break;                 // 다른 가격/날짜 항목을 만나면 중단
      if (STATUS_LINE_RE.test(c)) break;                // 상태 줄을 넘으면 다른 주문
      if (META_RE.test(c) || PRICE_ONLY.test(c) || c.length < 2) continue;
      return c;
    }
    return "";
  }

  // state: { prevMonth, year } — 연도가 없는 날짜를 최신순 흐름으로 추정하기 위해 페이지 간에 이어서 쓴다.
  function parseCards(text, now, state) {
    now = now || new Date();
    state = state || { prevMonth: null, year: now.getFullYear() };
    const items = normalize(text);
    const rows = [];
    let lastDate = null;

    const resolveDate = (dm) => {
      const m = dm.match(DATE_LINE);
      const month = Number(m[2]), day = Number(m[3]);
      if (m[1]) { state.year = Number(m[1]); }
      else if (state.prevMonth === null) { state.year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear(); }
      else if (month > state.prevMonth) { state.year -= 1; }
      state.prevMonth = month;
      return `${state.year}-${pad(month)}-${pad(day)}`;
    };

    // "자세히 보기" 를 기준으로 주문 카드 단위로 나눈다
    const segs = []; let cur = null;
    items.forEach((it) => {
      if (it === "자세히 보기") { cur = []; segs.push(cur); }
      else if (cur) cur.push(it);
    });

    for (const seg of segs) {
      const di = seg.findIndex(x => typeof x === "object");
      if (di >= 0) {
        const date = resolveDate(seg[di].date);
        lastDate = date;
        const headAmount = Number(seg[di].price.replace(/[^\d]/g, ""));
        const headName = findName(seg, 0, di - 1);
        const isBundle = seg.some(x => typeof x === "string" && /^포함\s*\d+건$/.test(x));
        // 묶음 주문이 펼쳐져 있으면 상품별 행을 사용한다 (결제일 줄 이후의 '이름 + 가격')
        const children = [];
        if (isBundle) {
          for (let k = di + 1; k < seg.length; k++) {
            if (typeof seg[k] === "string" && PRICE_ONLY.test(seg[k])) {
              const nm = findName(seg, di + 1, k - 1);
              if (nm) children.push({ date, amount: Number(seg[k].replace(/[^\d]/g, "")), name: nm });
            }
          }
        }
        if (children.length) rows.push(...children);
        else if (headName && headAmount > 0) rows.push({ date, amount: headAmount, name: headName + (isBundle ? " (묶음주문 합계)" : "") });
      } else if (lastDate && seg.some(x => x === "추가상품")) {
        // 추가상품은 결제일이 따로 없으므로 바로 앞 주문의 결제일을 따른다
        const pi = seg.findIndex(x => typeof x === "string" && PRICE_ONLY.test(x));
        if (pi >= 0) {
          const nm = findName(seg, 0, pi - 1);
          if (nm) rows.push({ date: lastDate, amount: Number(seg[pi].replace(/[^\d]/g, "")), name: nm + " (추가상품)" });
        }
      }
    }
    return rows;
  }

  // ── 형식 B: 날짜 헤더(2026.10.24.) 아래 상품이 나열되는 주문내역 (보조) ────
  const DATE_RE = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/;
  function parseDateHeaders(text) {
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const rows = [];
    let curDate = null, buffer = [];
    for (const line of lines) {
      const d = line.match(DATE_RE);
      if (d && line.length <= 24) { curDate = `${d[1]}-${pad(d[2])}-${pad(d[3])}`; buffer = []; continue; }
      if (!curDate) continue;
      const p = line.match(PRICE_ONLY);
      if (p) {
        let name = "";
        for (let i = buffer.length - 1; i >= 0; i--) {
          const c = buffer[i];
          if (META_RE.test(c) || STATUS_LINE_RE.test(c) || PRICE_ONLY.test(c) || c.length < 2) continue;
          name = c; break;
        }
        const amount = Number(p[1].replace(/,/g, ""));
        if (name && amount > 0) rows.push({ date: curDate, amount, name });
        buffer = []; continue;
      }
      buffer.push(line);
    }
    return rows;
  }

  function parseText(text, now, state) {
    const a = parseCards(text, now, state);
    return a.length ? a : parseDateHeaders(text);
  }

  root.HHParser = { parseText, parseCards, parseDateHeaders };
  if (typeof module !== "undefined") module.exports = root.HHParser;
})(typeof window !== "undefined" ? window : globalThis);
