(function () {
  "use strict";

  const STATUS_OPTIONS = window.STATUS_OPTIONS || [
    "New", "Follow up", "Warm",
    "Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid",
    "Cold",
  ];
  const HV_PIPELINE_STATUSES = window.HV_PIPELINE_STATUSES || [
    "Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid",
  ];
  const HV_PAGE_SIZE = 15;
  const NAV_MAPPING = "__mapping__";
  const NAV_OVERVIEW = "__overview__";
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const slug = (s) => s.replace(/\s+/g, "-");
  const toDateOnly = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const now = new Date();

  const state = {
    leads: [],
    meta: { months: [], areas: [], unassigned_campaign_count: 0 },
    campaignMap: [],
    selectedNav: null,
    selectedMonth: "all",
    selectedCampaign: "all",
    selectedStatus: "all",
    selectedSubTab: "dashboard",
    hvStatusFilter: "all",
    hvTablePage: 1,
    calendarMonth: { year: now.getFullYear(), month: now.getMonth() },
    ovStatusFilter: "all",
    dashDateFrom: "",
    dashDateTo: "",
    fbLeadsUnlocked: false,
  };

  let chartInstance = null;

  const el = (sel) => document.querySelector(sel);
  const create = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(c));
    return node;
  };
  const text = (s) => document.createTextNode(s ?? "");

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = el("#saveToast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 250);
    }, 1600);
  }

  async function loadAll() {
    const [meta, leads, campaignMap] = await Promise.all([
      fetchJSON("/api/meta"),
      fetchJSON("/api/leads"),
      fetchJSON("/api/campaign-map"),
    ]);
    state.meta = meta;
    state.leads = leads;
    state.campaignMap = campaignMap;

    if (state.selectedNav === null && meta.areas.length) {
      state.selectedNav = meta.areas[0].name;
    }
    render();
  }

  function render() {
    el("#lastCreated").textContent = state.meta.last_created || "—";
    el("#lastUpdated").textContent = state.meta.last_updated || "—";
    el("#kpiUnassigned").textContent = state.meta.unassigned_campaign_count;
    el("#footerTotalLeads").textContent = state.leads.length;
    el("#footerPeriod").textContent = monthLabel(state.selectedMonth);

    renderSidebarNav();
    renderFilters();
    renderSubTabBar();
    renderContent();
  }

  function monthLabel(value) {
    if (value === "all") return "All months";
    const m = state.meta.months.find((x) => x.value === value);
    return m ? m.label : value;
  }

  // ---------- Sidebar nav ----------

  function selectNav(name) {
    state.selectedNav = name;
    state.selectedCampaign = "all";
    state.selectedStatus = "all";
    state.hvStatusFilter = "all";
    state.hvTablePage = 1;
    state.dashDateFrom = "";
    state.dashDateTo = "";
    render();
  }

  function renderSidebarNav() {
    const nav = el("#sidebarNav");
    nav.innerHTML = "";

    let idx = 0;
    const addNavItem = (navKey, label, count, badge) => {
      idx += 1;
      const children = [
        create("span", { class: "nav-num" }, [text(String(idx).padStart(2, "0"))]),
        create("span", { class: "nav-label" }, [text(label)]),
      ];
      if (count !== null && count !== undefined) {
        children.push(create("span", { class: "nav-count num" }, [text(String(count))]));
      }
      if (badge) {
        children.push(create("span", { class: "nav-badge" }, [text(String(badge))]));
      }
      nav.appendChild(create(
        "button",
        { class: "nav-item" + (state.selectedNav === navKey ? " active" : ""), onclick: () => selectNav(navKey) },
        children
      ));
    };

    addNavItem(NAV_OVERVIEW, "Overview", state.leads.length);
    state.meta.areas.forEach((a) => addNavItem(a.name, a.name, a.count));
    addNavItem(NAV_MAPPING, "Campaign-Area Mapping", null, state.meta.unassigned_campaign_count || null);

    const titles = { [NAV_MAPPING]: "Campaign-Area Mapping", [NAV_OVERVIEW]: "Overview" };
    el("#pageTitle").textContent = titles[state.selectedNav] || state.selectedNav || "Facebook Leads";
  }

  // ---------- Filters ----------

  function renderFilters() {
    const isSpecial = state.selectedNav === NAV_MAPPING || state.selectedNav === NAV_OVERVIEW;
    const showFilters = !isSpecial && state.leads.length > 0;
    el("#filterBar").classList.toggle("hidden", !showFilters);
    el("#subTabs").classList.toggle("hidden", !showFilters);
    if (!showFilters) return;

    // Dashboard uses its own local date-range filter instead (different
    // date dimension question than "which month was this lead created").
    el("#monthFilterField").classList.toggle("hidden", state.selectedSubTab === "dashboard");
    // Home Visit tab's membership is driven by status (must be one of the
    // 3 HV pipeline stages) and has its own local status filter for that -
    // the global Status filter would otherwise always show zero results.
    el("#statusFilterField").classList.toggle("hidden", state.selectedSubTab === "homevisit");

    const monthSel = el("#monthFilter");
    const currentMonth = state.selectedMonth;
    monthSel.innerHTML = "";
    monthSel.appendChild(create("option", { value: "all" }, [text("All months")]));
    state.meta.months.forEach((m) => monthSel.appendChild(create("option", { value: m.value }, [text(m.label)])));
    monthSel.value = state.meta.months.some((m) => m.value === currentMonth) || currentMonth === "all" ? currentMonth : "all";
    state.selectedMonth = monthSel.value;

    const campaignNames = [...new Set(
      state.leads.filter((l) => l.area === state.selectedNav).map((l) => l.campaign_name).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
    const campaignSel = el("#campaignFilter");
    const currentCampaign = state.selectedCampaign;
    campaignSel.innerHTML = "";
    campaignSel.appendChild(create("option", { value: "all" }, [text("All campaigns")]));
    campaignNames.forEach((name) => campaignSel.appendChild(create("option", { value: name }, [text(name)])));
    campaignSel.value = campaignNames.includes(currentCampaign) || currentCampaign === "all" ? currentCampaign : "all";
    state.selectedCampaign = campaignSel.value;

    const statusSel = el("#statusFilter");
    statusSel.innerHTML = "";
    statusSel.appendChild(create("option", { value: "all" }, [text("All statuses")]));
    STATUS_OPTIONS.forEach((s) => statusSel.appendChild(create("option", { value: s }, [text(s)])));
    statusSel.value = state.selectedStatus;
  }

  function setupFilterBar() {
    el("#monthFilter").addEventListener("change", (e) => {
      state.selectedMonth = e.target.value;
      state.hvTablePage = 1;
      el("#footerPeriod").textContent = monthLabel(state.selectedMonth);
      renderContent();
    });
    el("#campaignFilter").addEventListener("change", (e) => {
      state.selectedCampaign = e.target.value;
      state.hvTablePage = 1;
      renderContent();
    });
    el("#statusFilter").addEventListener("change", (e) => {
      state.selectedStatus = e.target.value;
      renderContent();
    });
    el("#clearFilters").addEventListener("click", (e) => {
      e.preventDefault();
      state.selectedMonth = "all";
      state.selectedCampaign = "all";
      state.selectedStatus = "all";
      state.hvTablePage = 1;
      render();
    });
  }

  function renderSubTabBar() {
    document.querySelectorAll("#subTabs .tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.subtab === state.selectedSubTab);
    });
  }

  function setupSubTabs() {
    document.querySelectorAll("#subTabs .tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedSubTab = btn.dataset.subtab;
        renderSubTabBar();
        renderFilters();
        renderContent();
      });
    });
  }

  // ---------- Content ----------

  function leadsForView() {
    return state.leads.filter((l) => {
      if (l.area !== state.selectedNav) return false;
      if (state.selectedMonth !== "all" && l.created_month !== state.selectedMonth) return false;
      if (state.selectedCampaign !== "all" && l.campaign_name !== state.selectedCampaign) return false;
      if (state.selectedStatus !== "all" && l.status !== state.selectedStatus) return false;
      return true;
    });
  }

  function leadsForArea() {
    return state.leads.filter((l) => l.area === state.selectedNav);
  }

  // Home Visit tab membership is driven by the main status (must be one of
  // the 3 HV pipeline stages), not the global Status filter - a lead with
  // status "New" should never make the global filter zero-out this tab.
  function leadsForHomeVisit() {
    return state.leads.filter((l) => {
      if (l.area !== state.selectedNav) return false;
      if (!HV_PIPELINE_STATUSES.includes(l.status)) return false;
      if (state.selectedMonth !== "all" && l.created_month !== state.selectedMonth) return false;
      if (state.selectedCampaign !== "all" && l.campaign_name !== state.selectedCampaign) return false;
      return true;
    });
  }

  function renderContent() {
    const content = el("#content");
    content.querySelectorAll(".panel").forEach((n) => n.remove());

    if (state.selectedNav === NAV_MAPPING) {
      el("#emptyState").classList.add("hidden");
      renderMappingTab();
      return;
    }

    if (!state.leads.length) {
      el("#emptyState").classList.remove("hidden");
      return;
    }
    el("#emptyState").classList.add("hidden");

    if (state.selectedNav === NAV_OVERVIEW) {
      renderOverviewTab();
      return;
    }

    if (state.selectedSubTab === "dashboard") {
      renderDashboard();
      return;
    }

    if (state.selectedSubTab === "tracking") {
      const filtered = leadsForView();
      el("#kpiLeadsInView").textContent = filtered.length;
      renderClientTracking(filtered);
    } else {
      const hvLeads = leadsForHomeVisit();
      el("#kpiLeadsInView").textContent = hvLeads.length;
      renderHomeVisitTab(hvLeads);
    }
  }

  // ---------- Dashboard sub-tab (overall view for the current area) ----------

  const CAMPAIGN_COLORS = ["#BB4B25", "#5C7A52", "#A6771F", "#AB4230", "#8A3A1E", "#726C62"];

  // Dashboard uses its own date-range period (a different question than
  // "which month was this lead created", the global Month filter) but
  // still respects the shared Campaign/Status filters.
  function leadsForDashboard() {
    return leadsForArea().filter((l) => {
      if (state.selectedCampaign !== "all" && l.campaign_name !== state.selectedCampaign) return false;
      if (state.selectedStatus !== "all" && l.status !== state.selectedStatus) return false;
      if (state.dashDateFrom && l.created_date < state.dashDateFrom) return false;
      if (state.dashDateTo && l.created_date > state.dashDateTo) return false;
      return true;
    });
  }

  function dashboardPeriodLabel() {
    if (!state.dashDateFrom && !state.dashDateTo) return "All time";
    if (state.dashDateFrom && state.dashDateTo) return `${state.dashDateFrom} to ${state.dashDateTo}`;
    if (state.dashDateFrom) return `From ${state.dashDateFrom}`;
    return `Through ${state.dashDateTo}`;
  }

  function buildDashboardDateRangeField() {
    const fromInput = create("input", { type: "date", value: state.dashDateFrom });
    const toInput = create("input", { type: "date", value: state.dashDateTo });
    fromInput.addEventListener("change", () => { state.dashDateFrom = fromInput.value; renderContent(); });
    toInput.addEventListener("change", () => { state.dashDateTo = toInput.value; renderContent(); });

    return create("div", { class: "hv-filter-row" }, [
      create("div", { class: "filter-field" }, [create("label", {}, [text("From")]), fromInput]),
      create("div", { class: "filter-field" }, [create("label", {}, [text("To")]), toInput]),
      create("a", {
        href: "#",
        class: "filter-clear",
        onclick: (e) => { e.preventDefault(); state.dashDateFrom = ""; state.dashDateTo = ""; renderContent(); },
      }, [text("Clear")]),
    ]);
  }

  function computeDashboardSummary(leads) {
    return {
      leadsGenerated: leads.length,
      hvBooked: leads.filter((l) => l.status === "Home Visit Booked").length,
      hvDone: leads.filter((l) => l.status === "Home Visit Done").length,
      hvDoneAndPurchased: leads.filter((l) => l.status === "Home Visit Done and Paid").length,
    };
  }

  function buildDashboardAdTable(leads) {
    const byAd = new Map();
    leads.forEach((l) => {
      const camp = l.campaign_name || "(no campaign)";
      const ad = l.ad_name || "(no ad)";
      const key = camp + "||" + ad;
      if (!byAd.has(key)) byAd.set(key, { campaign: camp, ad, leads: 0, hvBooked: 0, hvDone: 0, hvDoneAndPurchased: 0 });
      const row = byAd.get(key);
      row.leads += 1;
      if (l.status === "Home Visit Booked") row.hvBooked += 1;
      if (l.status === "Home Visit Done") row.hvDone += 1;
      if (l.status === "Home Visit Done and Paid") row.hvDoneAndPurchased += 1;
    });
    const rows = [...byAd.values()].sort((a, b) => b.leads - a.leads);

    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Campaign", "Ad", "Leads Generated", "HV Booked", "HV Done", "HV Done & Purchased"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!rows.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "6" }, [text("No leads in this range.")])]));
    }
    rows.forEach((r) => {
      tbody.appendChild(create("tr", {}, [
        create("td", { class: "wrap" }, [text(r.campaign)]),
        create("td", { class: "wrap" }, [text(r.ad)]),
        create("td", { class: "num" }, [text(String(r.leads))]),
        create("td", { class: "num" }, [text(String(r.hvBooked))]),
        create("td", { class: "num" }, [text(String(r.hvDone))]),
        create("td", { class: "num" }, [text(String(r.hvDoneAndPurchased))]),
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  function buildCampaignGroupedChartData(leads) {
    const byCampaign = new Map();
    leads.forEach((l) => {
      const camp = l.campaign_name || "(no campaign)";
      const ad = l.ad_name || "(no ad)";
      if (!byCampaign.has(camp)) byCampaign.set(camp, new Map());
      const adMap = byCampaign.get(camp);
      adMap.set(ad, (adMap.get(ad) || 0) + 1);
    });

    const campaigns = [...byCampaign.entries()].sort((a, b) => {
      const totalA = [...a[1].values()].reduce((s, v) => s + v, 0);
      const totalB = [...b[1].values()].reduce((s, v) => s + v, 0);
      return totalB - totalA;
    });

    const labels = [];
    const labelCampaign = [];
    campaigns.forEach(([camp, adMap]) => {
      [...adMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([ad]) => {
        labels.push(ad);
        labelCampaign.push(camp);
      });
    });

    const datasets = campaigns.map(([camp, adMap], i) => ({
      label: camp,
      backgroundColor: CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length],
      borderRadius: 1,
      maxBarThickness: 40,
      data: labels.map((ad, idx) => (labelCampaign[idx] === camp ? adMap.get(ad) : null)),
    }));

    return { labels, datasets };
  }

  const barCountLabelPlugin = {
    id: "barCountLabel",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const value = dataset.data[i];
          if (value === null || value === undefined) return;
          ctx.save();
          ctx.fillStyle = "#1C1A17";
          ctx.font = "600 11px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(String(value), bar.x, bar.y - 4);
          ctx.restore();
        });
      });
    },
  };

  function drawCampaignGroupedChart(leads) {
    const ctx = el("#adChart");
    if (!ctx) return;
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const { labels, datasets } = buildCampaignGroupedChartData(leads);
    const monoFont = { family: "'IBM Plex Mono', monospace", size: 11 };

    chartInstance = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets },
      plugins: [barCountLabelPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: {
            display: datasets.length > 1,
            position: "top",
            labels: { font: { family: "'Inter', sans-serif", size: 11 }, color: "#726C62", boxWidth: 12 },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0, font: monoFont, color: "#726C62" },
            grid: { color: "#E1D8C5" },
          },
          x: {
            ticks: { autoSkip: false, maxRotation: 45, minRotation: 0, font: { family: "'Inter', sans-serif", size: 11 }, color: "#726C62" },
            grid: { display: false },
          },
        },
      },
    });
  }

  function renderDashboard() {
    const content = el("#content");
    const leads = leadsForDashboard();
    el("#kpiLeadsInView").textContent = leads.length;

    const summary = computeDashboardSummary(leads);
    const summaryPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text(`Summary — ${dashboardPeriodLabel()}`)]),
      buildDashboardDateRangeField(),
      create("div", { class: "kpi-grid" }, [
        buildKpiCard(String(summary.leadsGenerated), "Leads Generated"),
        buildKpiCard(String(summary.hvBooked), "HV Booked"),
        buildKpiCard(String(summary.hvDone), "HV Done"),
        buildKpiCard(String(summary.hvDoneAndPurchased), "HV Done & Purchased"),
      ]),
    ]);
    content.appendChild(summaryPanel);

    const chartPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Leads by Ad, Grouped by Campaign")]),
      create("div", { class: "chart-wrap chart-wrap-lg" }, [create("canvas", { id: "adChart" })]),
    ]);
    content.appendChild(chartPanel);
    drawCampaignGroupedChart(leads);

    const tablePanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Per-Ad Summary")]),
      create("div", { class: "table-scroll" }, [buildDashboardAdTable(leads)]),
    ]);
    content.appendChild(tablePanel);
  }

  function buildCountTable(rows, dimLabel) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, [create("th", {}, [text(`${dimLabel} Name`)]), create("th", {}, [text("Count")])]),
    ]));
    const tbody = create("tbody");
    if (!rows.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "2" }, [text("No leads in this range.")])]));
    }
    rows.forEach(([name, count]) => {
      tbody.appendChild(create("tr", {}, [
        create("td", { class: "wrap" }, [text(name)]),
        create("td", { class: "num" }, [text(String(count))]),
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  function drawChart(rows) {
    const ctx = el("#adChart");
    if (!ctx) return;
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    const monoFont = { family: "'IBM Plex Mono', monospace", size: 11 };
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map(([name]) => name),
        datasets: [{
          label: "Leads",
          data: rows.map(([, count]) => count),
          backgroundColor: "#BB4B25",
          borderRadius: 1,
          maxBarThickness: 44,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0, font: monoFont, color: "#726C62" },
            grid: { color: "#E1D8C5" },
          },
          x: {
            ticks: { autoSkip: false, maxRotation: 45, minRotation: 0, font: { family: "'Inter', sans-serif", size: 11 }, color: "#726C62" },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ---------- FB Leads sub-tab ----------

  function renderClientTracking(leads) {
    const content = el("#content");

    if (!state.fbLeadsUnlocked) {
      const panel = create("div", { class: "panel" }, [
        create("h3", {}, [text("FB Leads")]),
        create("div", { class: "empty-state" }, [
          create("p", {}, [text("This table contains full client contact details and requires the admin code to view.")]),
        ]),
        create("div", { class: "unlock-row" }, [
          create("button", { class: "btn btn-primary", onclick: unlockFbLeads }, [text("Enter Admin Code")]),
        ]),
      ]);
      content.appendChild(panel);
      return;
    }

    const downloadBtn = create("button", { class: "btn btn-outline", onclick: openDownloadModal }, [text("Download Excel")]);

    const panel = create("div", { class: "panel" }, [
      create("div", { class: "panel-header-row" }, [
        create("h3", {}, [text("FB Leads")]),
        downloadBtn,
      ]),
      create("div", { class: "table-scroll" }, [buildTrackingTable(leads)]),
    ]);
    content.appendChild(panel);
  }

  // ---------- Generic admin-code modal (view-gate + download-gate) ----------

  let codeModalHandler = null;

  function openCodeModal({ title, hint, onSubmit }) {
    el("#codeModalTitle").textContent = title;
    el("#codeModalHint").textContent = hint;
    el("#codeModalInput").value = "";
    el("#codeModalResult").innerHTML = "";
    codeModalHandler = onSubmit;
    el("#codeModal").classList.remove("hidden");
    el("#codeModalInput").focus();
  }

  function closeCodeModal() {
    el("#codeModal").classList.add("hidden");
    codeModalHandler = null;
  }

  async function submitCodeModal() {
    if (!codeModalHandler) return;
    const code = el("#codeModalInput").value;
    const resultBox = el("#codeModalResult");
    const submitBtn = el("#submitCodeModal");
    resultBox.innerHTML = "";
    submitBtn.disabled = true;
    try {
      await codeModalHandler(code);
    } catch (err) {
      resultBox.innerHTML = `<div class="err">${escapeHTML(err.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
    }
  }

  function setupCodeModal() {
    el("#cancelCodeModal").addEventListener("click", closeCodeModal);
    el("#codeModal").addEventListener("click", (e) => { if (e.target === el("#codeModal")) closeCodeModal(); });
    el("#submitCodeModal").addEventListener("click", submitCodeModal);
    el("#codeModalInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submitCodeModal(); }
    });
  }

  function unlockFbLeads() {
    openCodeModal({
      title: "Enter Admin Code",
      hint: "The FB Leads table contains full client contact details. Enter the admin code to view it.",
      onSubmit: async (code) => {
        const res = await fetchJSON("/api/admin/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.valid) throw new Error("Incorrect code.");
        state.fbLeadsUnlocked = true;
        closeCodeModal();
        renderContent();
      },
    });
  }

  function openDownloadModal() {
    openCodeModal({
      title: "Confirm Admin Code",
      hint: "Downloading exports every client's full contact details to Excel. Enter the admin code to continue.",
      onSubmit: async (code) => {
        const res = await fetch("/api/export/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            area: state.selectedNav || "",
            month: state.selectedMonth,
            campaign: state.selectedCampaign === "all" ? "" : state.selectedCampaign,
            status: state.selectedStatus,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename=([^;]+)/);
        const filename = match ? match[1].trim() : "fb-leads.xlsx";

        const url = URL.createObjectURL(blob);
        const a = create("a", { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        closeCodeModal();
        showToast("Download started");
      },
    });
  }

  function applyStatusBadgeClass(badge, status) {
    badge.className = "status-badge status-" + slug(status);
  }

  // Shared between FB Leads, the Home Visit table, and the calendar's
  // reschedule editor - a change made anywhere updates the same lead object
  // in state.leads, so every other view picks it up on its next render.

  function buildLeadStatusCell(lead, onSaved) {
    const select = create("select", { class: "status-select" });
    STATUS_OPTIONS.forEach((opt) => {
      select.appendChild(create("option", { value: opt }, [text(opt)]));
    });
    select.value = lead.status;

    const dot = create("span", { class: "dot" });
    const badge = create("span", { class: "status-badge" }, [dot, select]);
    applyStatusBadgeClass(badge, lead.status);

    select.addEventListener("change", async () => {
      const newVal = select.value;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newVal }),
        });
        lead.status = updated.status;
        applyStatusBadgeClass(badge, lead.status);
        showToast("Status saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save status: " + err.message);
        select.value = lead.status;
        applyStatusBadgeClass(badge, lead.status);
      }
    });

    return badge;
  }

  function buildHomeVisitDateCell(lead, onSaved) {
    const input = create("input", { type: "date", class: "date-input", value: lead.home_visit_date || "" });
    input.addEventListener("change", async () => {
      const newVal = input.value;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ home_visit_date: newVal }),
        });
        lead.home_visit_date = updated.home_visit_date;
        showToast("Home visit date saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save home visit date: " + err.message);
        input.value = lead.home_visit_date || "";
      }
    });
    return input;
  }

  function buildTrackingTable(leads) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Date", "Full Name", "Phone", "Street Address", "Customer ID", "Email", "Status", "Attempts Made", "Home Visit Date", "Remarks"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!leads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "10" }, [text("No leads match this filter.")])]));
    }

    leads.forEach((l) => {
      const badge = buildLeadStatusCell(l, null);

      const attemptsValue = create("span", { class: "num" }, [text(String(l.attempts))]);
      const attemptsBtn = create("button", { class: "attempts-btn", type: "button", title: "Log an attempt" }, [text("+")]);
      attemptsBtn.addEventListener("click", async () => {
        attemptsBtn.disabled = true;
        try {
          const updated = await fetchJSON(`/api/leads/${encodeURIComponent(l.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ increment_attempts: true }),
          });
          l.attempts = updated.attempts;
          attemptsValue.textContent = String(l.attempts);
          showToast("Attempt logged");
        } catch (err) {
          alert("Could not log attempt: " + err.message);
        } finally {
          attemptsBtn.disabled = false;
        }
      });
      const attemptsCell = create("td", { class: "attempts-cell" }, [attemptsValue, attemptsBtn]);

      const remarksInput = create("input", { type: "text", class: "remarks-input", value: l.remarks || "", placeholder: "Add a remark…" });
      const saveRemarks = async () => {
        const val = remarksInput.value;
        if (val === l.remarks) return;
        try {
          await fetchJSON(`/api/leads/${encodeURIComponent(l.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ remarks: val }),
          });
          l.remarks = val;
          showToast("Remarks saved");
        } catch (err) {
          alert("Could not save remarks: " + err.message);
        }
      };
      remarksInput.addEventListener("blur", saveRemarks);
      remarksInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); remarksInput.blur(); }
      });

      const hvDateInput = buildHomeVisitDateCell(l, null);

      tbody.appendChild(create("tr", {}, [
        create("td", { class: "num" }, [text(l.created_date)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", { class: "phone-cell" }, [text(l.phone)]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", { class: "id-cell" }, [text(l.id)]),
        create("td", {}, [text(l.email)]),
        create("td", {}, [badge]),
        attemptsCell,
        create("td", {}, [hvDateInput]),
        create("td", {}, [remarksInput]),
      ]));
    });

    table.appendChild(tbody);
    return table;
  }

  // ---------- Home Visit sub-tab ----------

  function computeHomeVisitKPIs(areaLeads) {
    const booked = areaLeads.filter((l) => l.status === "Home Visit Booked" && l.home_visit_date);
    const today = new Date();
    const todayStr = toDateOnly(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateOnly(tomorrow);

    const dayOfWeek = (today.getDay() + 6) % 7; // 0 = Monday
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const nextWeekStart = new Date(weekStart);
    nextWeekStart.setDate(weekStart.getDate() + 7);
    const nextWeekEnd = new Date(weekStart);
    nextWeekEnd.setDate(weekStart.getDate() + 13);

    const inRange = (dateStr, start, end) => dateStr >= toDateOnly(start) && dateStr <= toDateOnly(end);

    return {
      today: booked.filter((l) => l.home_visit_date === todayStr).length,
      tomorrow: booked.filter((l) => l.home_visit_date === tomorrowStr).length,
      thisWeek: booked.filter((l) => inRange(l.home_visit_date, weekStart, weekEnd)).length,
      nextWeek: booked.filter((l) => inRange(l.home_visit_date, nextWeekStart, nextWeekEnd)).length,
    };
  }

  function buildKpiCard(value, label) {
    return create("div", { class: "kpi-card" }, [
      create("div", { class: "kpi-value num" }, [text(value)]),
      create("div", { class: "kpi-label" }, [text(label)]),
    ]);
  }

  function buildHVStatusFilterField() {
    const sel = create("select", {
      onchange: (e) => { state.hvStatusFilter = e.target.value; state.hvTablePage = 1; renderContent(); },
    });
    sel.appendChild(create("option", { value: "all" }, [text("All statuses")]));
    HV_PIPELINE_STATUSES.forEach((s) => sel.appendChild(create("option", { value: s }, [text(s)])));
    sel.value = state.hvStatusFilter;
    return create("div", { class: "filter-field" }, [
      create("label", {}, [text("Status")]),
      sel,
    ]);
  }

  function buildHomeVisitTable(leads) {
    const totalPages = Math.max(1, Math.ceil(leads.length / HV_PAGE_SIZE));
    if (state.hvTablePage > totalPages) state.hvTablePage = totalPages;
    if (state.hvTablePage < 1) state.hvTablePage = 1;
    const start = (state.hvTablePage - 1) * HV_PAGE_SIZE;
    const pageLeads = leads.slice(start, start + HV_PAGE_SIZE);

    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Home Visit Date", "Client Name", "Phone", "Street Address", "Email", "Customer ID", "Status"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!pageLeads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "7" }, [text("No leads match this filter.")])]));
    }
    pageLeads.forEach((l) => {
      const dateInput = buildHomeVisitDateCell(l, () => renderContent());
      const statusBadge = buildLeadStatusCell(l, () => renderContent());
      tbody.appendChild(create("tr", {}, [
        create("td", {}, [dateInput]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", { class: "phone-cell" }, [text(l.phone)]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", {}, [text(l.email)]),
        create("td", { class: "id-cell" }, [text(l.id)]),
        create("td", {}, [statusBadge]),
      ]));
    });
    table.appendChild(tbody);

    const prevBtn = create("button", { class: "btn btn-outline" }, [text("Previous")]);
    prevBtn.disabled = state.hvTablePage <= 1;
    prevBtn.addEventListener("click", () => { state.hvTablePage -= 1; renderContent(); });

    const nextBtn = create("button", { class: "btn btn-outline" }, [text("Next")]);
    nextBtn.disabled = state.hvTablePage >= totalPages;
    nextBtn.addEventListener("click", () => { state.hvTablePage += 1; renderContent(); });

    const pagination = create("div", { class: "pagination-row" }, [
      prevBtn,
      create("span", { class: "pagination-label" }, [text(`Page ${state.hvTablePage} of ${totalPages}`)]),
      nextBtn,
    ]);

    return create("div", {}, [
      create("div", { class: "table-scroll" }, [table]),
      pagination,
    ]);
  }

  function shiftCalendarMonth(delta) {
    let { year, month } = state.calendarMonth;
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    state.calendarMonth = { year, month };
    renderContent();
  }

  function buildVisitChip(lead, cellEl) {
    const chip = create("button", { class: "visit-chip status-" + slug(lead.status) }, [
      text(lead.full_name || lead.id),
    ]);

    chip.addEventListener("click", () => {
      const dateInput = create("input", { type: "date", value: lead.home_visit_date || "" });
      const editor = create("div", { class: "visit-chip-editor" }, [
        create("span", { class: "chip-name" }, [text(lead.full_name || lead.id)]),
        dateInput,
      ]);
      dateInput.addEventListener("change", async () => {
        const newVal = dateInput.value;
        try {
          const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ home_visit_date: newVal }),
          });
          lead.home_visit_date = updated.home_visit_date;
          showToast("Rescheduled");
          renderContent();
        } catch (err) {
          alert("Could not reschedule: " + err.message);
        }
      });
      cellEl.replaceChild(editor, chip);
    });

    return chip;
  }

  function buildCalendar(calendarLeads) {
    const { year, month } = state.calendarMonth;

    const header = create("div", { class: "calendar-header" }, [
      create("div", { class: "calendar-title" }, [text(`${MONTH_NAMES[month]} ${year}`)]),
      create("div", { class: "calendar-nav" }, [
        create("button", { class: "calendar-nav-btn", onclick: () => shiftCalendarMonth(-1) }, [text("‹")]),
        create("button", { class: "calendar-nav-btn", onclick: () => shiftCalendarMonth(1) }, [text("›")]),
      ]),
    ]);

    const weekdaysRow = create("div", { class: "calendar-weekdays" },
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => create("div", { class: "calendar-weekday" }, [text(w)]))
    );

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = toDateOnly(new Date());

    const leadsByDate = new Map();
    calendarLeads.forEach((l) => {
      if (!l.home_visit_date) return;
      if (!leadsByDate.has(l.home_visit_date)) leadsByDate.set(l.home_visit_date, []);
      leadsByDate.get(l.home_visit_date).push(l);
    });

    const grid = create("div", { class: "calendar-grid" });
    for (let i = 0; i < startWeekday; i++) {
      grid.appendChild(create("div", { class: "calendar-cell blank" }));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = dateStr === todayStr;
      const cell = create("div", { class: "calendar-cell" + (isToday ? " today" : "") }, [
        create("div", { class: "calendar-day-number" }, [text(String(d))]),
      ]);
      (leadsByDate.get(dateStr) || []).forEach((l) => cell.appendChild(buildVisitChip(l, cell)));
      grid.appendChild(cell);
    }
    const trailing = (7 - ((startWeekday + daysInMonth) % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      grid.appendChild(create("div", { class: "calendar-cell blank" }));
    }

    return create("div", {}, [header, weekdaysRow, grid]);
  }

  function renderHomeVisitTab(leads) {
    const content = el("#content");
    const areaLeads = leadsForArea();

    const kpis = computeHomeVisitKPIs(areaLeads);
    const kpiPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Home Visit Schedule")]),
      create("div", { class: "kpi-grid" }, [
        buildKpiCard(String(kpis.today), "Scheduled Today"),
        buildKpiCard(String(kpis.tomorrow), "Scheduled Tomorrow"),
        buildKpiCard(String(kpis.thisWeek), "Booked This Week"),
        buildKpiCard(String(kpis.nextWeek), "Booked Next Week"),
      ]),
    ]);
    content.appendChild(kpiPanel);

    const statusCounts = new Map(HV_PIPELINE_STATUSES.map((s) => [s, 0]));
    areaLeads.forEach((l) => {
      if (statusCounts.has(l.status)) {
        statusCounts.set(l.status, statusCounts.get(l.status) + 1);
      }
    });
    const statusKpiPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Home Visit Status Breakdown")]),
      create("div", { class: "kpi-grid" },
        HV_PIPELINE_STATUSES.map((s) => buildKpiCard(String(statusCounts.get(s)), s))
      ),
    ]);
    content.appendChild(statusKpiPanel);

    const hvFiltered = leads.filter((l) => state.hvStatusFilter === "all" || l.status === state.hvStatusFilter);

    const tablePanel = create("div", { class: "panel" }, [
      create("div", { class: "hv-filter-row" }, [buildHVStatusFilterField()]),
      create("h3", {}, [text("Home Visit Details")]),
      buildHomeVisitTable(hvFiltered),
    ]);
    content.appendChild(tablePanel);

    const calendarLeads = areaLeads.filter((l) => l.home_visit_date && HV_PIPELINE_STATUSES.includes(l.status) && (state.hvStatusFilter === "all" || l.status === state.hvStatusFilter));
    const calendarPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Home Visit Calendar")]),
      buildCalendar(calendarLeads),
    ]);
    content.appendChild(calendarPanel);
  }

  // ---------- Overview tab (global, cross-area) ----------

  function buildOverviewFilterField(labelText, current, options, onChange) {
    const sel = create("select", { onchange: (e) => onChange(e.target.value) });
    sel.appendChild(create("option", { value: "all" }, [text("All")]));
    options.forEach((o) => sel.appendChild(create("option", { value: o }, [text(o)])));
    sel.value = current;
    return create("div", { class: "filter-field" }, [
      create("label", {}, [text(labelText)]),
      sel,
    ]);
  }

  function renderOverviewTab() {
    const content = el("#content");

    const filtered = state.leads.filter((l) => {
      if (state.ovStatusFilter !== "all" && l.status !== state.ovStatusFilter) return false;
      return true;
    });

    // KPI row: total + one card per area (respecting the filter).
    const areaCounts = new Map(state.meta.areas.map((a) => [a.name, 0]));
    let unassigned = 0;
    filtered.forEach((l) => {
      if (l.area && areaCounts.has(l.area)) areaCounts.set(l.area, areaCounts.get(l.area) + 1);
      else unassigned += 1;
    });

    const kpiCards = [buildKpiCard(String(filtered.length), "Total Leads")];
    state.meta.areas.forEach((a) => kpiCards.push(buildKpiCard(String(areaCounts.get(a.name)), a.name)));
    kpiCards.push(buildKpiCard(String(unassigned), "Unassigned"));

    const filterRow = create("div", { class: "hv-filter-row" }, [
      buildOverviewFilterField("Lead Status", state.ovStatusFilter, STATUS_OPTIONS, (v) => { state.ovStatusFilter = v; renderContent(); }),
    ]);

    const kpiPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Leads by Area")]),
      filterRow,
      create("div", { class: "kpi-grid" }, kpiCards),
    ]);
    content.appendChild(kpiPanel);

    // Bar chart + table, area-wise.
    const chartRows = state.meta.areas.map((a) => [a.name, areaCounts.get(a.name)]);
    if (unassigned > 0) chartRows.push(["Unassigned", unassigned]);

    const chartPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Area-wise Lead Count")]),
      create("div", { class: "dashboard-grid" }, [
        create("div", { class: "chart-wrap" }, [create("canvas", { id: "adChart" })]),
        create("div", { class: "table-scroll" }, [buildCountTable(chartRows, "Area")]),
      ]),
    ]);
    content.appendChild(chartPanel);
    drawChart(chartRows);
  }

  // ---------- Campaign-Area Mapping tab ----------

  function renderMappingTab() {
    const content = el("#content");
    const columns = [{ area: null, label: "Unassigned" }].concat(
      state.meta.areas.map((a) => ({ area: a.name, label: a.name }))
    );

    const gridEl = create("div", { class: "mapping-grid" });

    columns.forEach((col) => {
      const campaignsInCol = state.campaignMap.filter((c) => c.area === col.area);
      const colEl = create("div", { class: "map-column" });

      colEl.appendChild(create("div", { class: "map-column-header" }, [
        create("span", {}, [text(col.label)]),
        create("span", { class: "num" }, [text(String(campaignsInCol.length))]),
      ]));

      const body = create("div", { class: "map-column-body" });
      if (!campaignsInCol.length) {
        body.appendChild(create("div", { class: "map-empty" }, [text("No campaigns here")]));
      }
      campaignsInCol.forEach((c) => {
        const card = create("div", { class: "campaign-card", draggable: "true" }, [
          create("span", { class: "campaign-card-name" }, [text(c.name)]),
          create("span", { class: "count num" }, [text(String(c.count))]),
        ]);
        card.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", c.name);
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        body.appendChild(card);
      });
      colEl.appendChild(body);

      colEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        colEl.classList.add("drag-over");
      });
      colEl.addEventListener("dragleave", () => colEl.classList.remove("drag-over"));
      colEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        colEl.classList.remove("drag-over");
        const campaignName = e.dataTransfer.getData("text/plain");
        if (!campaignName) return;
        try {
          await fetchJSON("/api/campaign-map", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ campaign: campaignName, area: col.area }),
          });
          showToast(`${campaignName} → ${col.label}`);
          await loadAll();
        } catch (err) {
          alert("Could not move campaign: " + err.message);
        }
      });

      gridEl.appendChild(colEl);
    });

    const panel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Campaign → Area Mapping")]),
      create("p", { class: "mapping-hint" }, [
        text("Drag a campaign card into an area column to route its leads there. New campaigns from future uploads land in Unassigned until you place them."),
      ]),
      gridEl,
    ]);
    content.appendChild(panel);
  }

  // ---------- Upload modal ----------

  function setupUploadModal() {
    const modal = el("#uploadModal");
    const openBtn = el("#uploadBtn");
    const cancelBtn = el("#cancelUpload");
    const submitBtn = el("#submitUpload");
    const input = el("#zipInput");
    const resultBox = el("#uploadResult");

    openBtn.addEventListener("click", () => {
      resultBox.innerHTML = "";
      input.value = "";
      modal.classList.remove("hidden");
    });
    cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

    submitBtn.addEventListener("click", async () => {
      if (!input.files.length) {
        resultBox.innerHTML = '<div class="err">Choose at least one .zip file first.</div>';
        return;
      }
      const formData = new FormData();
      [...input.files].forEach((f) => formData.append("files", f));

      submitBtn.disabled = true;
      submitBtn.textContent = "Uploading…";
      resultBox.innerHTML = "";

      try {
        const stats = await fetchJSON("/api/upload", { method: "POST", body: formData });
        let html = `<div class="ok">${stats.inserted} new lead(s) added, ${stats.updated} refreshed, ${stats.files_processed} file(s) processed.</div>`;
        if (stats.errors && stats.errors.length) {
          html += `<div class="err">Some files had issues:<ul>${stats.errors.map((e) => `<li>${escapeHTML(e)}</li>`).join("")}</ul></div>`;
        }
        resultBox.innerHTML = html;
        await loadAll();
      } catch (err) {
        resultBox.innerHTML = `<div class="err">Upload failed: ${escapeHTML(err.message)}</div>`;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Upload";
      }
    });
  }

  function escapeHTML(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupUploadModal();
    setupCodeModal();
    setupFilterBar();
    setupSubTabs();
    loadAll().catch((err) => {
      el("#emptyState").classList.remove("hidden");
      el("#emptyState").querySelector("p").textContent = "Failed to load data: " + err.message;
    });
  });
})();
