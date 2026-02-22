if (!localStorage.getItem("token")) window.location.href = "login.html";

const API = "http://localhost:3000";
const TK  = localStorage.getItem("token");
const H   = { "Authorization": "Bearer " + TK };
const HJ  = { ...H, "Content-Type": "application/json" };

// ── HELPERS ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const rp = n  => "Rp " + Number(n||0).toLocaleString("id-ID");

function toast(msg, type = "info") {
    const t = $("toast");
    const c = { success:"#4ade80", error:"#f87171", info:"#38bdf8" };
    t.style.color = c[type] || c.info;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
}

function badge(status) {
    const map = { pending:"b-pend", success:"b-ok", failed:"b-no" };
    return `<span class="badge ${map[status]||'b-pend'}">${status}</span>`;
}

function empty(ico, txt) {
    return `<div class="empty"><div class="ico">${ico}</div><p>${txt}</p></div>`;
}

// ── IMAGE PREVIEW ─────────────────────────────────────────
window.previewImg = function(input) {
    const box = $("imgBox");
    const existing = box.querySelector("img");
    if (existing) existing.remove();
    if (input.files && input.files[0]) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(input.files[0]);
        box.appendChild(img);
    }
};

// ── NAVIGATION ────────────────────────────────────────────
const sections = ["dashboard","produk","promo","transaksi"];
const titles   = { dashboard:"Dashboard", produk:"Produk", promo:"Promo", transaksi:"Transaksi" };
const loaders  = { dashboard: loadStats, produk: loadProducts, promo: loadPromos, transaksi: loadTransactions };

window.go = function(name, el) {
    sections.forEach(s => $(`sec-${s}`).style.display = "none");
    $(`sec-${name}`).style.display = "block";
    document.querySelectorAll(".sidebar nav a").forEach(a => a.classList.remove("active"));
    el.classList.add("active");
    $("pageTitle").textContent = titles[name];
    loaders[name]();
};

// ── STATS / DASHBOARD ─────────────────────────────────────
async function loadStats() {
    try {
        const [pr, tr] = await Promise.all([
            fetch(`${API}/products`),
            fetch(`${API}/transactions`, { headers: H })
        ]);
        const products = await pr.json();
        const trx      = await tr.json();

        const omzet   = trx.filter(t => t.status === "success").reduce((s, t) => s + Number(t.total_price||0), 0);
        const pending  = trx.filter(t => t.status === "pending").length;

        $("s-produk").textContent  = products.length;
        $("s-trx").textContent     = trx.length;
        $("s-omzet").textContent   = rp(omzet);
        $("s-pending").textContent = pending;

        const recent = trx.slice(0, 10);
        const el = $("recent-trx");

        if (!recent.length) { el.innerHTML = empty("💳","Belum ada transaksi dari website"); return; }

        el.innerHTML = `<table class="tbl">
            <thead><tr>
                <th>Kode</th><th>Game</th><th>User ID</th><th>Total</th>
                <th>Bayar</th><th>Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>${recent.map(t => `<tr>
                <td style="font-size:11px;color:#475569;font-family:monospace">${t.trx_code||"#"+t.id}</td>
                <td>${t.game_name||"-"}</td>
                <td>${t.user_id||"-"}</td>
                <td style="font-weight:600">${rp(t.total_price)}</td>
                <td style="font-size:12px">${t.payment_method||"-"}</td>
                <td>${badge(t.status)}</td>
                <td>
                    <button class="sb sb-ok"  onclick="setStatus(${t.id},'success')">✓</button>
                    <button class="sb sb-no"  onclick="setStatus(${t.id},'failed')">✗</button>
                    <button class="sb sb-pnd" onclick="setStatus(${t.id},'pending')">⏳</button>
                </td>
            </tr>`).join("")}</tbody>
        </table>`;

        $("lastUpdate").textContent = new Date().toLocaleTimeString("id-ID");
    } catch(e) { console.error(e); }
}

// ── PRODUK ────────────────────────────────────────────────
async function loadProducts() {
    try {
        const products = await fetch(`${API}/products`).then(r => r.json());
        const el = $("product-list");
        $("s-produk").textContent = products.length;

        if (!products.length) { el.innerHTML = empty("📦","Belum ada produk. Tambah agar tampil di website!"); return; }

        el.innerHTML = `<table class="tbl">
            <thead><tr><th></th><th>Game</th><th>Item</th><th>Jumlah</th><th>Harga</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>${products.map(p => `<tr>
                <td>${p.image
                    ? `<img class="prod-img" src="${API}/uploads/${p.image}" alt="">`
                    : `<div class="prod-emoji">🎮</div>`
                }</td>
                <td style="font-weight:600">${p.game_name}</td>
                <td>${p.item_name}</td>
                <td style="color:#64748b">${p.amount} ${p.currency||"Item"}</td>
                <td style="color:#38bdf8;font-weight:600">${rp(p.price)}</td>
                <td><span class="badge ${p.is_active ? 'b-ok' : 'b-no'}">${p.is_active ? "Aktif" : "Nonaktif"}</span></td>
                <td>
                    <button class="sb sb-ok" onclick="editProduct(${p.id},'${p.game_name}','${p.item_name}',${p.amount},${p.price},'${p.currency||''}')">Edit</button>
                    <button class="sb sb-del" onclick="delProduct(${p.id})">Hapus</button>
                </td>
            </tr>`).join("")}</tbody>
        </table>`;
    } catch(e) { console.error(e); }
}

window.addProduct = async function() {
    const game_name = $("p-game").value.trim();
    const item_name = $("p-item").value.trim();
    const amount    = parseInt($("p-amount").value);
    const price     = parseInt($("p-price").value);
    const currency  = $("p-currency").value.trim() || "Diamonds";
    const imgFile   = $("p-image").files[0];

    if (!game_name || !item_name || !amount || !price)
        return toast("⚠️ Lengkapi semua field!", "error");

    // Upload gambar dulu kalau ada
    let imageName = null;
    if (imgFile) {
        const fd = new FormData();
        fd.append("image", imgFile);
        const up = await fetch(`${API}/upload`, { method: "POST", headers: H, body: fd });
        if (up.ok) { const d = await up.json(); imageName = d.filename; }
    }

    const res = await fetch(`${API}/products`, {
        method: "POST", headers: HJ,
        body: JSON.stringify({ game_name, item_name, amount, price, currency, image: imageName })
    });

    if (res.ok) {
        ["p-game","p-item","p-amount","p-price","p-currency"].forEach(id => $(id).value = "");
        $("p-image").value = "";
        const box = $("imgBox");
        const img = box.querySelector("img");
        if (img) img.remove();
        toast("✅ Produk ditambah! Tampil di website.", "success");
        loadProducts();
    } else {
        toast("❌ Gagal tambah produk", "error");
    }
};

window.editProduct = async function(id, g, i, a, p, c) {
    const game_name = prompt("Nama Game:", g);
    const item_name = prompt("Nama Item:", i);
    const amount    = prompt("Jumlah:", a);
    const price     = prompt("Harga:", p);
    const currency  = prompt("Satuan:", c);
    if (!game_name || !item_name) return;
    await fetch(`${API}/products/${id}`, {
        method: "PUT", headers: HJ,
        body: JSON.stringify({ game_name, item_name, amount: parseInt(amount), price: parseInt(price), currency, is_active: 1 })
    });
    toast("✏️ Produk diupdate!", "success");
    loadProducts();
};

window.delProduct = async function(id) {
    if (!confirm("Hapus produk ini?")) return;
    await fetch(`${API}/products/${id}`, { method: "DELETE", headers: H });
    toast("🗑️ Produk dihapus", "info");
    loadProducts();
};

// ── PROMO ─────────────────────────────────────────────────
async function loadPromos() {
    try {
        const promos = await fetch(`${API}/promos`, { headers: H }).then(r => r.json());
        const el = $("promo-list");
        if (!promos.length) { el.innerHTML = empty("🏷️","Belum ada promo aktif"); return; }

        el.innerHTML = `<table class="tbl">
            <thead><tr><th>Kode</th><th>Diskon</th><th>Min. Beli</th><th>Expire</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>${promos.map(p => `<tr>
                <td style="font-weight:700;color:#38bdf8;letter-spacing:1px">${p.code}</td>
                <td style="font-weight:600">${p.discount}%</td>
                <td>${rp(p.min_purchase)}</td>
                <td style="font-size:12px;color:#64748b">${p.expired_at ? new Date(p.expired_at).toLocaleDateString("id-ID") : "—"}</td>
                <td><span class="badge ${p.is_active ? 'b-ok' : 'b-no'}">${p.is_active ? "Aktif" : "Nonaktif"}</span></td>
                <td><button class="sb sb-del" onclick="delPromo(${p.id})">Hapus</button></td>
            </tr>`).join("")}</tbody>
        </table>`;
    } catch(e) { console.error(e); }
}

window.addPromo = async function() {
    const code         = $("pr-code").value.trim().toUpperCase();
    const discount     = parseInt($("pr-discount").value);
    const min_purchase = parseInt($("pr-min").value) || 0;
    const expired_at   = $("pr-expire").value || null;
    if (!code || !discount) return toast("⚠️ Kode dan diskon wajib diisi!", "error");

    const res = await fetch(`${API}/promos`, {
        method: "POST", headers: HJ,
        body: JSON.stringify({ code, discount, min_purchase, expired_at })
    });
    if (res.ok) {
        ["pr-code","pr-discount","pr-min","pr-expire"].forEach(id => $(id).value = "");
        toast(`✅ Promo ${code} aktif di website!`, "success");
        loadPromos();
    } else {
        toast("❌ Gagal tambah promo (kode mungkin duplikat)", "error");
    }
};

window.delPromo = async function(id) {
    if (!confirm("Hapus promo ini?")) return;
    await fetch(`${API}/promos/${id}`, { method: "DELETE", headers: H });
    toast("🗑️ Promo dihapus", "info");
    loadPromos();
};

// ── TRANSAKSI ─────────────────────────────────────────────
async function loadTransactions() {
    try {
        const trx = await fetch(`${API}/transactions`, { headers: H }).then(r => r.json());
        const el  = $("trx-list");
        if (!trx.length) { el.innerHTML = empty("💳","Belum ada transaksi"); return; }

        // Update stats
        const omzet = trx.filter(t => t.status === "success").reduce((s,t) => s + Number(t.total_price||0), 0);
        $("s-trx").textContent     = trx.length;
        $("s-omzet").textContent   = rp(omzet);
        $("s-pending").textContent = trx.filter(t => t.status === "pending").length;

        el.innerHTML = `<table class="tbl">
            <thead><tr>
                <th>Kode</th><th>Game</th><th>User ID</th><th>Item</th>
                <th>Total</th><th>Bayar</th><th>Email</th><th>Status</th><th>Ubah</th>
            </tr></thead>
            <tbody>${trx.map(t => `<tr>
                <td style="font-size:11px;color:#475569;font-family:monospace">${t.trx_code||"#"+t.id}</td>
                <td>${t.game_name||"-"}</td>
                <td>${t.user_id||"-"}</td>
                <td style="font-size:12px">${t.item_name||"-"}</td>
                <td style="font-weight:600;color:#38bdf8">${rp(t.total_price)}</td>
                <td style="font-size:12px">${t.payment_method||"-"}</td>
                <td style="font-size:11px;color:#475569">${t.email||"-"}</td>
                <td>${badge(t.status)}</td>
                <td>
                    <button class="sb sb-ok"  onclick="setStatus(${t.id},'success')">✓</button>
                    <button class="sb sb-no"  onclick="setStatus(${t.id},'failed')">✗</button>
                    <button class="sb sb-pnd" onclick="setStatus(${t.id},'pending')">⏳</button>
                </td>
            </tr>`).join("")}</tbody>
        </table>`;
    } catch(e) { console.error(e); }
}

window.setStatus = async function(id, status) {
    await fetch(`${API}/transactions/${id}`, {
        method: "PUT", headers: HJ,
        body: JSON.stringify({ status })
    });
    const lbl = { success:"✅ Sukses", failed:"❌ Gagal", pending:"⏳ Pending" };
    toast(`${lbl[status]||status}`, status === "success" ? "success" : status === "failed" ? "error" : "info");
    const isOnTrx = $("sec-transaksi").style.display !== "none";
    isOnTrx ? loadTransactions() : loadStats();
};

// ── LOGOUT ────────────────────────────────────────────────
window.doLogout = function() {
    localStorage.removeItem("token");
    window.location.href = "login.html";
};

// ── AUTO REFRESH ──────────────────────────────────────────
setInterval(() => {
    if ($("sec-transaksi").style.display !== "none") loadTransactions();
    else if ($("sec-dashboard").style.display !== "none") loadStats();
}, 10000);

// ── INIT ──────────────────────────────────────────────────
loadStats();