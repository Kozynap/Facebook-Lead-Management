(function () {
  "use strict";

  const STATUS_OPTIONS = window.STATUS_OPTIONS || [
    "New", "Follow up", "Warm",
    "Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid",
    "Bulk Order", "Cold",
  ];
  const HV_PIPELINE_STATUSES = window.HV_PIPELINE_STATUSES || [
    "Home Visit Booked", "Home Visit Done", "Home Visit Done and Paid",
  ];
  const SALES_PERSONS = window.SALES_PERSONS || [
    "Abhishek", "Aditya", "Chinmoy", "Dipankar", "Gourav", "Joydip",
    "Krishna", "Kuldeep", "Madhumita", "Oikantik", "Rajesh", "Sambhu",
    "Samya", "Sarat", "Snehasish", "Sreerup", "Srijita", "Suman",
  ];
  const HV_PAGE_SIZE = 15;
  const TRACKING_PAGE_SIZE = 15;
  const NAV_MAPPING = "__mapping__";
  const MOVE_UNASSIGNED = "__unassigned__";
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
    selectedStatuses: [],
    searchQuery: "",
    selectedSubTab: "dashboard",
    hvStatusFilter: "all",
    hvTablePage: 1,
    trackingTablePage: 1,
    trackingSort: { key: null, dir: "asc" },
    hvSort: { key: null, dir: "asc" },
    trackingSelectedIds: new Set(),
    hvSelectedIds: new Set(),
    calendarMonth: { year: now.getFullYear(), month: now.getMonth() },
    ovStatusFilter: "all",
    dashDateFrom: "",
    dashDateTo: "",
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

  // A lead's `status` field can (still) hold multiple comma-separated tags
  // left over from when per-row editing was multi-select - going forward,
  // the single-select dropdown always writes exactly one, but old leads
  // may carry a combo like "New,Warm" until next touched.
  const statusList = (lead) => (lead.status || "").split(",").map((s) => s.trim()).filter(Boolean);
  const hasStatus = (lead, value) => statusList(lead).includes(value);
  const hasAnyStatus = (lead, values) => statusList(lead).some((s) => values.includes(s));

  // Matches the Search filter against a lead's name (substring) or phone
  // (digits-only substring, so formatting/spaces/+ don't matter).
  function leadMatchesSearch(lead, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return true;
    if ((lead.full_name || "").toLowerCase().includes(q)) return true;
    const qDigits = q.replace(/\D/g, "");
    if (qDigits && cleanPhone(lead.phone).replace(/\D/g, "").includes(qDigits)) return true;
    return false;
  }

  // Single status to show/edit for a lead - the most-advanced tag it carries
  // (last match in STATUS_OPTIONS order), so a legacy "New,Warm" lead reads
  // as "Warm" rather than always falling back to "New".
  function primaryStatus(lead) {
    const statuses = statusList(lead);
    for (let i = STATUS_OPTIONS.length - 1; i >= 0; i--) {
      if (statuses.includes(STATUS_OPTIONS[i])) return STATUS_OPTIONS[i];
    }
    return STATUS_OPTIONS[0];
  }

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
    state.selectedStatuses = [];
    state.searchQuery = "";
    state.hvStatusFilter = "all";
    state.hvTablePage = 1;
    state.trackingTablePage = 1;
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

    const statusContainer = el("#statusFilterWidget");
    statusContainer.innerHTML = "";
    statusContainer.appendChild(buildStatusFilterMultiSelect());

    el("#searchFilter").value = state.searchQuery;
  }

  // Master "Status" filter in the top filter bar - the only place status
  // multi-select applies. Each checkbox toggles membership in
  // state.selectedStatuses (empty = no filter / all statuses) and
  // re-renders content immediately; the filter bar itself isn't touched by
  // renderContent(), so the panel stays open across successive toggles.
  function buildStatusFilterMultiSelect() {
    const details = create("details", { class: "status-multiselect" });
    const summaryLabel = () => state.selectedStatuses.length ? state.selectedStatuses.join(", ") : "All statuses";
    const summaryBody = create("span", { class: "status-summary" }, [text(summaryLabel())]);
    details.appendChild(create("summary", {}, [summaryBody]));

    const list = create("div", { class: "status-checklist" });
    STATUS_OPTIONS.forEach((opt) => {
      const cb = create("input", { type: "checkbox", value: opt });
      cb.checked = state.selectedStatuses.includes(opt);
      cb.addEventListener("change", () => {
        state.selectedStatuses = cb.checked
          ? [...state.selectedStatuses, opt]
          : state.selectedStatuses.filter((s) => s !== opt);
        summaryBody.textContent = summaryLabel();
        state.trackingTablePage = 1;
        renderContent();
      });
      list.appendChild(create("label", { class: "status-check-row" }, [cb, text(" " + opt)]));
    });
    details.appendChild(list);

    return details;
  }

  function setupFilterBar() {
    el("#monthFilter").addEventListener("change", (e) => {
      state.selectedMonth = e.target.value;
      state.hvTablePage = 1;
      state.trackingTablePage = 1;
      el("#footerPeriod").textContent = monthLabel(state.selectedMonth);
      renderContent();
    });
    el("#campaignFilter").addEventListener("change", (e) => {
      state.selectedCampaign = e.target.value;
      state.hvTablePage = 1;
      state.trackingTablePage = 1;
      renderContent();
    });
    el("#searchFilter").addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      state.hvTablePage = 1;
      state.trackingTablePage = 1;
      renderContent();
    });
    el("#clearFilters").addEventListener("click", (e) => {
      e.preventDefault();
      state.selectedMonth = "all";
      state.selectedCampaign = "all";
      state.selectedStatuses = [];
      state.searchQuery = "";
      state.hvTablePage = 1;
      state.trackingTablePage = 1;
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
      if (state.selectedStatuses.length && !hasAnyStatus(l, state.selectedStatuses)) return false;
      if (!leadMatchesSearch(l, state.searchQuery)) return false;
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
      if (!hasAnyStatus(l, HV_PIPELINE_STATUSES)) return false;
      if (state.selectedMonth !== "all" && l.created_month !== state.selectedMonth) return false;
      if (state.selectedCampaign !== "all" && l.campaign_name !== state.selectedCampaign) return false;
      if (!leadMatchesSearch(l, state.searchQuery)) return false;
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
      if (state.selectedStatuses.length && !hasAnyStatus(l, state.selectedStatuses)) return false;
      if (!leadMatchesSearch(l, state.searchQuery)) return false;
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
      hvBooked: leads.filter((l) => hasStatus(l, "Home Visit Booked")).length,
      hvDone: leads.filter((l) => hasStatus(l, "Home Visit Done")).length,
      hvDoneAndPurchased: leads.filter((l) => hasStatus(l, "Home Visit Done and Paid")).length,
    };
  }

  // A clickable count that opens the leads behind it in the details modal.
  function buildDrillDownCount(count, title, matchedLeads) {
    const btn = create("button", { type: "button", class: "count-link" }, [text(String(count))]);
    btn.addEventListener("click", () => openLeadsDetailModal(title, matchedLeads));
    return btn;
  }

  function buildDashboardAdTable(leads) {
    const byAd = new Map();
    leads.forEach((l) => {
      const camp = l.campaign_name || "(no campaign)";
      const ad = l.ad_name || "(no ad)";
      const key = camp + "||" + ad;
      if (!byAd.has(key)) byAd.set(key, { campaign: camp, ad, leads: [] });
      byAd.get(key).leads.push(l);
    });
    const rows = [...byAd.values()].sort((a, b) => b.leads.length - a.leads.length);

    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Campaign", "Ad", "Leads Generated", "HV Booked", "HV Done", "HV Done & Purchased"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!rows.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "6" }, [text("No leads in this range.")])]));
    }
    rows.forEach((r) => {
      const hvBookedLeads = r.leads.filter((l) => hasStatus(l, "Home Visit Booked"));
      const hvDoneLeads = r.leads.filter((l) => hasStatus(l, "Home Visit Done"));
      const hvDoneAndPurchasedLeads = r.leads.filter((l) => hasStatus(l, "Home Visit Done and Paid"));
      const label = `${r.ad} — ${r.campaign}`;

      tbody.appendChild(create("tr", {}, [
        create("td", { class: "wrap" }, [text(r.campaign)]),
        create("td", { class: "wrap" }, [text(r.ad)]),
        create("td", { class: "num" }, [buildDrillDownCount(r.leads.length, `Leads Generated · ${label}`, r.leads)]),
        create("td", { class: "num" }, [buildDrillDownCount(hvBookedLeads.length, `HV Booked · ${label}`, hvBookedLeads)]),
        create("td", { class: "num" }, [buildDrillDownCount(hvDoneLeads.length, `HV Done · ${label}`, hvDoneLeads)]),
        create("td", { class: "num" }, [buildDrillDownCount(hvDoneAndPurchasedLeads.length, `HV Done & Purchased · ${label}`, hvDoneAndPurchasedLeads)]),
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

    const downloadBtn = create("button", { class: "btn btn-outline", onclick: openDownloadModal }, [text("Download Excel")]);

    const panel = create("div", { class: "panel" }, [
      create("div", { class: "panel-header-row" }, [
        create("h3", {}, [text("FB Leads")]),
        downloadBtn,
      ]),
      buildTrackingTable(leads),
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
    const code = el("#codeModalInput").value.trim();
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

  // Read-only drill-down shown when a Per-Ad Summary count is clicked -
  // the leads that make up that number.
  function buildLeadsDetailTable(leads) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Date", "Full Name", "Phone", "Called by", "Status", "Home Visit Date"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!leads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "6" }, [text("No leads.")])]));
    }
    leads.forEach((l) => {
      tbody.appendChild(create("tr", {}, [
        create("td", { class: "num" }, [text(l.created_date)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [buildPhoneLink(l.phone)]),
        create("td", {}, [text(l.sales_person || "No One")]),
        create("td", { class: "wrap" }, [text(l.status)]),
        create("td", {}, [text(l.home_visit_date || "—")]),
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  // Remembers what's currently shown in the drill-down modal, so its
  // Download Excel button can export exactly those leads.
  let leadsDetailContext = { title: "", ids: [] };

  function openLeadsDetailModal(title, leads) {
    leadsDetailContext = { title, ids: leads.map((l) => l.id) };
    el("#leadsDetailTitle").textContent = title;
    const wrap = el("#leadsDetailTableWrap");
    wrap.innerHTML = "";
    wrap.appendChild(buildLeadsDetailTable(leads));
    el("#leadsDetailModal").classList.remove("hidden");
  }

  function closeLeadsDetailModal() {
    el("#leadsDetailModal").classList.add("hidden");
  }

  function downloadLeadsDetail() {
    openCodeModal({
      title: "Enter Download Code",
      hint: "Downloading exports every client's full contact details to Excel - enter the download code to continue.",
      onSubmit: async (code) => {
        const res = await fetch("/api/export/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, ids: leadsDetailContext.ids, label: leadsDetailContext.title }),
        });
        await downloadFileFromResponse(res, "client-tracking.xlsx");
        closeCodeModal();
        showToast("Download started");
      },
    });
  }

  function setupLeadsDetailModal() {
    const modal = el("#leadsDetailModal");
    el("#closeLeadsDetailModal").addEventListener("click", closeLeadsDetailModal);
    el("#downloadLeadsDetail").addEventListener("click", downloadLeadsDetail);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeLeadsDetailModal(); });
  }

  // Clicking away from the open Status filter checklist closes it.
  function setupStatusMultiSelectAutoClose() {
    document.addEventListener("click", (e) => {
      document.querySelectorAll("details.status-multiselect[open]").forEach((d) => {
        if (!d.contains(e.target)) d.open = false;
      });
    });
  }

  // Shared by every "download code" flow - turns an xlsx response into a
  // saved file, using the server's suggested filename when present.
  async function downloadFileFromResponse(res, fallbackFilename) {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename=([^;]+)/);
    const filename = match ? match[1].trim() : fallbackFilename;

    const url = URL.createObjectURL(blob);
    const a = create("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openDownloadModal() {
    openCodeModal({
      title: "Enter Download Code",
      hint: "Downloading exports every client's full contact details to Excel - enter the download code to continue.",
      onSubmit: async (code) => {
        const res = await fetch("/api/export/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            area: state.selectedNav || "",
            month: state.selectedMonth,
            campaign: state.selectedCampaign === "all" ? "" : state.selectedCampaign,
            status: state.selectedStatuses,
          }),
        });
        await downloadFileFromResponse(res, "fb-leads.xlsx");
        closeCodeModal();
        showToast("Download started");
      },
    });
  }

  // Facebook exports phone numbers with a "p:" prefix (e.g. "p:+91...") -
  // strip it both for display and for the tel: link itself.
  function cleanPhone(phone) {
    return (phone || "").replace(/^p:/i, "").trim();
  }

  function buildPhoneLink(phone) {
    const clean = cleanPhone(phone);
    if (!clean) return text("");
    return create("a", { href: `tel:${clean}`, class: "contact-link" }, [text(clean)]);
  }

  function buildEmailLink(email) {
    if (!email) return text("");
    return create("a", { href: `mailto:${email}`, class: "contact-link" }, [text(email)]);
  }

  const WHATSAPP_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.02 2 11c0 2.25.93 4.29 2.45 5.85L3 22l5.4-1.42C9.77 21.15 10.87 21.4 12 21.4c5.52 0 10-4.02 10-9s-4.48-9-10-9zm0 16.4c-1.02 0-2.02-.22-2.94-.62l-.34-.15-3.2.84.85-3.1-.18-.32C5.5 14.4 5 12.75 5 11c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7z"/><path d="M9.2 8.3c-.15-.34-.31-.35-.45-.35h-.38c-.14 0-.35.05-.53.25-.18.2-.7.68-.7 1.67 0 .98.72 1.93.82 2.06.1.14 1.42 2.16 3.48 3.02 1.72.72 2.07.58 2.44.54.37-.03 1.2-.49 1.37-.96.17-.47.17-.87.12-.96-.05-.08-.19-.13-.38-.23-.2-.1-1.2-.59-1.38-.66-.19-.07-.32-.1-.46.1-.14.2-.53.66-.65.79-.12.14-.24.15-.44.05-.2-.1-.85-.31-1.62-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.31.08-.41.09-.09.2-.24.3-.36.1-.11.13-.19.2-.32.06-.14.03-.26-.02-.36-.05-.1-.44-1.1-.63-1.5z"/></svg>';

  // wa.me needs digits only - country code + number, no "+"/spaces/dashes.
  function whatsAppDigits(phone) {
    return cleanPhone(phone).replace(/\D/g, "");
  }

  // Starting text for the WhatsApp draft - edit this to change the wording.
  // WhatsApp has no link parameter for attaching a file, so any attachment
  // still has to be added by hand once the chat opens (see conversation).
  function buildWhatsAppMessage(lead) {
    return `Hi ${lead.full_name || "there"}, this is Kozynap regarding your enquiry.`;
  }

  function buildWhatsAppLink(lead) {
    const digits = whatsAppDigits(lead.phone);
    if (!digits) return null;
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(buildWhatsAppMessage(lead))}`;
    return create("a", {
      href: url, class: "whatsapp-link", target: "_blank", rel: "noopener",
      title: "Open WhatsApp with a drafted message", html: WHATSAPP_ICON_SVG,
    });
  }

  function buildPhoneCell(lead) {
    const children = [buildPhoneLink(lead.phone)];
    const wa = buildWhatsAppLink(lead);
    if (wa) children.push(wa);
    return create("span", { class: "phone-cell-inner" }, children);
  }

  // Shared between FB Leads, the Home Visit table, and the calendar's
  // reschedule editor - a change made anywhere updates the same lead object
  // in state.leads, so every other view picks it up on its next render.
  // One status per lead, picked from a plain <select> (the multi-select
  // checklist UI lives only in the top Status filter, not here).
  function buildStatusSelectCell(lead, onSaved) {
    const select = create("select", { class: "status-select" });
    STATUS_OPTIONS.forEach((opt) => select.appendChild(create("option", { value: opt }, [text(opt)])));
    select.value = primaryStatus(lead);
    select.addEventListener("change", async () => {
      const newVal = select.value;
      if (newVal === lead.status) return;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newVal }),
        });
        lead.status = updated.status;
        showToast("Status saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save status: " + err.message);
        select.value = primaryStatus(lead);
      }
    });
    return select;
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

  function buildSalesPersonCell(lead, onSaved) {
    const select = create("select", { class: "sales-person-select" });
    select.appendChild(create("option", { value: "" }, [text("No One")]));
    SALES_PERSONS.forEach((name) => select.appendChild(create("option", { value: name }, [text(name)])));
    select.value = lead.sales_person || "";
    select.addEventListener("change", async () => {
      const newVal = select.value;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sales_person: newVal }),
        });
        lead.sales_person = updated.sales_person;
        showToast("Called by saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save Called by: " + err.message);
        select.value = lead.sales_person || "";
      }
    });
    return select;
  }

  function buildAttemptsCell(lead) {
    const valueSpan = create("span", { class: "num" }, [text(String(lead.attempts))]);
    const minusBtn = create("button", { class: "attempts-btn", type: "button", title: "Remove an attempt" }, [text("−")]);
    const plusBtn = create("button", { class: "attempts-btn", type: "button", title: "Log an attempt" }, [text("+")]);

    async function bump(field, verb) {
      minusBtn.disabled = true;
      plusBtn.disabled = true;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: true }),
        });
        lead.attempts = updated.attempts;
        valueSpan.textContent = String(lead.attempts);
        showToast(verb);
      } catch (err) {
        alert("Could not update attempts: " + err.message);
      } finally {
        minusBtn.disabled = false;
        plusBtn.disabled = false;
      }
    }

    minusBtn.addEventListener("click", () => bump("decrement_attempts", "Attempt removed"));
    plusBtn.addEventListener("click", () => bump("increment_attempts", "Attempt logged"));

    return create("td", { class: "attempts-cell" }, [minusBtn, valueSpan, plusBtn]);
  }

  function buildSalesValueCell(lead, onSaved) {
    const hasValue = lead.sales_value !== null && lead.sales_value !== undefined;
    const input = create("input", {
      type: "number", class: "sales-value-input", min: "0", step: "any",
      placeholder: "—", value: hasValue ? String(lead.sales_value) : "",
    });
    const save = async () => {
      const val = input.value.trim();
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sales_value: val }),
        });
        lead.sales_value = updated.sales_value;
        showToast("Sales value saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save sales value: " + err.message);
        input.value = lead.sales_value !== null && lead.sales_value !== undefined ? String(lead.sales_value) : "";
      }
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    return input;
  }

  function buildModelNameCell(lead, onSaved) {
    const input = create("input", { type: "text", class: "model-name-input", value: lead.model_name || "", placeholder: "Add model…" });
    const save = async () => {
      const val = input.value;
      if (val === (lead.model_name || "")) return;
      try {
        const updated = await fetchJSON(`/api/leads/${encodeURIComponent(lead.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_name: val }),
        });
        lead.model_name = updated.model_name;
        showToast("Model name saved");
        if (onSaved) onSaved();
      } catch (err) {
        alert("Could not save model name: " + err.message);
        input.value = lead.model_name || "";
      }
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    return input;
  }

  // ---------- Sortable table headers (shared by FB Leads + Home Visit) ----------

  function buildSortableTh(label, key, sortState, onSort) {
    const arrow = sortState.key !== key ? "" : sortState.dir === "asc" ? " ▲" : " ▼";
    const th = create("th", { class: "sortable-th" }, [text(label + arrow)]);
    th.addEventListener("click", () => onSort(key));
    return th;
  }

  function sortLeadsBy(leads, columns, sortState) {
    if (!sortState.key) return leads;
    const col = columns.find((c) => c.key === sortState.key);
    if (!col) return leads;
    const sorted = leads.slice().sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va ?? "").localeCompare(String(vb ?? ""));
      return sortState.dir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }

  // ---------- Bulk selection + status update (shared by FB Leads + Home Visit) ----------

  // Drops any selected id that isn't in the current page, so a selection
  // never silently applies to leads the user can no longer see (after a
  // page/filter/sort/search change).
  function pruneSelection(selectedIds, pageLeads) {
    const visible = new Set(pageLeads.map((l) => l.id));
    for (const id of selectedIds) {
      if (!visible.has(id)) selectedIds.delete(id);
    }
  }

  function buildSelectAllTh(pageLeads, selectedIds, onToggleAll) {
    const cb = create("input", { type: "checkbox" });
    const allSelected = pageLeads.length > 0 && pageLeads.every((l) => selectedIds.has(l.id));
    const someSelected = pageLeads.some((l) => selectedIds.has(l.id));
    cb.checked = allSelected;
    cb.indeterminate = someSelected && !allSelected;
    cb.addEventListener("change", () => onToggleAll(cb.checked));
    return create("th", { class: "select-col" }, [cb]);
  }

  function buildRowSelectTd(lead, selectedIds, onToggle) {
    const cb = create("input", { type: "checkbox" });
    cb.checked = selectedIds.has(lead.id);
    cb.addEventListener("change", () => onToggle(lead.id, cb.checked));
    return create("td", { class: "select-col" }, [cb]);
  }

  async function applyBulkStatus(selectedIds, status) {
    const ids = [...selectedIds];
    try {
      await Promise.all(ids.map((id) =>
        fetchJSON(`/api/leads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }).then((updated) => {
          const lead = state.leads.find((l) => l.id === id);
          if (lead) lead.status = updated.status;
        })
      ));
      showToast(`Status updated for ${ids.length} lead${ids.length === 1 ? "" : "s"}`);
    } catch (err) {
      alert("Could not update all selected leads: " + err.message);
    }
    selectedIds.clear();
    renderContent();
  }

  function buildBulkStatusBar(selectedIds) {
    if (!selectedIds.size) return null;
    const select = create("select", {});
    STATUS_OPTIONS.forEach((opt) => select.appendChild(create("option", { value: opt }, [text(opt)])));
    const applyBtn = create("button", { class: "btn btn-primary" }, [text("Apply")]);
    applyBtn.addEventListener("click", () => applyBulkStatus(selectedIds, select.value));
    const clearBtn = create("button", { class: "btn btn-outline" }, [text("Clear selection")]);
    clearBtn.addEventListener("click", () => { selectedIds.clear(); renderContent(); });
    return create("div", { class: "bulk-action-bar" }, [
      create("span", { class: "bulk-action-count" }, [text(`${selectedIds.size} selected`)]),
      create("span", {}, [text("Set status to")]),
      select,
      applyBtn,
      clearBtn,
    ]);
  }

  const TRACKING_COLUMNS = [
    { key: "created_date", label: "Date", value: (l) => l.created_date },
    { key: "phone", label: "Phone", value: (l) => cleanPhone(l.phone) },
    { key: "full_name", label: "Full Name", value: (l) => (l.full_name || "").toLowerCase() },
    { key: "sales_person", label: "Called by", value: (l) => (l.sales_person || "").toLowerCase() },
    { key: "status", label: "Status", value: (l) => STATUS_OPTIONS.indexOf(primaryStatus(l)) },
    { key: "attempts", label: "Attempts Made", value: (l) => l.attempts },
    { key: "home_visit_date", label: "Home Visit Date", value: (l) => l.home_visit_date || "" },
    { key: "remarks", label: "Remarks", value: (l) => (l.remarks || "").toLowerCase() },
    { key: "street_address", label: "Street Address", value: (l) => (l.street_address || "").toLowerCase() },
    { key: "email", label: "Email", value: (l) => (l.email || "").toLowerCase() },
    { key: "id", label: "Customer ID", value: (l) => l.id },
  ];

  function sortTracking(key) {
    if (state.trackingSort.key === key) {
      state.trackingSort = { key, dir: state.trackingSort.dir === "asc" ? "desc" : "asc" };
    } else {
      state.trackingSort = { key, dir: "asc" };
    }
    state.trackingTablePage = 1;
    renderContent();
  }

  function buildTrackingTable(rawLeads) {
    const leads = sortLeadsBy(rawLeads, TRACKING_COLUMNS, state.trackingSort);
    const totalPages = Math.max(1, Math.ceil(leads.length / TRACKING_PAGE_SIZE));
    if (state.trackingTablePage > totalPages) state.trackingTablePage = totalPages;
    if (state.trackingTablePage < 1) state.trackingTablePage = 1;
    const start = (state.trackingTablePage - 1) * TRACKING_PAGE_SIZE;
    const pageLeads = leads.slice(start, start + TRACKING_PAGE_SIZE);
    const selectedIds = state.trackingSelectedIds;
    pruneSelection(selectedIds, pageLeads);

    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, [
        buildSelectAllTh(pageLeads, selectedIds, (checked) => {
          pageLeads.forEach((l) => { if (checked) selectedIds.add(l.id); else selectedIds.delete(l.id); });
          renderContent();
        }),
        ...TRACKING_COLUMNS.map((c) => buildSortableTh(c.label, c.key, state.trackingSort, sortTracking)),
      ]),
    ]));
    const tbody = create("tbody");
    if (!pageLeads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "12" }, [text("No leads match this filter.")])]));
    }

    pageLeads.forEach((l) => {
      const selectTd = buildRowSelectTd(l, selectedIds, (id, checked) => {
        if (checked) selectedIds.add(id); else selectedIds.delete(id);
        renderContent();
      });
      const statusCell = buildStatusSelectCell(l, null);
      const attemptsCell = buildAttemptsCell(l);

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
      const salesPersonSelect = buildSalesPersonCell(l, null);

      tbody.appendChild(create("tr", {}, [
        selectTd,
        create("td", { class: "num" }, [text(l.created_date)]),
        create("td", { class: "phone-cell" }, [buildPhoneCell(l)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [salesPersonSelect]),
        create("td", { class: "wrap" }, [statusCell]),
        attemptsCell,
        create("td", {}, [hvDateInput]),
        create("td", {}, [remarksInput]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", {}, [buildEmailLink(l.email)]),
        create("td", { class: "id-cell" }, [text(l.id)]),
      ]));
    });

    table.appendChild(tbody);

    const prevBtn = create("button", { class: "btn btn-outline" }, [text("Previous")]);
    prevBtn.disabled = state.trackingTablePage <= 1;
    prevBtn.addEventListener("click", () => { state.trackingTablePage -= 1; renderContent(); });

    const nextBtn = create("button", { class: "btn btn-outline" }, [text("Next")]);
    nextBtn.disabled = state.trackingTablePage >= totalPages;
    nextBtn.addEventListener("click", () => { state.trackingTablePage += 1; renderContent(); });

    const pagination = create("div", { class: "pagination-row" }, [
      prevBtn,
      create("span", { class: "pagination-label" }, [text(`Page ${state.trackingTablePage} of ${totalPages}`)]),
      nextBtn,
    ]);

    const bulkBar = buildBulkStatusBar(selectedIds);

    return create("div", {}, [
      ...(bulkBar ? [bulkBar] : []),
      create("div", { class: "table-scroll" }, [table]),
      pagination,
    ]);
  }

  // ---------- Home Visit sub-tab ----------

  function computeHomeVisitKPIs(areaLeads) {
    const booked = areaLeads.filter((l) => hasStatus(l, "Home Visit Booked") && l.home_visit_date);
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

  const HV_COLUMNS = [
    { key: "home_visit_date", label: "Home Visit Date", value: (l) => l.home_visit_date || "" },
    { key: "phone", label: "Phone", value: (l) => cleanPhone(l.phone) },
    { key: "full_name", label: "Client Name", value: (l) => (l.full_name || "").toLowerCase() },
    { key: "sales_person", label: "Called by", value: (l) => (l.sales_person || "").toLowerCase() },
    { key: "status", label: "Status", value: (l) => STATUS_OPTIONS.indexOf(primaryStatus(l)) },
    { key: "sales_value", label: "Sales Value (Rs)", value: (l) => (l.sales_value === null || l.sales_value === undefined ? -1 : l.sales_value) },
    { key: "model_name", label: "Model Name", value: (l) => (l.model_name || "").toLowerCase() },
    { key: "street_address", label: "Street Address", value: (l) => (l.street_address || "").toLowerCase() },
    { key: "email", label: "Email", value: (l) => (l.email || "").toLowerCase() },
    { key: "id", label: "Customer ID", value: (l) => l.id },
  ];

  function sortHV(key) {
    if (state.hvSort.key === key) {
      state.hvSort = { key, dir: state.hvSort.dir === "asc" ? "desc" : "asc" };
    } else {
      state.hvSort = { key, dir: "asc" };
    }
    state.hvTablePage = 1;
    renderContent();
  }

  function buildHomeVisitTable(rawLeads) {
    const leads = sortLeadsBy(rawLeads, HV_COLUMNS, state.hvSort);
    const totalPages = Math.max(1, Math.ceil(leads.length / HV_PAGE_SIZE));
    if (state.hvTablePage > totalPages) state.hvTablePage = totalPages;
    if (state.hvTablePage < 1) state.hvTablePage = 1;
    const start = (state.hvTablePage - 1) * HV_PAGE_SIZE;
    const pageLeads = leads.slice(start, start + HV_PAGE_SIZE);
    const selectedIds = state.hvSelectedIds;
    pruneSelection(selectedIds, pageLeads);

    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, [
        buildSelectAllTh(pageLeads, selectedIds, (checked) => {
          pageLeads.forEach((l) => { if (checked) selectedIds.add(l.id); else selectedIds.delete(l.id); });
          renderContent();
        }),
        ...HV_COLUMNS.map((c) => buildSortableTh(c.label, c.key, state.hvSort, sortHV)),
      ]),
    ]));
    const tbody = create("tbody");
    if (!pageLeads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "11" }, [text("No leads match this filter.")])]));
    }
    pageLeads.forEach((l) => {
      const selectTd = buildRowSelectTd(l, selectedIds, (id, checked) => {
        if (checked) selectedIds.add(id); else selectedIds.delete(id);
        renderContent();
      });
      const dateInput = buildHomeVisitDateCell(l, () => renderContent());
      const statusCell = buildStatusSelectCell(l, () => renderContent());
      const salesPersonSelect = buildSalesPersonCell(l, () => renderContent());
      const salesValueInput = buildSalesValueCell(l, null);
      const modelNameInput = buildModelNameCell(l, null);
      tbody.appendChild(create("tr", {}, [
        selectTd,
        create("td", {}, [dateInput]),
        create("td", { class: "phone-cell" }, [buildPhoneCell(l)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [salesPersonSelect]),
        create("td", { class: "wrap" }, [statusCell]),
        create("td", {}, [salesValueInput]),
        create("td", { class: "wrap" }, [modelNameInput]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", {}, [buildEmailLink(l.email)]),
        create("td", { class: "id-cell" }, [text(l.id)]),
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

    const bulkBar = buildBulkStatusBar(selectedIds);

    return create("div", {}, [
      ...(bulkBar ? [bulkBar] : []),
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

  function primaryHVStatus(lead) {
    return HV_PIPELINE_STATUSES.find((s) => hasStatus(lead, s)) || primaryStatus(lead);
  }

  function buildVisitChip(lead, cellEl) {
    const chip = create("button", { class: "visit-chip status-" + slug(primaryHVStatus(lead)) }, [
      create("div", { class: "visit-chip-name" }, [text(`Client: ${lead.full_name || lead.id}`)]),
      create("div", { class: "visit-chip-sales" }, [text(`Called by: ${lead.sales_person || "No One"}`)]),
      create("div", { class: "visit-chip-meta" }, [text(lead.street_address || "—")]),
      create("div", { class: "visit-chip-meta" }, [text(`${lead.campaign_name || "—"} / ${lead.ad_name || "—"}`)]),
      create("div", { class: "visit-chip-meta" }, [text(lead.area || "—")]),
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
      statusList(l).forEach((s) => {
        if (statusCounts.has(s)) statusCounts.set(s, statusCounts.get(s) + 1);
      });
    });
    const statusKpiPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Home Visit Status Breakdown")]),
      create("div", { class: "kpi-grid" },
        HV_PIPELINE_STATUSES.map((s) => buildKpiCard(String(statusCounts.get(s)), s))
      ),
    ]);
    content.appendChild(statusKpiPanel);

    const hvFiltered = leads.filter((l) => state.hvStatusFilter === "all" || hasStatus(l, state.hvStatusFilter));

    const tablePanel = create("div", { class: "panel" }, [
      create("div", { class: "hv-filter-row" }, [buildHVStatusFilterField()]),
      create("h3", {}, [text("Home Visit Details")]),
      buildHomeVisitTable(hvFiltered),
    ]);
    content.appendChild(tablePanel);

    const calendarLeads = areaLeads.filter((l) => l.home_visit_date && hasAnyStatus(l, HV_PIPELINE_STATUSES) && (state.hvStatusFilter === "all" || hasStatus(l, state.hvStatusFilter)));
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
      if (state.ovStatusFilter !== "all" && !hasStatus(l, state.ovStatusFilter)) return false;
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
        // Drag-and-drop needs a mouse - it doesn't fire on touchscreens at
        // all, so every card also gets a plain <select> as a tap-friendly
        // (and keyboard-friendly) way to move it between areas.
        const moveSelect = create("select", { class: "campaign-move-select" });
        moveSelect.appendChild(create("option", { value: "" }, [text("Move to…")]));
        columns.forEach((destCol) => {
          if (destCol.area === col.area) return;
          moveSelect.appendChild(create("option", { value: destCol.area || MOVE_UNASSIGNED }, [text(destCol.label)]));
        });
        moveSelect.addEventListener("click", (e) => e.stopPropagation());
        moveSelect.addEventListener("change", async () => {
          if (!moveSelect.value) return;
          const destArea = moveSelect.value === MOVE_UNASSIGNED ? null : moveSelect.value;
          const destLabel = moveSelect.options[moveSelect.selectedIndex].textContent;
          try {
            await fetchJSON("/api/campaign-map", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ campaign: c.name, area: destArea }),
            });
            showToast(`${c.name} → ${destLabel}`);
            await loadAll();
          } catch (err) {
            alert("Could not move campaign: " + err.message);
            moveSelect.value = "";
          }
        });

        const card = create("div", { class: "campaign-card", draggable: "true" }, [
          create("div", { class: "campaign-card-top" }, [
            create("span", { class: "campaign-card-name" }, [text(c.name)]),
            create("span", { class: "count num" }, [text(String(c.count))]),
          ]),
          moveSelect,
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
        text("Drag a campaign card into an area column (or use its \"Move to…\" menu on touch devices) to route its leads there. New campaigns from future uploads land in Unassigned until you place them."),
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
    setupLeadsDetailModal();
    setupStatusMultiSelectAutoClose();
    setupFilterBar();
    setupSubTabs();
    loadAll().catch((err) => {
      el("#emptyState").classList.remove("hidden");
      el("#emptyState").querySelector("p").textContent = "Failed to load data: " + err.message;
    });
  });
})();
