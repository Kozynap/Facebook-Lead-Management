(function () {
  "use strict";

  const STATUS_COLORS = {
    "New":             { bg: "#dbeafe", text: "#1e40af" },
    "Follow up":       { bg: "#fef3c7", text: "#92400e" },
    "Payment Pending": { bg: "#ede9fe", text: "#5b21b6" },
    "Dead":            { bg: "#fee2e2", text: "#991b1b" },
    "Converted":       { bg: "#dcfce7", text: "#166534" },
  };
  const STATUS_OPTIONS = window.STATUS_OPTIONS || Object.keys(STATUS_COLORS);

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
    renderMonthFilter();
    renderCampaignTabs();
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

  function renderCampaignTabs() {
    const nav = el("#campaignTabs");
    nav.innerHTML = "";
    const empty = el("#emptyState");

    if (!state.meta.campaigns.length) {
      empty.classList.remove("hidden");
      el("#content").querySelectorAll(".panel, .subtabs").forEach((n) => n.remove());
      return;
    }
    empty.classList.add("hidden");

    state.meta.campaigns.forEach((c) => {
      const btn = create(
        "button",
        {
          class: "tab-btn" + (c.name === state.selectedCampaign ? " active" : ""),
          onclick: () => {
            state.selectedCampaign = c.name;
            state.adNameFilter = "all";
            render();
          },
        },
        [text(c.name), create("span", { class: "tab-count" }, [text(`(${c.count})`)])]
      );
      nav.appendChild(btn);
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
    content.querySelectorAll(".subtabs, .panel").forEach((n) => n.remove());
    if (!state.selectedCampaign) return;

    const campaignLeads = leadsForCampaign(state.selectedCampaign, state.selectedMonth);
    el("#leadCountSummary").textContent = `${campaignLeads.length} lead${campaignLeads.length === 1 ? "" : "s"} in "${state.selectedCampaign}"`;

    const subtabs = create("div", { class: "subtabs" }, [
      create("button", {
        class: "subtab-btn" + (state.selectedSubTab === "dashboard" ? " active" : ""),
        onclick: () => { state.selectedSubTab = "dashboard"; render(); },
      }, [text("Dashboard")]),
      create("button", {
        class: "subtab-btn" + (state.selectedSubTab === "tracking" ? " active" : ""),
        onclick: () => { state.selectedSubTab = "tracking"; render(); },
      }, [text("Client Tracking")]),
    ]);
    content.appendChild(subtabs);

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
      create("h3", {}, [text(`Leads by Ad (${monthLabel(state.selectedMonth)})`)]),
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
        buildAdNameFilterSelect(adNames),
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
        create("td", {}, [text(String(count))]),
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  function buildAdNameFilterSelect(adNames) {
    const sel = create("select", {
      onchange: (e) => { state.adNameFilter = e.target.value; renderContent(); },
    });
    sel.appendChild(create("option", { value: "all" }, [text("All ads")]));
    adNames.forEach((name) => {
      sel.appendChild(create("option", { value: name }, [text(name)]));
    });
    sel.value = state.adNameFilter;
    return sel;
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
        create("td", {}, [text(l.id)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [text(l.email)]),
        create("td", {}, [text(l.phone)]),
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
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: rows.map(([name]) => name),
        datasets: [{
          label: "Leads",
          data: rows.map(([, count]) => count),
          backgroundColor: "#2563eb",
          borderRadius: 4,
          maxBarThickness: 46,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 0 } },
        },
      },
    });
  }

  // ---------- Client Tracking sub-tab ----------

  function renderClientTracking(campaignLeads) {
    const content = el("#content");
    const panel = create("div", { class: "panel" }, [
      create("h3", {}, [text("Client Tracking")]),
      create("div", { class: "table-scroll" }, [buildTrackingTable(campaignLeads)]),
    ]);
    content.appendChild(panel);
  }

  function styleStatusSelect(selectNode, status) {
    const c = STATUS_COLORS[status] || STATUS_COLORS["New"];
    selectNode.style.background = c.bg;
    selectNode.style.color = c.text;
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
      styleStatusSelect(statusSelect, l.status);
      statusSelect.addEventListener("change", async () => {
        const newStatus = statusSelect.value;
        try {
          await fetchJSON(`/api/leads/${encodeURIComponent(l.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          l.status = newStatus;
          styleStatusSelect(statusSelect, newStatus);
        } catch (err) {
          alert("Could not save status: " + err.message);
          statusSelect.value = l.status;
          styleStatusSelect(statusSelect, l.status);
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
          remarksInput.classList.add("saved");
          setTimeout(() => remarksInput.classList.remove("saved"), 800);
        } catch (err) {
          alert("Could not save remarks: " + err.message);
        }
      };
      remarksInput.addEventListener("blur", saveRemarks);
      remarksInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); remarksInput.blur(); }
      });

      tbody.appendChild(create("tr", {}, [
        create("td", {}, [text(l.id)]),
        create("td", { class: "wrap" }, [text(l.full_name)]),
        create("td", {}, [text(l.email)]),
        create("td", {}, [text(l.phone)]),
        create("td", { class: "wrap" }, [text(l.street_address)]),
        create("td", {}, [statusSelect]),
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

  function setupMonthFilter() {
    el("#monthFilter").addEventListener("change", (e) => {
      state.selectedMonth = e.target.value;
      renderContent();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupUploadModal();
    setupMonthFilter();
    loadAll().catch((err) => {
      el("#emptyState").classList.remove("hidden");
      el("#emptyState").querySelector("p").textContent = "Failed to load data: " + err.message;
    });
  });
})();
