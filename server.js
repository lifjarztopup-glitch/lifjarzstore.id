const express = require("express");
const mysql   = require("mysql2");
const cors    = require("cors");
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcrypt");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { createClient } = require("@supabase/supabase-js");

const SECRET_KEY = "lifjarz_super_secret_key";

// ✅ Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = "uploads";
// Lazy init: jangan crash kalau env belum di-set
let supabase = null;
function getSupabase() {
    if (!supabase) supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabase;
}

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Static files
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin",   express.static(path.join(__dirname, "admin")));
app.use("/css",     express.static(path.join(__dirname, "css")));
app.use("/js",      express.static(path.join(__dirname, "js")));

// ✅ Multer config (pakai memory storage, file tidak disimpan ke disk)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT
});

db.connect((err) => {
    if (err) {
        console.error("MySQL Error:", err);
        return;
    }
    console.log("MySQL Connected...");
    // Auto-migrate: tambah kolom image di banners kalau belum ada
    db.query("SHOW COLUMNS FROM banners LIKE 'image'", (err, results) => {
        if (!err && results.length === 0) {
            db.query("ALTER TABLE banners ADD COLUMN image VARCHAR(500) NULL", (err2) => {
                if (err2) console.log("Gagal tambah kolom image:", err2.message);
                else console.log("Kolom image di banners berhasil ditambahkan.");
            });
        } else {
            console.log("Kolom image sudah ada.");
        }
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ================= VERIFY TOKEN =================
function verifyToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    if (!authHeader) {
        return res.status(401).json({ message: "Token tidak ada" });
    }
    const token = authHeader.split(" ")[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Token tidak valid" });
        }
        req.user = user;
        next();
    });
}


// ✅ Upload foto/video ke Supabase Storage
app.post("/upload", verifyToken, upload.single("image"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const ext = path.extname(req.file.originalname);
    const filename = "product-" + Date.now() + ext;

    const sb = getSupabase();
    const { error } = await sb.storage
        .from(SUPABASE_BUCKET)
        .upload(filename, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: false
        });

    if (error) {
        console.error("Supabase upload error:", error);
        return res.status(500).json({ message: "Gagal upload ke storage" });
    }

    const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(filename);
    // Return full public URL agar bisa disimpan langsung ke DB
    res.json({ filename: data.publicUrl, url: data.publicUrl });
});


// ================= LOGIN ADMIN =================
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    const adminUser = "admin";
    const adminHashedPassword =
        "$2b$10$GNcxbZhbDOMj2peyGDSJs.MpackycnB0dj8D6OkYo7n7mCW5MlEE6";

    if (username !== adminUser) {
        return res.status(401).json({ message: "User tidak ditemukan" });
    }

    const isMatch = await bcrypt.compare(password, adminHashedPassword);
    if (!isMatch) {
        return res.status(401).json({ message: "Password salah" });
    }

    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "2h" });
    res.json({ token });
});


// =========================================================
// ======================= PRODUK ==========================
// =========================================================

// PUBLIC - Ambil semua produk (untuk website publik)
app.get("/products", (req, res) => {
    const { game } = req.query;
    let sql = "SELECT * FROM products WHERE is_active = 1 ORDER BY game_name, price ASC";
    let params = [];

    if (game) {
        sql = "SELECT * FROM products WHERE is_active = 1 AND game_name = ? ORDER BY price ASC";
        params = [game];
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json(results);
    });
});

// PUBLIC - Ambil daftar game unik (untuk ditampilkan di website)
app.get("/games", (req, res) => {
    db.query(
        "SELECT DISTINCT game_name FROM products WHERE is_active = 1 ORDER BY game_name",
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json(results);
        }
    );
});

// ADMIN - Tambah produk
app.post("/products", verifyToken, (req, res) => {
    const { game_name, item_name, amount, price, currency, image } = req.body;

    if (!game_name || !item_name || amount === undefined || amount === null || price === undefined || price === null) {
        return res.status(400).json({ message: "Data tidak lengkap" });
    }

    const sql = "INSERT INTO products (game_name, item_name, amount, price, currency, image) VALUES (?, ?, ?, ?, ?, ?)";
    db.query(sql, [game_name, item_name, amount, price, currency || "Diamonds", image || null], (err, result) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Produk berhasil ditambahkan", id: result.insertId });
    });
});

// ADMIN - Hapus produk
app.delete("/products/:id", verifyToken, (req, res) => {
    db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Produk berhasil dihapus" });
    });
});

// ADMIN - Update produk
app.put("/products/:id", verifyToken, (req, res) => {
    const { game_name, item_name, amount, price, currency, image, is_active } = req.body;

    db.query(
        "UPDATE products SET game_name=?, item_name=?, amount=?, price=?, currency=?, image=?, is_active=? WHERE id=?",
        [game_name, item_name, amount, price, currency, image, is_active, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Produk berhasil diupdate" });
        }
    );
});


// =========================================================
// ========================= PROMO =========================
// =========================================================

// PUBLIC - Cek promo code
app.post("/promos/check", (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ message: "Kode promo wajib diisi" });
    }

    db.query(
        "SELECT * FROM promos WHERE code = ? AND is_active = 1 AND (expired_at IS NULL OR expired_at >= CURDATE())",
        [code],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (results.length === 0) {
                return res.status(404).json({ message: "Kode promo tidak valid atau sudah expired" });
            }
            res.json({ valid: true, promo: results[0] });
        }
    );
});

// ADMIN - Ambil semua promo
app.get("/promos", verifyToken, (req, res) => {
    db.query("SELECT * FROM promos ORDER BY id DESC", (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json(results);
    });
});

// ADMIN - Tambah promo
app.post("/promos", verifyToken, (req, res) => {
    const { code, discount, min_purchase, expired_at } = req.body;

    db.query(
        "INSERT INTO promos (code, discount, min_purchase, expired_at) VALUES (?, ?, ?, ?)",
        [code, discount, min_purchase || 0, expired_at || null],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Promo berhasil ditambahkan" });
        }
    );
});

// ADMIN - Hapus promo
app.delete("/promos/:id", verifyToken, (req, res) => {
    db.query("DELETE FROM promos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Promo berhasil dihapus" });
    });
});


// =========================================================
// ====================== TRANSAKSI ========================
// =========================================================

// PUBLIC - Buat transaksi baru
app.post("/transactions", (req, res) => {
    const { game_name, user_id, zone_id, product_id, payment_method, email, promo_code } = req.body;

    if (!game_name || !user_id || !product_id || !payment_method) {
        return res.status(400).json({ message: "Data tidak lengkap" });
    }

    // Ambil produk
    db.query("SELECT * FROM products WHERE id = ? AND is_active = 1", [product_id], (err, productResult) => {
        if (err || productResult.length === 0) {
            return res.status(400).json({ message: "Produk tidak ditemukan" });
        }

        const product = productResult[0];
        let totalPrice = product.price;

        // Generate kode transaksi unik
        const trxCode = "NTU-" + Date.now();

        function saveTransaction(finalPrice) {
            db.query(
                `INSERT INTO transactions 
                (trx_code, game_name, user_id, zone_id, product_id, payment_method, email, total_price, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [trxCode, game_name, user_id, zone_id || null, product_id, payment_method, email || null, finalPrice],
                (err, result) => {
                    if (err) return res.status(500).json({ message: "Database error" });
                    res.json({
                        message: "Transaksi berhasil dibuat",
                        trx_code: trxCode,
                        total_price: finalPrice
                    });
                }
            );
        }

        // Cek promo jika ada
        if (promo_code) {
            db.query(
                "SELECT * FROM promos WHERE code = ? AND is_active = 1 AND (expired_at IS NULL OR expired_at >= CURDATE())",
                [promo_code],
                (err, promoResult) => {
                    if (!err && promoResult.length > 0) {
                        const promo = promoResult[0];
                        if (totalPrice >= promo.min_purchase) {
                            totalPrice -= (totalPrice * promo.discount) / 100;
                            if (totalPrice < 0) totalPrice = 0;
                        }
                    }
                    saveTransaction(Math.round(totalPrice));
                }
            );
        } else {
            saveTransaction(totalPrice);
        }
    });
});

// PUBLIC - Cek status transaksi
app.get("/transactions/check/:trx_code", (req, res) => {
    db.query(
        `SELECT t.*, p.item_name, p.amount, p.currency 
        FROM transactions t 
        LEFT JOIN products p ON t.product_id = p.id 
        WHERE t.trx_code = ?`,
        [req.params.trx_code],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (results.length === 0) {
                return res.status(404).json({ message: "Transaksi tidak ditemukan" });
            }
            res.json(results[0]);
        }
    );
});

// ADMIN - Ambil semua transaksi
app.get("/transactions", verifyToken, (req, res) => {
    db.query(
        `SELECT t.*, p.item_name, p.game_name as product_game 
        FROM transactions t 
        LEFT JOIN products p ON t.product_id = p.id 
        ORDER BY t.id DESC`,
        (err, results) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json(results);
        }
    );
});

// ADMIN - Update status transaksi
app.put("/transactions/:id", verifyToken, (req, res) => {
    const { status } = req.body;

    db.query(
        "UPDATE transactions SET status = ? WHERE id = ?",
        [status, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Status berhasil diupdate" });
        }
    );
});


// =========================================================
// ========================= BANNER ========================
// =========================================================

// PUBLIC - Ambil banner aktif
app.get("/banners", (req, res) => {
    const isAdmin = req.headers["authorization"];
    let sql = isAdmin
        ? "SELECT * FROM banners ORDER BY id ASC"
        : "SELECT * FROM banners WHERE is_active = 1 ORDER BY id ASC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json(results);
    });
});

// ADMIN - Tambah banner
app.post("/banners", verifyToken, (req, res) => {
    const { title, subtitle, description, color, emoji, btn_text, image } = req.body;
    if (!title) return res.status(400).json({ message: "Judul wajib diisi" });
    db.query(
        "INSERT INTO banners (title, subtitle, description, color, emoji, btn_text, image) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [title, subtitle || null, description || null, color || "linear-gradient(135deg,#1565c0,#6a1b9a)", emoji || "🎮", btn_text || "Top-Up Sekarang", image || null],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Banner ditambahkan", id: result.insertId });
        }
    );
});

// ADMIN - Edit banner
app.put("/banners/:id", verifyToken, (req, res) => {
    const { title, subtitle, description, color, emoji, btn_text, image } = req.body;
    db.query(
        "UPDATE banners SET title=?, subtitle=?, description=?, color=?, emoji=?, btn_text=?, image=? WHERE id=?",
        [title, subtitle || null, description || null, color, emoji || "🎮", btn_text || "Top-Up Sekarang", image || null, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ message: "Database error" });
            res.json({ message: "Banner diupdate" });
        }
    );
});

// ADMIN - Toggle aktif/nonaktif banner
app.put("/banners/:id/toggle", verifyToken, (req, res) => {
    db.query("UPDATE banners SET is_active = NOT is_active WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Status banner diupdate" });
    });
});

// ADMIN - Hapus banner
app.delete("/banners/:id", verifyToken, (req, res) => {
    db.query("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Banner dihapus" });
    });
});


// =========================================================
// ====================== FLASH SALE =======================
// =========================================================

// PUBLIC - Ambil flash sale aktif
app.get("/flashsales", (req, res) => {
    const isAdmin = req.headers["authorization"];
    let sql = isAdmin
        ? `SELECT f.*, p.game_name, p.item_name, p.amount, p.currency, p.price, p.image
           FROM flashsales f
           JOIN products p ON f.product_id = p.id
           ORDER BY f.id DESC`
        : `SELECT f.*, p.game_name, p.item_name, p.amount, p.currency, p.price, p.image
           FROM flashsales f
           JOIN products p ON f.product_id = p.id
           WHERE f.is_active = 1 AND p.is_active = 1
           ORDER BY f.id DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json(results);
    });
});

// ADMIN - Tambah flash sale
app.post("/flashsales", verifyToken, (req, res) => {
    const { product_id, discount } = req.body;
    if (!product_id || !discount) return res.status(400).json({ message: "Product dan diskon wajib diisi" });
    if (discount < 1 || discount > 99) return res.status(400).json({ message: "Diskon harus antara 1-99%" });

    // Cek apakah produk sudah ada di flash sale
    db.query("SELECT id FROM flashsales WHERE product_id = ?", [product_id], (err, existing) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (existing.length > 0) return res.status(400).json({ message: "Produk ini sudah ada di Flash Sale" });

        db.query(
            "INSERT INTO flashsales (product_id, discount) VALUES (?, ?)",
            [product_id, discount],
            (err, result) => {
                if (err) return res.status(500).json({ message: "Database error" });
                res.json({ message: "Flash Sale ditambahkan", id: result.insertId });
            }
        );
    });
});

// ADMIN - Toggle aktif/nonaktif flash sale
app.put("/flashsales/:id/toggle", verifyToken, (req, res) => {
    db.query("UPDATE flashsales SET is_active = NOT is_active WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Status flash sale diupdate" });
    });
});

// ADMIN - Hapus flash sale
app.delete("/flashsales/:id", verifyToken, (req, res) => {
    db.query("DELETE FROM flashsales WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Database error" });
        res.json({ message: "Flash Sale dihapus" });
    });
});


app.listen(process.env.PORT || 3000, () => {
    console.log("\n🚀 Server running on port " + (process.env.PORT || 3000));
    console.log("📋 Admin: /admin/login.html");
});