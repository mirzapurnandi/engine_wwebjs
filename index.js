// index.js (REFACTORED & FIXED)

require("dotenv").config();
const express = require("express");
// const mongoose = require("mongoose");s
const EventEmitter = require("events");

// --- Konfigurasi Awal ---
const app = express();
const PORT = process.env.PORT || 3000;
EventEmitter.defaultMaxListeners = 50;

// --- Impor Modul Aplikasi ---
const db = require("./config/configSqlite.db");
// const connectMongoose = require("./config/configMongoose.db");
const {
    client,
    initialize,
    scheduleInitialize,
    healthCheck,
} = require("./WhatsAppWebInit");
const routes = require("./routes/index.route");

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Routes ---
app.use(routes);

let server;

// index.js

const startApp = async () => {
    try {
        // 1. Inisialisasi Database (Tetap di awal agar tabel siap)
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const CREATE_TABLE_SESSION = `CREATE TABLE IF NOT EXISTS sessions (id_instance TEXT PRIMARY KEY)`;
                db.run(CREATE_TABLE_SESSION, (err) =>
                    err ? reject(err) : resolve(),
                );
            });
        });
        console.log("✅ Database Table 'sessions' is ready.");

        // 2. JALANKAN EXPRESS SERVER TERLEBIH DAHULU
        // Ini memastikan API bisa diakses meskipun WA masih loading
        const serverHost = process.env.SERVER || "http://localhost";
        server = app.listen(PORT, () => {
            console.log(`🚀 Server is running on ${serverHost}:${PORT} ✅`);
            console.log(
                `[SYSTEM] API is now accessible while instances are booting...`,
            );
        });

        // 3. Ambil semua session dari DB
        const rows = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM sessions", (err, rows) =>
                err ? reject(err) : resolve(rows),
            );
        });

        // 4. PROSES INITIALIZE DI BACKGROUND (NON-BLOCKING)
        // Kita tidak menggunakan 'await' pada loop utama agar tidak mengunci proses
        if (rows.length > 0) {
            console.log(
                `[STARTUP] Found ${rows.length} sessions. Booting in background...`,
            );

            // Gunakan fungsi async IIFE agar loop berjalan secara independen
            (async () => {
                for (const row of rows) {
                    const uuid = row.id_instance;
                    console.log(
                        `[ASYNC-BOOT] Triggering initialize for: ${uuid}`,
                    );

                    try {
                        // Kita tetap beri jeda antar akun agar CPU tidak meledak,
                        // tapi ini tidak menghalangi Express yang sudah nyala di atas.
                        await initialize(uuid, true);
                        await new Promise((res) => setTimeout(res, 5000));
                    } catch (err) {
                        console.error(
                            `[ASYNC-BOOT] Error on ${uuid}: ${err.message}`,
                        );
                    }
                }
                console.log("[ASYNC-BOOT] All instances have been triggered.");
            })();
        }

        // 5. Health Check Interval
        setInterval(() => {
            const activeClients = Object.keys(client);
            if (activeClients.length > 0) {
                activeClients.forEach((id) => healthCheck(id));
            }
        }, 120 * 1000);
    } catch (error) {
        console.error("❌ Failed to start the application:", error);
        process.exit(1);
    }
};

const gracefulShutdown = async (signal) => {
    // ... (kode gracefulShutdown tetap sama)
    console.log(`\n[!] Received ${signal}, starting graceful shutdown...`);
    if (server) {
        server.close(() => console.log("[+] HTTP server closed."));
    }
    const clientIds = Object.keys(client);
    if (clientIds.length > 0) {
        console.log(`[+] Destroying ${clientIds.length} WhatsApp client(s)...`);
        await Promise.all(
            clientIds.map(async (id) => {
                try {
                    if (client[id]) {
                        await client[id].destroy();
                        console.log(`  - Client destroyed: ${id}`);
                    }
                } catch (e) {
                    console.error(
                        `  - Failed to destroy client ${id}:`,
                        e.message,
                    );
                }
            }),
        );
    }
    try {
        // await mongoose.disconnect();
        console.log("[+] Mongoose connection closed.");
    } catch (error) {
        console.error("[!] Error closing Mongoose connection:", error.message);
    }
    db.close((err) => {
        if (err) {
            console.error("[!] Error closing SQLite DB:", err.message);
        } else {
            console.log("[+] SQLite DB connection closed.");
        }
        console.log("[!] Shutdown complete. Exiting process.");
        process.exit(0);
    });
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("exit", (code) =>
    console.log(`[!] Process exiting with code: ${code}`),
);

startApp();
