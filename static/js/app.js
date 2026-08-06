(function () {
  "use strict";

  const STATUS_OPTIONS = window.STATUS_OPTIONS || ["New", "Follow up", "Warm", "Booked", "Cold"];
  const NAV_MAPPING = "__mapping__";

  const slug = (s) => s.replace(/\s+/g, "-");

  const state = {
    leads: [],
    meta: { months: [], areas: [], unassigned_campaign_count: 0 },
    campaignMap: [],
    selectedNav: null,
    selectedMonth: "all",
    selectedCampaign: "all",
    selectedStatus: "all",
    selectedSubTab: "dashboard",
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
    render();
  }

  function renderSidebarNav() {
    const nav = el("#sidebarNav");
    nav.innerHTML = "";

    state.meta.areas.forEach((a, i) => {
      const btn = create(
        "button",
        { class: "nav-item" + (state.selectedNav === a.name ? " active" : ""), onclick: () => selectNav(a.name) },
        [
          create("span", { class: "nav-num" }, [text(String(i + 1).padStart(2, "0"))]),
          create("span", { class: "nav-label" }, [text(a.name)]),
          create("span", { class: "nav-count num" }, [text(String(a.count))]),
        ]
      );
      nav.appendChild(btn);
    });

    const mappingChildren = [
      create("span", { class: "nav-num" }, [text(String(state.meta.areas.length + 1).padStart(2, "0"))]),
      create("span", { class: "nav-label" }, [text("Campaign-Area Mapping")]),
    ];
    if (state.meta.unassigned_campaign_count > 0) {
      mappingChildren.push(create("span", { class: "nav-badge" }, [text(String(state.meta.unassigned_campaign_count))]));
    }
    const mapBtn = create(
      "button",
      { class: "nav-item" + (state.selectedNav === NAV_MAPPING ? " active" : ""), onclick: () => selectNav(NAV_MAPPING) },
      mappingChildren
    );
    nav.appendChild(mapBtn);

    el("#pageTitle").textContent =
      state.selectedNav === NAV_MAPPING ? "Campaign-Area Mapping" : state.selectedNav || "Facebook Leads";
  }

  // ---------- Filters ----------

  function renderFilters() {
    const isMapping = state.selectedNav === NAV_MAPPING;
    const showFilters = !isMapping && state.leads.length > 0;
    el("#filterBar").classList.toggle("hidden", !showFilters);
    el("#subTabs").classList.toggle("hidden", !showFilters);
    if (!showFilters) return;

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
      el("#footerPeriod").textContent = monthLabel(state.selectedMonth);
      renderContent();
    });
    el("#campaignFilter").addEventListener("change", (e) => {
      state.selectedCampaign = e.target.value;
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

    const filtered = leadsForView();
    el("#kpiLeadsInView").textContent = filtered.length;

    if (state.selectedSubTab === "dashboard") {
      renderDashboard(filtered);
    } else {
      renderClientTracking(filtered);
    }
  }

  // ---------- Dashboard sub-tab ----------

  function renderDashboard(leads) {
    const content = el("#content");
    const byCampaign = state.selectedCampaign === "all";
    const dimLabel = byCampaign ? "Campaign" : "Ad";
    const dimKey = byCampaign ? "campaign_name" : "ad_name";

    const counts = new Map();
    leads.forEach((l) => {
      const key = l[dimKey] || `(no ${dimLabel.toLowerCase()})`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    const chartPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text(`Leads by ${dimLabel} — ${monthLabel(state.selectedMonth)}`)]),
      create("div", { class: "dashboard-grid" }, [
        create("div", { class: "chart-wrap" }, [create("canvas", { id: "adChart" })]),
        create("div", { class: "table-scroll" }, [buildCountTable(rows, dimLabel)]),
      ]),
    ]);
    content.appendChild(chartPanel);

    drawChart(rows);

    const clientPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Client Details")]),
      create("div", { class: "table-scroll" }, [buildClientDetailsTable(leads)]),
    ]);
    content.appendChild(clientPanel);
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

  function buildClientDetailsTable(leads) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Lead ID", "Full Name", "Email", "Phone", "Street Address"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!leads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "5" }, [text("No leads match this filter.")])]));
    }
    leads.forEach((l) => {
      tbody.appendChild(create("tr", {}, [
        create("td", { class: "id-cell" }, [text(l.id)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [text(l.email)]),
        create("td", { class: "phone-cell" }, [text(l.phone)]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
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

  // ---------- Client Tracking sub-tab ----------

  function renderClientTracking(leads) {
    const content = el("#content");
    const downloadBtn = create("button", { class: "btn btn-outline", onclick: downloadTrackingExcel }, [text("Download Excel")]);

    const panel = create("div", { class: "panel" }, [
      create("div", { class: "panel-header-row" }, [
        create("h3", {}, [text("Client Tracking")]),
        downloadBtn,
      ]),
      create("div", { class: "table-scroll" }, [buildTrackingTable(leads)]),
    ]);
    content.appendChild(panel);
  }

  function downloadTrackingExcel() {
    const params = new URLSearchParams({
      area: state.selectedNav || "",
      month: state.selectedMonth,
      campaign: state.selectedCampaign === "all" ? "" : state.selectedCampaign,
      status: state.selectedStatus,
    });
    window.location.href = `/api/export/tracking?${params.toString()}`;
  }

  function applyStatusBadgeClass(badge, status) {
    badge.className = "status-badge status-" + slug(status);
  }

  function buildTrackingTable(leads) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Lead ID", "Full Name", "Email", "Phone", "Street Address", "Status", "Attempts Made", "Remarks"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!leads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "8" }, [text("No leads match this filter.")])]));
    }

    leads.forEach((l) => {
      const statusSelect = create("select", { class: "status-select" });
      STATUS_OPTIONS.forEach((opt) => {
        statusSelect.appendChild(create("option", { value: opt }, [text(opt)]));
      });
      statusSelect.value = l.status;

      const dot = create("span", { class: "dot" });
      const badge = create("span", { class: "status-badge" }, [dot, statusSelect]);
      applyStatusBadgeClass(badge, l.status);

      const attemptsCell = create("td", { class: "num" }, [text(`Attempt ${l.attempts}`)]);

      statusSelect.addEventListener("change", async () => {
        const newStatus = statusSelect.value;
        try {
          const updated = await fetchJSON(`/api/leads/${encodeURIComponent(l.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          l.status = updated.status;
          l.attempts = updated.attempts;
          applyStatusBadgeClass(badge, l.status);
          attemptsCell.textContent = `Attempt ${l.attempts}`;
          showToast("Status saved");
        } catch (err) {
          alert("Could not save status: " + err.message);
          statusSelect.value = l.status;
          applyStatusBadgeClass(badge, l.status);
        }
      });

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

      tbody.appendChild(create("tr", {}, [
        create("td", { class: "id-cell" }, [text(l.id)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [text(l.email)]),
        create("td", { class: "phone-cell" }, [text(l.phone)]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", {}, [badge]),
        attemptsCell,
        create("td", {}, [remarksInput]),
      ]));
    });

    table.appendChild(tbody);
    return table;
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
    setupFilterBar();
    setupSubTabs();
    loadAll().catch((err) => {
      el("#emptyState").classList.remove("hidden");
      el("#emptyState").querySelector("p").textContent = "Failed to load data: " + err.message;
    });
  });
})();
