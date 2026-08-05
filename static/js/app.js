(function () {
  "use strict";

  const STATUS_OPTIONS = window.STATUS_OPTIONS || ["New", "Follow up", "Payment Pending", "Dead", "Converted"];

  const slug = (s) => s.replace(/\s+/g, "-");

  const state = {
    leads: [],
    meta: { months: [], campaigns: [] },
    selectedMonth: "all",
    selectedCampaign: null,
    selectedSubTab: "dashboard",
    adNameFilter: "all",
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
    const [meta, leads] = await Promise.all([
      fetchJSON("/api/meta"),
      fetchJSON("/api/leads"),
    ]);
    state.meta = meta;
    state.leads = leads;

    if (state.selectedCampaign === null || !meta.campaigns.some((c) => c.name === state.selectedCampaign)) {
      state.selectedCampaign = meta.campaigns.length ? meta.campaigns[0].name : null;
    }
    render();
  }

  function render() {
    el("#lastCreated").textContent = state.meta.last_created || "—";
    el("#lastUpdated").textContent = state.meta.last_updated || "—";
    el("#kpiCampaignCount").textContent = state.meta.campaigns.length;
    el("#footerTotalLeads").textContent = state.leads.length;
    el("#footerPeriod").textContent = monthLabel(state.selectedMonth);

    renderMonthFilter();
    renderSidebarNav();
    renderSubTabBar();
    renderContent();
  }

  function renderMonthFilter() {
    const sel = el("#monthFilter");
    const current = state.selectedMonth;
    sel.innerHTML = "";
    sel.appendChild(create("option", { value: "all" }, [text("All months")]));
    state.meta.months.forEach((m) => {
      sel.appendChild(create("option", { value: m.value }, [text(m.label)]));
    });
    sel.value = state.meta.months.some((m) => m.value === current) || current === "all" ? current : "all";
    state.selectedMonth = sel.value;
  }

  function renderSidebarNav() {
    const nav = el("#campaignNav");
    nav.innerHTML = "";
    const emptyState = el("#emptyState");
    const filterbar = document.querySelector(".filterbar");
    const subTabs = el("#subTabs");

    if (!state.meta.campaigns.length) {
      nav.appendChild(create("div", { class: "nav-empty" }, [text("No campaigns yet")]));
      emptyState.classList.remove("hidden");
      filterbar.classList.add("hidden");
      subTabs.classList.add("hidden");
      el("#pageTitle").textContent = "Facebook Leads";
      el("#content").querySelectorAll(".panel").forEach((n) => n.remove());
      return;
    }
    emptyState.classList.add("hidden");
    filterbar.classList.remove("hidden");
    subTabs.classList.remove("hidden");

    state.meta.campaigns.forEach((c, i) => {
      const btn = create(
        "button",
        {
          class: "nav-item" + (c.name === state.selectedCampaign ? " active" : ""),
          onclick: () => {
            state.selectedCampaign = c.name;
            state.adNameFilter = "all";
            render();
          },
        },
        [
          create("span", { class: "nav-num" }, [text(String(i + 1).padStart(2, "0"))]),
          create("span", { class: "nav-label" }, [text(c.name)]),
          create("span", { class: "nav-count num" }, [text(String(c.count))]),
        ]
      );
      nav.appendChild(btn);
    });

    el("#pageTitle").textContent = state.selectedCampaign;
  }

  function renderSubTabBar() {
    document.querySelectorAll("#subTabs .tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.subtab === state.selectedSubTab);
    });
  }

  function leadsForCampaign(campaign, month) {
    return state.leads.filter((l) => {
      if (campaign !== null && l.campaign_name !== campaign) return false;
      if (month !== "all" && l.created_month !== month) return false;
      return true;
    });
  }

  function renderContent() {
    const content = el("#content");
    content.querySelectorAll(".panel").forEach((n) => n.remove());
    if (!state.selectedCampaign) return;

    const campaignLeads = leadsForCampaign(state.selectedCampaign, state.selectedMonth);
    el("#kpiLeadsInView").textContent = campaignLeads.length;

    if (state.selectedSubTab === "dashboard") {
      renderDashboard(campaignLeads);
    } else {
      renderClientTracking(campaignLeads);
    }
  }

  // ---------- Dashboard sub-tab ----------

  function renderDashboard(campaignLeads) {
    const content = el("#content");

    const counts = new Map();
    campaignLeads.forEach((l) => {
      const key = l.ad_name || "(no ad name)";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    const chartPanel = create("div", { class: "panel" }, [
      create("h3", {}, [text(`Leads by Ad — ${monthLabel(state.selectedMonth)}`)]),
      create("div", { class: "dashboard-grid" }, [
        create("div", { class: "chart-wrap" }, [create("canvas", { id: "adChart" })]),
        create("div", { class: "table-scroll" }, [buildCountTable(rows)]),
      ]),
    ]);
    content.appendChild(chartPanel);

    drawChart(rows);

    const adNames = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    const filtered = state.adNameFilter === "all" ? campaignLeads : campaignLeads.filter((l) => (l.ad_name || "(no ad name)") === state.adNameFilter);

    const clientPanel = create("div", { class: "panel" }, [
      create("div", { class: "panel-header-row" }, [
        create("h3", {}, [text("Client Details")]),
        create("div", { style: "display:flex; align-items:flex-end; gap:14px;" }, [
          buildAdNameFilterField(adNames),
          create("a", {
            href: "#",
            class: "filter-clear",
            onclick: (e) => { e.preventDefault(); state.adNameFilter = "all"; renderContent(); },
          }, [text("Clear")]),
        ]),
      ]),
      create("div", { class: "table-scroll" }, [buildClientDetailsTable(filtered)]),
    ]);
    content.appendChild(clientPanel);
  }

  function monthLabel(value) {
    if (value === "all") return "All months";
    const m = state.meta.months.find((x) => x.value === value);
    return m ? m.label : value;
  }

  function buildCountTable(rows) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, [create("th", {}, [text("Ad Name")]), create("th", {}, [text("Count")])]),
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

  function buildAdNameFilterField(adNames) {
    const sel = create("select", {
      onchange: (e) => { state.adNameFilter = e.target.value; renderContent(); },
    });
    sel.appendChild(create("option", { value: "all" }, [text("All ads")]));
    adNames.forEach((name) => {
      sel.appendChild(create("option", { value: name }, [text(name)]));
    });
    sel.value = state.adNameFilter;
    return create("div", { class: "filter-field" }, [
      create("label", {}, [text("Ad Name")]),
      sel,
    ]);
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

  function renderClientTracking(campaignLeads) {
    const content = el("#content");
    const downloadBtn = create("button", {
      class: "btn btn-outline",
      onclick: downloadTrackingExcel,
    }, [text("Download Excel")]);

    const panel = create("div", { class: "panel" }, [
      create("div", { class: "panel-header-row" }, [
        create("h3", {}, [text("Client Tracking")]),
        downloadBtn,
      ]),
      create("div", { class: "table-scroll" }, [buildTrackingTable(campaignLeads)]),
    ]);
    content.appendChild(panel);
  }

  function downloadTrackingExcel() {
    const params = new URLSearchParams({
      campaign: state.selectedCampaign || "",
      month: state.selectedMonth,
    });
    window.location.href = `/api/export/tracking?${params.toString()}`;
  }

  function applyStatusBadgeClass(badge, status) {
    badge.className = "status-badge status-" + slug(status);
  }

  function buildTrackingTable(leads) {
    const table = create("table", { class: "data-table" });
    table.appendChild(create("thead", {}, [
      create("tr", {}, ["Lead ID", "Full Name", "Email", "Phone", "Street Address", "Status", "Remarks"].map((h) => create("th", {}, [text(h)]))),
    ]));
    const tbody = create("tbody");
    if (!leads.length) {
      tbody.appendChild(create("tr", {}, [create("td", { colspan: "7" }, [text("No leads match this filter.")])]));
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

      statusSelect.addEventListener("change", async () => {
        const newStatus = statusSelect.value;
        try {
          await fetchJSON(`/api/leads/${encodeURIComponent(l.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          l.status = newStatus;
          applyStatusBadgeClass(badge, newStatus);
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
        create("td", {}, [remarksInput]),
      ]));
    });

    table.appendChild(tbody);
    return table;
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

  function setupFilterBar() {
    el("#monthFilter").addEventListener("change", (e) => {
      state.selectedMonth = e.target.value;
      el("#footerPeriod").textContent = monthLabel(state.selectedMonth);
      renderContent();
    });
    el("#clearMonthFilter").addEventListener("click", (e) => {
      e.preventDefault();
      state.selectedMonth = "all";
      renderMonthFilter();
      el("#footerPeriod").textContent = monthLabel(state.selectedMonth);
      renderContent();
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
