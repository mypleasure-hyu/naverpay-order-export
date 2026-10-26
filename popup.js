const $ = (id) => document.getElementById(id);
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function setPreset(p) {
  const now = new Date();
  let s, e = now;
  if (p === "thisMonth") s = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (p === "lastMonth") { s = new Date(now.getFullYear(), now.getMonth() - 1, 1); e = new Date(now.getFullYear(), now.getMonth(), 0); }
  else { s = new Date(now); s.setDate(s.getDate() - Number(p)); }
  $("start").value = fmt(s);
  $("end").value = fmt(e);
}
document.querySelectorAll(".presets button").forEach(b => b.onclick = () => setPreset(b.dataset.p));
setPreset("thisMonth");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(order\.)?pay\.naver\.com\//.test(tab.url || "")) {
    throw new Error("네이버페이 주문내역 페이지(order.pay.naver.com)를 연 상태에서 눌러주세요.");
  }
  return tab;
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["parser.js", "scrape.js"] });
}

$("go").onclick = async () => {
  const start = $("start").value, end = $("end").value;
  if (!start || !end || start > end) { $("msg").textContent = "기간을 확인해주세요."; return; }
  $("go").disabled = true;
  $("msg").textContent = "불러오는 중… (페이지가 자동으로 넘어갑니다. 창을 닫지 말고 기다려주세요)";
  try {
    const tab = await activeTab();
    await inject(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (s, e) => window.__hhScrape(s, e),
      args: [start, end],
    });
    const rows = result.rows;
    if (!rows.length) {
      $("msg").textContent = `조회된 내역이 없습니다. (페이지에서 인식한 전체 ${result.totalParsed}건)\n아래 '진단' 버튼으로 화면 텍스트를 복사해 이슈에 첨부해주세요.`;
      return;
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const aoa = [["일자", "금액", "상품명"], ...rows.map(r => [r.date, r.amount, r.name])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 60 }];
    for (let i = 2; i <= aoa.length; i++) { const c = ws["B" + i]; if (c) c.z = "#,##0"; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "구매내역");
    XLSX.writeFile(wb, `구매내역_${start}_${end}.xlsx`);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    $("msg").textContent = `완료: ${rows.length}건, 합계 ${total.toLocaleString()}원\n(읽은 페이지 ${result.pages})`;
  } catch (err) {
    $("msg").textContent = "오류: " + err.message;
  } finally {
    $("go").disabled = false;
  }
};

$("dump").onclick = async () => {
  try {
    const tab = await activeTab();
    await inject(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__hhDump() });
    await navigator.clipboard.writeText(result);
    $("msg").textContent = "화면 텍스트를 복사했습니다. 개인정보를 확인한 뒤 이슈에 첨부해주세요.";
  } catch (err) {
    $("msg").textContent = "오류: " + err.message;
  }
};
