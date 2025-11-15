// index.js (REFACTORED & FIXED)

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const EventEmitter = require("events");

// --- Konfigurasi Awal ---
const app = express();
const PORT = process.env.PORT || 3000;
EventEmitter.defaultMaxListeners = 50;

// --- Impor Modul Aplikasi ---
const db = require("./config/configSqlite.db");
const connectMongoose = require("./config/configMongoose.db");
const {
    client,
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

const startApp = async () => {
    try {
        await connectMongoose();

        // =================================================================
        // PERBAIKAN UTAMA: Gunakan db.serialize untuk mencegah race condition
        // =================================================================
        db.serialize(() => {
            const CREATE_TABLE_SESSION = `CREATE TABLE IF NOT EXISTS sessions (id_instance TEXT PRIMARY KEY)`;
            db.run(CREATE_TABLE_SESSION, (error) => {
                if (error) {
                    console.error(
                        "Fatal: Error creating sessions table:",
                        error
                    );
                    process.exit(1);
                }
                console.log("Table 'sessions' is ready.");

                // Jalankan SELECT HANYA SETELAH CREATE selesai
                const SELECT_ALL_SESSION = "SELECT * FROM sessions";
                db.all(SELECT_ALL_SESSION, (error, rows) => {
                    if (error) {
                        console.error("Error loading sessions from DB:", error);
                        return;
                    }
                    if (rows.length > 0) {
                        console.log(
                            `[+] Found ${rows.length} sessions to initialize...`
                        );
                        for (const row of rows) {
                            scheduleInitialize(row.id_instance);
                        }
                    } else {
                        console.warn(
                            "Table sessions is empty. No instances to initialize."
                        );
                    }
                });
            });
        });
        // =================================================================
        // AKHIR PERBAIKAN
        // =================================================================

        setInterval(() => {
            const activeClients = Object.keys(client);
            if (activeClients.length > 0) {
                activeClients.forEach((id) => healthCheck(id));
            }
        }, 90 * 1000);

        const serverHost = process.env.SERVER || "http://localhost";
        server = app
            .listen(PORT, () => {
                console.log(`Server is running on ${serverHost}:${PORT} ✅`);
            })
            .on("error", (err) => {
                console.error("Server error:", err);
                process.exit(1);
            });
    } catch (error) {
        console.error("Failed to start the application:", error);
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
                        e.message
                    );
                }
            })
        );
    }
    try {
        await mongoose.disconnect();
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
    console.log(`[!] Process exiting with code: ${code}`)
);

startApp();
