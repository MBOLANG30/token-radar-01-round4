// Costed Lattice 3.0 dashboard. Renders window.TOKEN_RADAR (data.js).
// No network: every number on this page comes from the sealed snapshot run.
(function () {
  var D = window.TOKEN_RADAR;
  var $ = function (id) { return document.getElementById(id); };
  function money(n) {
    if (n === null || n === undefined) return "—";
    var a = Math.abs(n);
    var s = n < 0 ? "-$" : "$";
    if (a >= 1e9) return s + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + (n / 1e3).toFixed(1) + "K";
    return s + n.toFixed(2);
  }
  function num(n, d) { return (n === null || n === undefined) ? "—" : n.toFixed(d === undefined ? 3 : d); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Coverage + KPI strip.
  $("coverage").textContent = D.coverage.statement + " Snapshot as of " + D.snapshot_as_of + " (floor $" + D.floor_usd.toLocaleString() + ").";
  var K = D.kpi;
  $("kpi").innerHTML = [
    ["Total farm cost", money(K.total_cost_usd)],
    ["Total net EV", money(K.total_net_ev_usd)],
    ["Median ROI", K.median_roi.toFixed(2) + "x"],
    ["Positive-EV rows", K.positive_ev_rows + " / " + K.rows],
    ["Avg cost / row", money(K.avg_cost_usd)],
    ["Rows", String(K.rows)],
  ].map(function (kv) { return "<div><b>" + kv[1] + "</b><span>" + kv[0] + "</span></div>"; }).join("");

  // Validation panel — numbers as computed, good or bad.
  var V = D.validation, W = V.walkForward;
  function cell(v, label, bad) {
    return '<div class="' + (bad ? "bad" : "") + '"><b>' + v + "</b><span>" + label + "</span></div>";
  }
  $("vgrid").innerHTML =
    cell(num(V.spearmanAll), "Spearman implied vs mcap (n=" + V.spearmanN + ")") +
    cell(num(V.cvMean), "5-fold CV mean Spearman") +
    cell(V.cvFolds.map(function (f) { return num(f, 2); }).join(" · "), "CV folds 0–4") +
    cell(num(W.trainSpearman), "Walk-forward train (< " + W.cutoff + ", n=" + W.trainN + ")") +
    cell(num(W.valSpearman), "Walk-forward validation (>= " + W.cutoff + ", n=" + W.valN + ")", W.valSpearman !== null && W.valSpearman < 0.4) +
    cell(num(V.launchAuc), "Launch AUC (implied predicts token)") +
    cell(num(V.launchAucTrain), "Launch-model AUC (train)") +
    cell(String(W.excludedNoDate), "Live rows w/o listing date (excluded)");
  $("verdict").textContent = V.verdict;

  // Podium.
  $("podium").innerHTML = D.rows.slice(0, 10).map(function (r) {
    return '<li><span class="r">#' + r.rank + "</span> " + '<span class="n">' + esc(r.name) + "</span><br>" +
      '<span class="v">' + money(r.implied_value_usd) + "</span><br>" +
      '<span class="mut">TVL ' + money(r.tvl_usd) + " · cost " + money(r.cost_usd) + " · net EV " + money(r.net_ev_usd) + "</span></li>";
  }).join("");

  // Filters.
  var cats = [...new Set(D.rows.map(function (r) { return r.category || "—"; }))].sort();
  var chains = [...new Set(D.rows.flatMap(function (r) { return r.chains; }))].sort();
  $("fcat").innerHTML += cats.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");
  $("fchain").innerHTML += chains.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");

  var sortKey = "rank", sortDir = 1;
  function filtered() {
    var q = $("q").value.trim().toLowerCase();
    var cat = $("fcat").value, ch = $("fchain").value, wl = $("fwl").checked;
    return D.rows.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      if (cat && (r.category || "—") !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (wl && !r.watchlist) return false;
      return true;
    });
  }
  function render() {
    var list = filtered().slice().sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return sortDir * av.localeCompare(bv);
      return sortDir * (av - bv);
    });
    $("tbody").innerHTML = list.map(function (r) {
      var chg = r.change_7d === null ? "—" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%";
      var cls = r.change_7d === null ? "" : r.change_7d >= 0 ? "pos" : "neg";
      return "<tr data-slug=\"" + esc(r.slug) + "\"><td>" + r.rank + (r.watchlist ? " ★" : "") + "</td><td>" + esc(r.name) + "</td><td>" +
        esc(r.category || "—") + "</td><td>" + esc(r.chains[0] || "—") + "</td><td>" + money(r.tvl_usd) + '</td><td class="' + cls + '">' + chg + "</td><td>" +
        (r.age_days === null ? "—" : Math.round(r.age_days / 30) + " mo") + "</td><td>" + r.multiple.toFixed(2) + "x</td><td>" +
        money(r.implied_value_usd) + "</td><td>" + money(r.cost_usd) + "</td><td>" + money(r.net_ev_usd) + "</td><td>" + r.roi.toFixed(1) + "x</td></tr>";
    }).join("");
    $("count").textContent = list.length + " of " + D.rows.length + " rows shown.";
  }
  document.querySelectorAll("#board th").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-k");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    });
  });
  ["q", "fcat", "fchain", "fwl"].forEach(function (id) {
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  });
  render();

  // Detail dialog.
  var dlg = $("detail");
  $("tbody").addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (!tr) return;
    var r = D.rows.find(function (x) { return x.slug === tr.getAttribute("data-slug"); });
    if (!r) return;
    var recomputed = Math.max(1, Math.round(r.tvl_usd * r.comps * r.growth * r.maturity * r.p_launch * r.chain_spread * r.farm_discount));
    var recheckOk = Math.abs(recomputed - r.implied_value_usd) / r.implied_value_usd < 0.01;
    var steps = r.farm_steps.map(function (s, i) { return "<li><strong>Step " + (i + 1) + ".</strong> " + esc(s) + "</li>"; }).join("");
    $("detailBody").innerHTML =
      "<h3>#" + r.rank + " — " + esc(r.name) + (r.watchlist ? " ★ watchlist" : "") + "</h3>" +
      "<p>" + esc(r.category || "Uncategorised") + " · " + esc(r.chains.join(", ")) + " · TVL " + money(r.tvl_usd) +
      " · age " + (r.age_days === null ? "unknown" : Math.round(r.age_days / 30) + " months") + "</p>" +
      "<table><tbody>" +
      "<tr><th>Implied value</th><td>" + money(r.implied_value_usd) + "</td></tr>" +
      "<tr><th>Comps (mcap/TVL)</th><td>" + r.comps + "</td></tr>" +
      "<tr><th>Growth factor</th><td>" + r.growth + " (7d " + (r.change_7d === null ? "n/a" : r.change_7d.toFixed(1) + "%") + ")</td></tr>" +
      "<tr><th>Maturity factor</th><td>" + r.maturity + "</td></tr>" +
      "<tr><th>Launch probability</th><td>" + r.p_launch + "</td></tr>" +
      "<tr><th>Chain spread</th><td>" + r.chain_spread + "</td></tr>" +
      "<tr><th>Farm discount</th><td>" + r.farm_discount + "</td></tr>" +
      "<tr><th>Farm capital (assumed)</th><td>" + money(r.farm_capital_usd) + "</td></tr>" +
      "<tr><th>Total farm cost (est.)</th><td>" + money(r.cost_usd) + "</td></tr>" +
      "<tr><th>Net expected value</th><td>" + money(r.net_ev_usd) + " (ROI " + r.roi.toFixed(1) + "x)</td></tr>" +
      "<tr><th>Recompute check</th><td>" + money(recomputed) + (recheckOk ? " — matches the board (within 1%; factors shown rounded to 3 decimals)" : " — DIFFERS from the board") + "</td></tr>" +
      "</tbody></table><h3>Costed farm plan</h3><ol>" + steps + "</ol>";
    dlg.showModal();
  });

  // Tabs.
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      var which = tab.getAttribute("data-tab");
      $("boardWrap").hidden = which !== "pre";
      $("filters").style.display = which === "pre" ? "" : "none";
      $("liveWrap").hidden = which !== "live";
      $("compsWrap").hidden = which !== "comps";
      if (which === "live") renderLive();
      if (which === "comps") renderComps();
    });
  });
  function renderLive() {
    var live = D.live_reference || [];
    $("liveBody").innerHTML = live.map(function (r) {
      return "<tr><td>" + esc(r.name) + "</td><td>" + money(r.tvl_usd) + "</td><td>" + money(r.mcap_usd) + "</td><td>" +
        money(r.implied_usd) + "</td><td>" + r.multiple.toFixed(2) + "x</td></tr>";
    }).join("") || '<tr><td colspan="5">No live reference in this build.</td></tr>';
  }
  function renderComps() {
    $("compsBody").innerHTML = D.comps_table.map(function (c) {
      return "<tr><td>" + esc(c.category) + "</td><td>" + c.peers + "</td><td>" + c.median_mcap_tvl + "</td><td>" + c.shrunk + "</td></tr>";
    }).join("");
  }

  // Gas assumptions in the footer.
  var gas = D.assumptions.chain_gas;
  $("gasTable").innerHTML = "Assumed gas (illustrative, Nov-2026 levels — not snapshot data): " +
    Object.keys(gas).map(function (c) { return esc(c) + " — " + esc(gas[c]); }).join("; ") +
    ". Fallback chain: " + esc(D.assumptions.chain_gas_fallback) + ".";
})();
