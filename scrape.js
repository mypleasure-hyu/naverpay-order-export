// 네이버페이 결제 화면에 주입되어 실행된다.
// 1) '총 N건 펼쳐보기'만 클릭해 묶음 주문을 펼치고  2) 현재 페이지를 파싱한 뒤  3) 다음 페이지 번호로 넘어간다.
// 삭제/더보기 메뉴 등 다른 버튼은 절대 클릭하지 않는다.
(function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (el) => (el.innerText || el.textContent || "").trim();

  function expandBundles() {
    const els = [...document.querySelectorAll("button, a, [role=button]")]
      .filter(b => /^총\s*\d+\s*건\s*펼쳐보기$/.test(txt(b).replace(/\s+/g, " ")) && b.offsetParent !== null);
    els.forEach(b => b.click());
    return els.length;
  }

  // 주문 목록 페이지 번호 영역: "페이지 중", "처음", "마지막" 이 모두 들어 있는 가장 작은 요소
  function pager() {
    const cands = [...document.querySelectorAll("div, nav, section, ul")]
      .filter(e => { const t = txt(e); return t.includes("페이지 중") && t.includes("처음") && t.includes("마지막"); });
    if (!cands.length) return null;
    return cands.reduce((a, b) => (txt(a).length <= txt(b).length ? a : b));
  }

  function pageButtons(p) {
    return [...p.querySelectorAll("button, a, [role=button]")];
  }

  function numberOf(btn) {
    const m = txt(btn).replace(/\s+/g, " ").match(/페이지 중 (\d+) 페이지/);
    return m ? Number(m[1]) : null;
  }

  function totalPages(p) {
    const m = txt(p).replace(/\s+/g, " ").match(/(\d+)\s*페이지 중/);
    return m ? Number(m[1]) : null;
  }

  async function waitChange(sigFn, before, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(250);
      if (sigFn() !== before) { await sleep(500); return true; }
    }
    return false;
  }

  function signature() {
    const P = window.HHParser;
    return P.parseCards(document.body.innerText, new Date(), { prevMonth: null, year: new Date().getFullYear() })
      .map(r => r.date + r.amount + r.name).join("|");
  }

  async function goTo(n, waitMs) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const p = pager(); if (!p) return false;
      const target = pageButtons(p).find(b => numberOf(b) === n);
      if (target) { const sig = signature(); target.click(); await waitChange(signature, sig, waitMs || 6000); return true; }
      // 번호가 보이지 않으면 '다음 페이지'(번호 묶음 이동)를 눌러본다
      const next = pageButtons(p).find(b => /다음\s*페이지/.test(txt(b)) && !b.disabled);
      if (!next) return false;
      next.click(); await sleep(900);
    }
    return false;
  }

  window.__hhScrape = async function (startStr, endStr) {
    const P = window.HHParser;
    const log = [];
    const p0 = pager();
    const total = p0 ? (totalPages(p0) || 1) : 1;
    if (p0) await goTo(1, 2000); // 1페이지에서 시작 (이미 1페이지면 변화 없이 2초 후 진행)

    const state = { prevMonth: null, year: new Date().getFullYear() };
    const all = [];
    for (let page = 1; page <= Math.min(total, 200); page++) {
      expandBundles(); await sleep(700); expandBundles(); await sleep(400);
      const rows = P.parseText(document.body.innerText, new Date(), state);
      all.push(...rows);
      log.push(`p${page}:${rows.length}`);
      const oldest = rows.length ? rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date) : null;
      if (oldest && oldest < startStr) break;      // 시작일보다 오래된 주문에 도달
      if (page >= total) break;
      if (!(await goTo(page + 1))) break;
    }
    const rows = all.filter(r => r.date >= startStr && r.date <= endStr);
    return { rows, totalParsed: all.length, pages: log.join(" "), url: location.href };
  };

  // 진단용: 화면 텍스트
  window.__hhDump = function () { return document.body.innerText.slice(0, 30000); };
})();
