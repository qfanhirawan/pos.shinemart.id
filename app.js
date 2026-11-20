(function () {
  "use strict";

  const cfg = window.SHINEMART_CONFIG || {};
  const PAGE_SIZE = 30;

  let sb = null;
  let currentUser = null;
  let branches = [];
  let branchMap = {};
  let selectedBranch = "ALL";
  let activeTab = "tabDashboard";
  let prodPage = 0;
  let currentProducts = [];
  let categoriesCache = [];

  const el = (id) => document.getElementById(id);

  function escapeHtml(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtRp(num) {
    const n = Number(num || 0);
    const prefix = n < 0 ? "-Rp " : "Rp ";
    return prefix + Math.round(Math.abs(n)).toLocaleString("id-ID");
  }

  function fmtNum(num) {
    return Number(num || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function toStartIso(dateStr) {
    return new Date(`${dateStr}T00:00:00`).toISOString();
  }

  function toEndIso(dateStr) {
    return new Date(`${dateStr}T23:59:59.999`).toISOString();
  }

  function fmtDateTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function branchNameOf(code) {
    return branchMap[code] ? branchMap[code].branch_name : code;
  }

  function showToast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.add("hidden"), 3200);
  }

  function isKgUnit(unitName) {
    const u = String(unitName || "").trim().toLowerCase();
    return u === "kg" || u === "kilogram" || u === "kilo" || u === "kgs";
  }

  function translateAuditAction(actionType) {
    const map = {
      CREATE_SALE: "Transaksi Penjualan",
      VOID_SALE: "VOID Struk Penjualan",
      RETURN_SALE: "Retur Penjualan",
      REMOVE_CART_ITEM: "Hapus Item Kasir (PIN)",
      REMOVE_CART_ITEM_DIRECT: "Hapus Item Kasir",
      MANUAL_DISCOUNT: "Diskon Manual Kasir",
      OPEN_SHIFT: "Buka Shift Kasir",
      CLOSE_SHIFT: "Tutup Shift Kasir",
      CASH_IN: "Kas Masuk Laci",
      CASH_OUT: "Kas Keluar Laci",
      CREATE_PRODUCT: "Tambah Produk Baru",
      UPDATE_PRODUCT: "Update Master Produk",
      PRICE_CHANGE: "Ubah Harga / HPP Produk",
      DELETE_PRODUCT: "Hapus Produk",
      DEACTIVATE_PRODUCT: "Nonaktifkan Produk",
      RECEIVE_PURCHASE: "Penerimaan Pembelian",
      RETURN_PURCHASE: "Retur Pembelian",
      RECORD_WASTE: "Catat Barang Rusak (Waste)",
      APPROVE_OPNAME: "Setujui / Mutasi Stok",
      PAY_PURCHASE_DEBT: "Bayar Utang Pemasok",
      COLLECT_RECEIVABLE: "Terima Piutang Pelanggan",
      LOGIN: "Login Aplikasi",
      LOGOUT: "Logout Aplikasi",
      CREATE_USER: "Tambah Akun Pengguna",
      UPDATE_USER: "Ubah Akun Pengguna",
      UPDATE_ROLE_PERMISSIONS: "Ubah Hak Akses Role"
    };
    return map[String(actionType || "").toUpperCase()] || actionType || "-";
  }

  function isHighRiskAudit(actionType) {
    const code = String(actionType || "").toUpperCase();
    return [
      "VOID_SALE",
      "RETURN_SALE",
      "REMOVE_CART_ITEM",
      "REMOVE_CART_ITEM_DIRECT",
      "MANUAL_DISCOUNT",
      "PRICE_CHANGE",
      "DELETE_PRODUCT",
      "RECORD_WASTE",
      "CASH_OUT",
      "UPDATE_ROLE_PERMISSIONS"
    ].includes(code);
  }

  function applyBranchFilter(query) {
    return selectedBranch !== "ALL" ? query.eq("branch_code", selectedBranch) : query;
  }

  async function init() {
    el("headerBrandTitle").textContent = cfg.APP_TITLE || "ShineMart Monitor";

    const today = todayStr();
    el("dashDateBadge").textContent = new Date().toLocaleDateString("id-ID", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
    el("salesFrom").value = today;
    el("salesTo").value = today;
    el("shiftFrom").value = today;
    el("shiftTo").value = today;
    el("auditFrom").value = today;
    el("auditTo").value = today;

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || cfg.SUPABASE_KEY.includes("TEMPEL_")) {
      el("configWarning").classList.remove("hidden");
      el("btnLogin").disabled = true;
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
    bindEvents();

    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) {
      currentUser = data.session.user;
      await enterApp();
    } else {
      showLogin();
    }
  }

  function bindEvents() {
    el("loginForm").addEventListener("submit", handleLogin);
    el("btnLogout").addEventListener("click", handleLogout);
    el("btnRefreshAll").addEventListener("click", () => refreshActiveTab());
    el("branchSelect").addEventListener("change", () => {
      selectedBranch = el("branchSelect").value;
      prodPage = 0;
      updateHeaderSyncInfo();
      refreshActiveTab();
    });

    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
    });

    el("btnFilterSales").addEventListener("click", loadSales);
    el("btnProdSearch").addEventListener("click", () => {
      prodPage = 0;
      loadProducts();
    });
    el("prodSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        prodPage = 0;
        loadProducts();
      }
    });
    el("prodFilterMode").addEventListener("change", () => {
      prodPage = 0;
      loadProducts();
    });
    el("btnProdPrev").addEventListener("click", () => {
      if (prodPage > 0) {
        prodPage--;
        loadProducts();
      }
    });
    el("btnProdNext").addEventListener("click", () => {
      prodPage++;
      loadProducts();
    });

    el("btnAddProduct").addEventListener("click", openNewProductModal);
    el("btnViewQueue").addEventListener("click", openQueueModal);
    el("productEditForm").addEventListener("submit", handleProductSubmit);
    el("stockAdjustForm").addEventListener("submit", handleStockAdjustSubmit);

    el("btnFilterShiftCash").addEventListener("click", loadShiftAndCash);
    el("subBtnShifts").addEventListener("click", () => {
      el("subBtnShifts").classList.add("active");
      el("subBtnCashFlows").classList.remove("active");
      el("subViewShifts").classList.remove("hidden");
      el("subViewCashFlows").classList.add("hidden");
    });
    el("subBtnCashFlows").addEventListener("click", () => {
      el("subBtnCashFlows").classList.add("active");
      el("subBtnShifts").classList.remove("active");
      el("subViewCashFlows").classList.remove("hidden");
      el("subViewShifts").classList.add("hidden");
    });

    el("btnFilterAudit").addEventListener("click", loadAuditLogs);

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => el(btn.getAttribute("data-close")).classList.add("hidden"));
    });
    document.querySelectorAll(".modal-backdrop").forEach((bg) => {
      bg.addEventListener("click", (e) => {
        if (e.target === bg) bg.classList.add("hidden");
      });
    });
  }

  function showLogin() {
    el("appView").classList.add("hidden");
    el("loginView").classList.remove("hidden");
  }

  async function handleLogin(e) {
    e.preventDefault();
    const errBox = el("loginError");
    errBox.classList.add("hidden");
    el("btnLogin").disabled = true;
    el("btnLogin").textContent = "Memeriksa akun...";

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: el("loginEmail").value.trim(),
        password: el("loginPassword").value
      });
      if (error) throw error;
      currentUser = data.user;
      await enterApp();
    } catch (err) {
      errBox.textContent = "Login gagal: " + (err.message || err);
      errBox.classList.remove("hidden");
    } finally {
      el("btnLogin").disabled = false;
      el("btnLogin").textContent = "Masuk ke Monitor";
    }
  }

  async function handleLogout() {
    await sb.auth.signOut();
    currentUser = null;
    showLogin();
  }

  async function enterApp() {
    el("loginView").classList.add("hidden");
    el("appView").classList.remove("hidden");
    await loadBranches();
    await refreshActiveTab();
  }

  async function loadBranches() {
    const { data, error } = await sb.from("v_branches").select("*").order("branch_code", { ascending: true });
    if (error) {
      showToast("Gagal memuat daftar cabang: " + error.message);
      return;
    }

    branches = data || [];
    branchMap = {};
    const sel = el("branchSelect");
    const prev = selectedBranch;
    sel.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "ALL";
    optAll.textContent = `Semua Cabang (${branches.length})`;
    sel.appendChild(optAll);

    branches.forEach((b) => {
      branchMap[b.branch_code] = b;
      const opt = document.createElement("option");
      opt.value = b.branch_code;
      opt.textContent = `${b.branch_code} — ${b.branch_name}`;
      sel.appendChild(opt);
    });

    if (prev !== "ALL" && branchMap[prev]) {
      sel.value = prev;
      selectedBranch = prev;
    } else if (branches.length === 1) {
      sel.value = branches[0].branch_code;
      selectedBranch = branches[0].branch_code;
    } else {
      sel.value = "ALL";
      selectedBranch = "ALL";
    }

    updateHeaderSyncInfo();
  }

  function updateHeaderSyncInfo() {
    if (selectedBranch === "ALL") {
      el("syncStatusText").textContent = `${branches.length} cabang terdaftar • ${currentUser ? currentUser.email : ""}`;
      return;
    }

    const b = branchMap[selectedBranch];
    el("syncStatusText").textContent = b && b.last_sync_at
      ? `Sync terakhir: ${fmtDateTime(b.last_sync_at)}`
      : "Belum pernah sync";
  }

  function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll(".tab-section").forEach((s) => {
      s.classList.toggle("hidden", s.id !== tabId);
      s.classList.toggle("active", s.id === tabId);
    });
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
    });
    refreshActiveTab();
  }

  async function refreshActiveTab() {
    updateHeaderSyncInfo();
    if (activeTab === "tabDashboard") await loadDashboard();
    else if (activeTab === "tabSales") await loadSales();
    else if (activeTab === "tabProducts") await loadProducts();
    else if (activeTab === "tabShiftCash") await loadShiftAndCash();
    else if (activeTab === "tabAudit") await loadAuditLogs();
  }

  // ---------------- TAB 1: DASHBOARD ----------------
  async function loadDashboard() {
    await loadBranches();
    const t = todayStr();
    const startIso = toStartIso(t);
    const endIso = toEndIso(t);

    const [salesRes, cfRes, prodRes] = await Promise.all([
      applyBranchFilter(
        sb.from("cloud_sales")
          .select("branch_code, grand_total, discount_amount, total_cost_amount, payment_status, payments_json")
          .gte("sale_date", startIso)
          .lte("sale_date", endIso)
      ),
      applyBranchFilter(
        sb.from("cloud_cash_flows")
          .select("branch_code, flow_type, amount")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
      ),
      applyBranchFilter(
        sb.from("cloud_products")
          .select("branch_code, local_id, sku, product_name, base_unit_name, stock_qty, min_stock_alert, is_active, is_bundle")
          .eq("is_active", true)
          .eq("is_bundle", false)
          .order("stock_qty", { ascending: true })
          .limit(300)
      )
    ]);

    if (salesRes.error) showToast("Error sales: " + salesRes.error.message);

    const sales = (salesRes.data || []).filter((s) => s.payment_status !== "VOID");
    let omzet = 0, cost = 0, disc = 0, cash = 0, qris = 0;
    const perBranchOmzet = {};

    sales.forEach((s) => {
      const gt = Number(s.grand_total || 0);
      omzet += gt;
      cost += Number(s.total_cost_amount || 0);
      disc += Number(s.discount_amount || 0);
      perBranchOmzet[s.branch_code] = (perBranchOmzet[s.branch_code] || 0) + gt;

      const pays = Array.isArray(s.payments_json) ? s.payments_json : [];
      if (pays.length === 0) {
        cash += gt;
      } else {
        let nonCashInSale = 0;
        pays.forEach((p) => {
          const m = String(p.payment_method || "").toUpperCase();
          const amt = Number(p.amount || 0);
          if (m === "QRIS") {
            qris += amt;
            nonCashInSale += amt;
          } else if (m !== "CASH") {
            nonCashInSale += amt;
          }
        });
        const cashPortion = Math.max(0, gt - nonCashInSale);
        cash += cashPortion;
      }
    });

    const profit = omzet - cost;
    const margin = omzet > 0 ? (profit / omzet) * 100 : 0;

    let cfIn = 0, cfOut = 0;
    (cfRes.data || []).forEach((c) => {
      if (c.flow_type === "CASH_IN") cfIn += Number(c.amount || 0);
      else cfOut += Number(c.amount || 0);
    });

    el("kpiOmzet").textContent = fmtRp(omzet);
    el("kpiTrxCount").textContent = `${sales.length} transaksi`;
    el("kpiProfit").textContent = fmtRp(profit);
    el("kpiMargin").textContent = `Margin ${margin.toFixed(1)}%`;
    el("kpiCash").textContent = fmtRp(cash);
    el("kpiCashInOut").textContent = `Laci +${fmtRp(cfIn)} / -${fmtRp(cfOut)}`;
    el("kpiQris").textContent = fmtRp(qris);
    el("kpiDiscountTotal").textContent = `Diskon ${fmtRp(disc)}`;

    // Branch Status Cards
    const visibleBranches = selectedBranch === "ALL" ? branches : branches.filter((b) => b.branch_code === selectedBranch);
    el("branchStatusList").innerHTML = visibleBranches.length === 0
      ? `<div class="empty-state">Belum ada cabang terdaftar.</div>`
      : visibleBranches.map((b) => {
          const bOmzet = perBranchOmzet[b.branch_code] || 0;
          return `
            <div class="item-card">
              <div class="item-top">
                <div>
                  <div class="item-title">${escapeHtml(b.branch_name)}</div>
                  <div class="item-sub">${escapeHtml(b.branch_code)} &bull; Sync: ${fmtDateTime(b.last_sync_at)}</div>
                </div>
                <strong class="text-green">${fmtRp(bOmzet)}</strong>
              </div>
            </div>`;
        }).join("");

    // Low Stock List
    const lowItems = (prodRes.data || []).filter((p) => Number(p.stock_qty) <= Number(p.min_stock_alert));
    el("lowStockBadge").textContent = `${lowItems.length} item`;
    el("lowStockList").innerHTML = lowItems.length === 0
      ? `<div class="empty-state">Semua stok produk aman di atas batas minimum.</div>`
      : lowItems.slice(0, 25).map((p) => `
          <div class="item-card">
            <div class="item-top">
              <div>
                <div class="item-title">${escapeHtml(p.product_name)}</div>
                <div class="item-sub">${escapeHtml(p.branch_code)} &bull; SKU: ${escapeHtml(p.sku)}</div>
              </div>
              <span class="pill ${Number(p.stock_qty) <= 0 ? "pill-red" : "pill-amber"}">
                Sisa ${fmtNum(p.stock_qty)} ${escapeHtml(p.base_unit_name)}
              </span>
            </div>
          </div>`).join("");
  }

  // ---------------- TAB 2: SALES ----------------
  async function loadSales() {
    const fromIso = toStartIso(el("salesFrom").value || todayStr());
    const toIso = toEndIso(el("salesTo").value || todayStr());
    const methodFilter = el("salesMethod").value;

    const { data, error } = await applyBranchFilter(
      sb.from("cloud_sales")
        .select("*")
        .gte("sale_date", fromIso)
        .lte("sale_date", toIso)
        .order("sale_date", { ascending: false })
        .limit(300)
    );

    if (error) {
      showToast("Gagal memuat penjualan: " + error.message);
      return;
    }

    let rows = data || [];
    if (methodFilter) {
      rows = rows.filter((r) => String(r.payment_methods_summary || "").toUpperCase().includes(methodFilter));
    }

    let omzet = 0, cash = 0, qris = 0, profit = 0;
    rows.forEach((s) => {
      if (s.payment_status === "VOID") return;
      const gt = Number(s.grand_total || 0);
      omzet += gt;
      profit += gt - Number(s.total_cost_amount || 0);
      const pays = Array.isArray(s.payments_json) ? s.payments_json : [];
      let nonCash = 0;
      pays.forEach((p) => {
        if (String(p.payment_method || "").toUpperCase() === "QRIS") {
          qris += Number(p.amount || 0);
          nonCash += Number(p.amount || 0);
        } else if (String(p.payment_method || "").toUpperCase() !== "CASH") {
          nonCash += Number(p.amount || 0);
        }
      });
      cash += Math.max(0, gt - nonCash);
    });

    el("salesSumOmzet").textContent = fmtRp(omzet);
    el("salesSumCash").textContent = fmtRp(cash);
    el("salesSumQris").textContent = fmtRp(qris);
    el("salesSumProfit").textContent = fmtRp(profit);

    const listEl = el("salesList");
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Tidak ada transaksi pada periode ini.</div>`;
      return;
    }

    listEl.innerHTML = rows.map((s, idx) => {
      const isVoid = s.payment_status === "VOID";
      const badgeClass = isVoid ? "pill-red" : "pill-green";
      return `
        <div class="item-card clickable ${isVoid ? "risk-high" : ""}" data-sale-idx="${idx}">
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHtml(s.invoice_no)}</div>
              <div class="item-sub">${escapeHtml(branchNameOf(s.branch_code))} &bull; ${fmtDateTime(s.sale_date)}</div>
            </div>
            <span class="pill ${badgeClass}">${escapeHtml(s.payment_status)}</span>
          </div>
          <div class="item-meta">
            <span>Kasir: <strong>${escapeHtml(s.cashier_name)}</strong></span>
            <span>Bayar: <strong>${escapeHtml(s.payment_methods_summary || "CASH")}</strong></span>
            <span>Total: <strong>${fmtRp(s.grand_total)}</strong></span>
          </div>
        </div>`;
    }).join("");

    listEl.querySelectorAll("[data-sale-idx]").forEach((card) => {
      card.addEventListener("click", () => openSaleModal(rows[Number(card.getAttribute("data-sale-idx"))]));
    });
  }

  function openSaleModal(s) {
    el("saleModalTitle").textContent = `${s.invoice_no} (${s.payment_status})`;
    const items = Array.isArray(s.items_json) ? s.items_json : [];
    const pays = Array.isArray(s.payments_json) ? s.payments_json : [];

    const itemRows = items.map((it) => `
      <tr>
        <td>
          <strong>${escapeHtml(it.product_name)}</strong><br/>
          <small class="text-muted">${escapeHtml(it.sku)} &bull; ${fmtNum(it.qty_input)} ${escapeHtml(it.unit_name)}</small>
        </td>
        <td class="num">${fmtRp(it.selling_price)}</td>
        <td class="num">${fmtRp(it.subtotal)}</td>
      </tr>`).join("");

    const payRows = pays.map((p) => `<li>${escapeHtml(p.payment_method)}: <strong>${fmtRp(p.amount)}</strong></li>`).join("");

    el("saleModalBody").innerHTML = `
      <div class="item-sub">
        Cabang: <strong>${escapeHtml(branchNameOf(s.branch_code))}</strong><br/>
        Tanggal: ${fmtDateTime(s.sale_date)}<br/>
        Kasir: ${escapeHtml(s.cashier_name)} | Pelanggan: ${escapeHtml(s.customer_name || "Umum")}
      </div>
      <table class="detail-table">
        <thead><tr><th>Item</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${itemRows || "<tr><td colspan='3'>Tidak ada rincian item.</td></tr>"}</tbody>
      </table>
      <div style="margin-top:12px;text-align:right;">
        <div>Subtotal: ${fmtRp(s.subtotal)}</div>
        <div>Diskon: -${fmtRp(s.discount_amount)}</div>
        <div style="font-size:16px;margin-top:4px;">Grand Total: <strong>${fmtRp(s.grand_total)}</strong></div>
        <div class="text-muted">Total HPP: ${fmtRp(s.total_cost_amount)}</div>
      </div>
      <div style="margin-top:10px;">
        <strong>Rincian Pembayaran:</strong>
        <ul style="margin:4px 0 0;padding-left:18px;">${payRows || "<li>-</li>"}</ul>
      </div>`;

    el("modalSaleDetail").classList.remove("hidden");
  }

  // ---------------- TAB 3: PRODUCTS & STOCK ----------------
  async function loadProducts() {
    const keyword = el("prodSearch").value.trim();
    const mode = el("prodFilterMode").value;
    const isAllBranches = selectedBranch === "ALL";
    el("productBranchNotice").classList.toggle("hidden", !isAllBranches);

    await Promise.all([refreshPendingQueueCount(), loadCategoriesSuggestion()]);

    const from = prodPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = sb.from("cloud_products").select("*").order("product_name", { ascending: true });
    query = applyBranchFilter(query);

    if (mode === "INACTIVE") query = query.eq("is_active", false);
    else query = query.eq("is_active", true);

    if (mode === "BUNDLE") query = query.eq("is_bundle", true);

    if (keyword) {
      const k = keyword.replace(/[%_,]/g, "");
      query = query.or(`sku.ilike.%${k}%,base_barcode.ilike.%${k}%,product_name.ilike.%${k}%`);
    }

    if (mode === "LOW") {
      // Ambil hingga 300 lalu filter stock <= min_stock_alert di klien agar akurat
      query = query.eq("is_bundle", false).limit(300);
    } else {
      query = query.range(from, to);
    }

    const { data, error } = await query;
    if (error) {
      showToast("Gagal memuat produk: " + error.message);
      return;
    }

    let rows = data || [];
    if (mode === "LOW") {
      rows = rows.filter((p) => Number(p.stock_qty) <= Number(p.min_stock_alert));
      const sliced = rows.slice(from, to + 1);
      el("btnProdPrev").disabled = prodPage === 0;
      el("btnProdNext").disabled = to + 1 >= rows.length;
      rows = sliced;
    } else {
      el("btnProdPrev").disabled = prodPage === 0;
      el("btnProdNext").disabled = rows.length < PAGE_SIZE;
    }

    currentProducts = rows;
    el("prodPageInfo").textContent = `Halaman ${prodPage + 1} (${rows.length} item)`;

    const listEl = el("productList");
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Produk tidak ditemukan.</div>`;
      return;
    }

    listEl.innerHTML = rows.map((p, idx) => {
      const low = !p.is_bundle && Number(p.stock_qty) <= Number(p.min_stock_alert);
      const stockPill = p.is_bundle
        ? `<span class="pill pill-blue">Paket: ${fmtNum(p.stock_qty)}</span>`
        : `<span class="pill ${low ? (Number(p.stock_qty) <= 0 ? "pill-red" : "pill-amber") : "pill-green"}">Stok: ${fmtNum(p.stock_qty)} ${escapeHtml(p.base_unit_name)}</span>`;

      return `
        <div class="item-card">
          <div class="item-top">
            <div>
              <div class="item-title">${escapeHtml(p.product_name)}</div>
              <div class="item-sub">
                ${escapeHtml(p.branch_code)} &bull; SKU: <strong>${escapeHtml(p.sku)}</strong>
                ${p.base_barcode ? " &bull; Barcode: " + escapeHtml(p.base_barcode) : ""}
              </div>
              <div class="item-sub">Kategori: ${escapeHtml(p.category_name || "-")} &bull; HPP: ${fmtRp(p.cost_price)}</div>
            </div>
            ${stockPill}
          </div>
          <div class="item-meta">
            <span>Harga Jual: <strong>${fmtRp(p.base_selling_price)} / ${escapeHtml(p.base_unit_name)}</strong></span>
            ${p.is_bundle ? "<span class='pill pill-blue'>Virtual Bundle</span>" : ""}
          </div>
          <div class="item-actions">
            <button type="button" class="btn btn-sm btn-outline" data-edit-prod="${idx}">Edit Produk / Harga</button>
            ${p.is_bundle
              ? `<button type="button" class="btn btn-sm btn-outline" disabled>Stok Otomatis Komponen</button>`
              : `<button type="button" class="btn btn-sm btn-primary" data-adj-stock="${idx}">Stok +/-</button>`}
          </div>
        </div>`;
    }).join("");

    listEl.querySelectorAll("[data-edit-prod]").forEach((b) => {
      b.addEventListener("click", () => openEditProductModal(currentProducts[Number(b.getAttribute("data-edit-prod"))]));
    });
    listEl.querySelectorAll("[data-adj-stock]").forEach((b) => {
      b.addEventListener("click", () => openStockAdjustModal(currentProducts[Number(b.getAttribute("data-adj-stock"))]));
    });
  }

  async function loadCategoriesSuggestion() {
    const q = applyBranchFilter(sb.from("cloud_categories").select("category_name").order("category_name", { ascending: true }));
    const { data } = await q;
    const unique = [];
    const seen = new Set();
    (data || []).forEach((c) => {
      const name = String(c.category_name || "").trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        unique.push(name);
      }
    });
    categoriesCache = unique;
    el("categorySuggestions").innerHTML = categoriesCache.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  function resolveEditableBranch(fallbackBranch) {
    if (fallbackBranch) return fallbackBranch;
    if (selectedBranch !== "ALL") return selectedBranch;
    if (branches.length === 1) return branches[0].branch_code;
    return null;
  }

  function openNewProductModal() {
    const targetBranch = resolveEditableBranch(null);
    if (!targetBranch) {
      showToast("Pilih cabang spesifik dulu sebelum menambah produk baru.");
      return;
    }

    el("prodModalTitle").textContent = `Tambah Produk Baru (${targetBranch})`;
    el("editProdLocalId").value = "0";
    el("editProdBranchCode").value = targetBranch;
    el("editSku").value = "";
    el("editSku").readOnly = false;
    el("editBarcode").value = "";
    el("editName").value = "";
    el("editCategory").value = categoriesCache[0] || "Umum";
    el("editUnit").value = "Pcs";
    el("editCostPrice").value = "0";
    el("editSellPrice").value = "0";
    el("editInitialStockGroup").classList.remove("hidden");
    el("editInitialStock").value = "0";
    el("editMinStock").value = "5";
    el("editIsActive").checked = true;
    el("modalProductEdit").classList.remove("hidden");
  }

  function openEditProductModal(p) {
    el("prodModalTitle").textContent = `Edit Produk (${p.branch_code})`;
    el("editProdLocalId").value = String(p.local_id);
    el("editProdBranchCode").value = p.branch_code;
    el("editSku").value = p.sku;
    el("editSku").readOnly = true;
    el("editBarcode").value = p.base_barcode || "";
    el("editName").value = p.product_name;
    el("editCategory").value = p.category_name || "Umum";
    el("editUnit").value = p.base_unit_name || "Pcs";
    el("editCostPrice").value = String(p.cost_price || 0);
    el("editSellPrice").value = String(p.base_selling_price || 0);
    el("editInitialStockGroup").classList.add("hidden");
    el("editMinStock").value = String(p.min_stock_alert || 0);
    el("editIsActive").checked = Boolean(p.is_active);
    el("modalProductEdit").classList.remove("hidden");
  }

  async function handleProductSubmit(e) {
    e.preventDefault();
    const localId = Number(el("editProdLocalId").value || 0);
    const branchCode = el("editProdBranchCode").value;
    const payload = {
      local_id: localId,
      sku: el("editSku").value.trim(),
      base_barcode: el("editBarcode").value.trim(),
      product_name: el("editName").value.trim(),
      category_name: el("editCategory").value.trim() || "Umum",
      base_unit_name: el("editUnit").value.trim() || "Pcs",
      cost_price: Number(el("editCostPrice").value || 0),
      base_selling_price: Number(el("editSellPrice").value || 0),
      stock_qty: Number(el("editInitialStock").value || 0),
      min_stock_alert: Number(el("editMinStock").value || 0),
      is_active: el("editIsActive").checked,
      actor_email: currentUser ? currentUser.email : "Owner"
    };

    const { error } = await sb.from("cloud_remote_commands").insert({
      branch_code: branchCode,
      command_type: "UPSERT_PRODUCT",
      payload: payload,
      created_by: currentUser ? currentUser.email : "Owner"
    });

    if (error) {
      showToast("Gagal mengirim perintah: " + error.message);
      return;
    }

    el("modalProductEdit").classList.add("hidden");
    showToast("Perintah simpan produk masuk antrean sync cabang!");
    await refreshPendingQueueCount();
  }

  function openStockAdjustModal(p) {
    el("stockModalTitle").textContent = `Ubah Stok (${p.branch_code})`;
    el("adjProdLocalId").value = String(p.local_id);
    el("adjProdBranchCode").value = p.branch_code;
    el("adjProdSku").value = p.sku;
    el("adjProdUnit").value = p.base_unit_name;
    el("adjProdNameDisplay").textContent = `${p.product_name} (${p.sku})`;
    el("adjCurrentStockDisplay").textContent = `Stok tercatat saat ini: ${fmtNum(p.stock_qty)} ${p.base_unit_name}`;
    el("adjType").value = "RESTOCK";
    el("adjQty").value = "";
    el("adjNotes").value = "";

    const kgAllowed = isKgUnit(p.base_unit_name);
    el("adjQty").step = kgAllowed ? "0.01" : "1";
    el("adjQtyHint").textContent = kgAllowed
      ? "Satuan Kg mendukung angka desimal (contoh: 5 atau 0.5). Untuk Waste isi angka positif (sistem otomatis mengurangi)."
      : "Satuan non-Kg wajib bilangan bulat. Untuk Restock/Waste isi angka positif; untuk Opname bisa pakai minus (-).";

    el("modalStockAdjust").classList.remove("hidden");
  }

  async function handleStockAdjustSubmit(e) {
    e.preventDefault();
    const branchCode = el("adjProdBranchCode").value;
    const unitName = el("adjProdUnit").value;
    const moveType = el("adjType").value;
    let rawQty = Number(el("adjQty").value || 0);

    if (!rawQty || isNaN(rawQty)) {
      showToast("Masukkan jumlah perubahan stok yang valid.");
      return;
    }

    if (!isKgUnit(unitName) && !Number.isInteger(rawQty)) {
      showToast(`Satuan '${unitName}' harus bilangan bulat.`);
      return;
    }

    let delta = rawQty;
    if (moveType === "RESTOCK") delta = Math.abs(rawQty);
    else if (moveType === "WASTE") delta = -Math.abs(rawQty);

    const payload = {
      product_local_id: Number(el("adjProdLocalId").value || 0),
      sku: el("adjProdSku").value,
      delta_qty: delta,
      movement_type: moveType,
      notes: el("adjNotes").value.trim(),
      actor_email: currentUser ? currentUser.email : "Owner"
    };

    const { error } = await sb.from("cloud_remote_commands").insert({
      branch_code: branchCode,
      command_type: "ADJUST_STOCK",
      payload: payload,
      created_by: currentUser ? currentUser.email : "Owner"
    });

    if (error) {
      showToast("Gagal mengirim mutasi stok: " + error.message);
      return;
    }

    el("modalStockAdjust").classList.add("hidden");
    showToast("Mutasi stok dikirim ke antrean sync cabang!");
    await refreshPendingQueueCount();
  }

  async function refreshPendingQueueCount() {
    const q = applyBranchFilter(
      sb.from("cloud_remote_commands").select("id", { count: "exact", head: true }).eq("status", "PENDING")
    );
    const { count } = await q;
    el("pendingQueueCount").textContent = String(count || 0);
  }

  async function openQueueModal() {
    const { data, error } = await applyBranchFilter(
      sb.from("cloud_remote_commands").select("*").order("id", { ascending: false }).limit(30)
    );
    if (error) {
      showToast("Gagal memuat antrean: " + error.message);
      return;
    }

    const rows = data || [];
    el("queueModalBody").innerHTML = rows.length === 0
      ? `<div class="empty-state">Belum ada perintah dari Web HP ke PC cabang.</div>`
      : `<div class="card-list">${rows.map((r) => {
          const badge = r.status === "APPLIED" ? "pill-green" : (r.status === "FAILED" ? "pill-red" : "pill-amber");
          return `
            <div class="item-card">
              <div class="item-top">
                <div>
                  <div class="item-title">${escapeHtml(r.command_type)} (${escapeHtml(r.branch_code)})</div>
                  <div class="item-sub">${fmtDateTime(r.created_at)}</div>
                </div>
                <span class="pill ${badge}">${escapeHtml(r.status)}</span>
              </div>
              <div class="item-sub" style="margin-top:6px;">${escapeHtml(r.result_message || "Menunggu PC cabang sinkronisasi...")}</div>
            </div>`;
        }).join("")}</div>`;

    el("modalQueue").classList.remove("hidden");
  }

  // ---------------- TAB 4: SHIFT & CASH FLOW ----------------
  async function loadShiftAndCash() {
    const fromIso = toStartIso(el("shiftFrom").value || todayStr());
    const toIso = toEndIso(el("shiftTo").value || todayStr());

    const [shiftRes, cfRes] = await Promise.all([
      applyBranchFilter(
        sb.from("cloud_shifts")
          .select("*")
          .gte("start_time", fromIso)
          .lte("start_time", toIso)
          .order("start_time", { ascending: false })
          .limit(200)
      ),
      applyBranchFilter(
        sb.from("cloud_cash_flows")
          .select("*")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: false })
          .limit(300)
      )
    ]);

    if (shiftRes.error) showToast("Error shift: " + shiftRes.error.message);
    if (cfRes.error) showToast("Error kas: " + cfRes.error.message);

    const shifts = shiftRes.data || [];
    el("shiftList").innerHTML = shifts.length === 0
      ? `<div class="empty-state">Tidak ada riwayat shift pada tanggal ini.</div>`
      : shifts.map((sh) => {
          const isOpen = sh.status === "OPEN";
          const variance = Number(sh.cash_variance || 0);
          const varClass = variance < 0 ? "text-red" : (variance > 0 ? "text-green" : "");
          return `
            <div class="item-card">
              <div class="item-top">
                <div>
                  <div class="item-title">Shift #${sh.local_id} &bull; ${escapeHtml(sh.cashier_name)}</div>
                  <div class="item-sub">${escapeHtml(branchNameOf(sh.branch_code))} &bull; Buka: ${fmtDateTime(sh.start_time)}</div>
                  ${sh.end_time ? `<div class="item-sub">Tutup: ${fmtDateTime(sh.end_time)}</div>` : ""}
                </div>
                <span class="pill ${isOpen ? "pill-blue" : "pill-slate"}">${escapeHtml(sh.status)}</span>
              </div>
              <div class="item-meta">
                <span>Modal: <strong>${fmtRp(sh.opening_cash)}</strong></span>
                <span>Kas Sistem: <strong>${fmtRp(sh.expected_closing_cash)}</strong></span>
                ${sh.actual_closing_cash !== null ? `<span>Fisik: <strong>${fmtRp(sh.actual_closing_cash)}</strong></span>` : ""}
                ${sh.cash_variance !== null ? `<span>Selisih: <strong class="${varClass}">${fmtRp(sh.cash_variance)}</strong></span>` : ""}
              </div>
            </div>`;
        }).join("");

    const flows = cfRes.data || [];
    let totalIn = 0, totalOut = 0;
    flows.forEach((f) => {
      if (f.flow_type === "CASH_IN") totalIn += Number(f.amount || 0);
      else totalOut += Number(f.amount || 0);
    });
    const net = totalIn - totalOut;
    el("cfSumIn").textContent = fmtRp(totalIn);
    el("cfSumOut").textContent = fmtRp(totalOut);
    el("cfSumNet").textContent = fmtRp(net);
    el("cfSumNet").className = net >= 0 ? "text-green" : "text-red";

    el("cashFlowList").innerHTML = flows.length === 0
      ? `<div class="empty-state">Tidak ada riwayat kas masuk/keluar pada tanggal ini.</div>`
      : flows.map((f) => {
          const isIn = f.flow_type === "CASH_IN";
          return `
            <div class="item-card ${isIn ? "cash-in" : "cash-out"}">
              <div class="item-top">
                <div>
                  <div class="item-title">${isIn ? "Kas Masuk" : "Kas Keluar"} &bull; ${escapeHtml(f.category)}</div>
                  <div class="item-sub">${escapeHtml(branchNameOf(f.branch_code))} &bull; Shift #${f.shift_local_id} &bull; ${escapeHtml(f.user_name)}</div>
                </div>
                <strong class="${isIn ? "text-green" : "text-red"}">${isIn ? "+" : "-"}${fmtRp(f.amount)}</strong>
              </div>
              <div class="item-sub" style="margin-top:6px;">${fmtDateTime(f.created_at)} &bull; ${escapeHtml(f.description || "-")}</div>
            </div>`;
        }).join("");
  }

  // ---------------- TAB 5: AUDIT LOG ----------------
  async function loadAuditLogs() {
    const fromIso = toStartIso(el("auditFrom").value || todayStr());
    const toIso = toEndIso(el("auditTo").value || todayStr());
    const filter = el("auditFilter").value;

    let query = applyBranchFilter(
      sb.from("cloud_audit_logs")
        .select("*")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(300)
    );

    if (filter === "SENSITIVE") {
      query = query.in("action_type", ["VOID_SALE", "RETURN_SALE", "REMOVE_CART_ITEM", "REMOVE_CART_ITEM_DIRECT", "MANUAL_DISCOUNT", "PRICE_CHANGE", "DELETE_PRODUCT", "RECORD_WASTE", "CASH_OUT"]);
    } else if (filter === "SHIFT_CASH") {
      query = query.in("action_type", ["OPEN_SHIFT", "CLOSE_SHIFT", "CASH_IN", "CASH_OUT"]);
    } else if (filter === "PRODUCT") {
      query = query.in("action_type", ["CREATE_PRODUCT", "UPDATE_PRODUCT", "PRICE_CHANGE", "DELETE_PRODUCT", "DEACTIVATE_PRODUCT"]);
    } else if (filter === "STOCK") {
      query = query.in("action_type", ["RECEIVE_PURCHASE", "RETURN_PURCHASE", "RECORD_WASTE", "APPROVE_OPNAME"]);
    }

    const { data, error } = await query;
    if (error) {
      showToast("Gagal memuat audit log: " + error.message);
      return;
    }

    const logs = data || [];
    el("auditList").innerHTML = logs.length === 0
      ? `<div class="empty-state">Tidak ada catatan audit pada periode ini.</div>`
      : logs.map((al) => {
          const risky = isHighRiskAudit(al.action_type);
          return `
            <div class="item-card ${risky ? "risk-high" : ""}">
              <div class="item-top">
                <div>
                  <div class="item-title">${escapeHtml(translateAuditAction(al.action_type))}</div>
                  <div class="item-sub">${escapeHtml(branchNameOf(al.branch_code))} &bull; ${escapeHtml(al.user_name)} (${escapeHtml(al.role_name || "-")})</div>
                </div>
                <span class="pill ${risky ? "pill-red" : "pill-slate"}">${fmtDateTime(al.created_at)}</span>
              </div>
              <div class="item-sub" style="margin-top:6px;">
                ${al.old_value ? `<div><strong>Lama:</strong> ${escapeHtml(al.old_value)}</div>` : ""}
                ${al.new_value ? `<div><strong>Baru:</strong> ${escapeHtml(al.new_value)}</div>` : ""}
              </div>
            </div>`;
        }).join("");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
