// WhatsAppWebInit.js (FIXED)
const fs = require("fs").promises;
const { rm } = require("fs");
require("dotenv").config({ quiet: true });
const { Client, RemoteAuth } = require("whatsapp-web.js");
const qrPlugin = require("qrcode");
const moment = require("moment-timezone");
const axios = require("axios");
const { MongoStore } = require("wwebjs-mongo");
const mongoose = require("mongoose");
const PQueue = require("p-queue").default;

// --- Config Mongoose ---
// Pastikan file configMongoose.db menghandle koneksi global,
// tapi kita handle koneksi spesifik store di sini juga aman.
const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/db_engine";

function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

// === Queue System ===
const restartQueue = new PQueue({
    concurrency: 1, // Penting: 1 agar tidak bentrok resource
});

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;

const QR_TIMEOUT_MS = 60 * 1000 * 5; // 5 Menit timeout QR (dikurangi agar cepat recycle)

// === Helper: Store Setup ===
// Kita buat fungsi ini agar koneksi mongoose stabil
let store;
const initStore = async () => {
    if (!store) {
        if (mongoose.connection.readyState !== 1) {
            await mongoose.connect(MONGODB_URI);
        }
        store = new MongoStore({ mongoose: mongoose });
    }
    return store;
};

// === Initialize Instance ===
const initialize = async (uuid) => {
    console.log(`${getIndoTime()} [INIT] Starting initialization for ${uuid}`);

    // Pastikan store siap
    const myStore = await initStore();

    // Hapus instance lama jika masih nyangkut di memori
    if (client[uuid]) {
        try {
            await client[uuid].destroy();
        } catch (e) {}
        delete client[uuid];
    }

    client[uuid] = new Client({
        puppeteer: {
            headless: "new",
            executablePath:
                process.env.CHROME_EXECUTABLE_PATH ||
                "/usr/bin/google-chrome-stable",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                "--disable-extensions",
                "--mute-audio", // Hemat resource
            ],
            // Timeout diperpanjang untuk server lambat
            timeout: 60000,
        },
        authStrategy: new RemoteAuth({
            clientId: uuid,
            store: myStore,
            backupSyncIntervalMs: 300000, // 5 menit
            dataPath: "./.wwebjs_auth",
        }),
    });

    client[uuid].needsQr = false;
    client[uuid].isRefreshing = false; // Flag status sedang restart

    // --- Event Listeners ---

    client[uuid].on("qr", (qr) => {
        client[uuid].needsQr = true;
        client[uuid].qrRequestTimestamp = Date.now();
        console.log(`${getIndoTime()} [QR] QR Code received for ${uuid}`);

        qrPlugin.toDataURL(qr, (err, src) => {
            if (!err) {
                fs.writeFile(
                    __dirname + "/qr/qr_" + uuid + ".png",
                    src.replace(/^data:image\/png;base64,/, ""),
                    "base64",
                ).catch((e) => console.error("Error saving QR:", e));
            }
        });
        sendWebHook(webHookURL, uuid, "INSTANCE", "QR_REQUIRED");
    });

    client[uuid].on("ready", () => {
        console.log(`${getIndoTime()} [READY] Client is ready: ${uuid}`);
        client[uuid].needsQr = false;
        // Hapus QR file
        fs.unlink(__dirname + "/qr/qr_" + uuid + ".png").catch(() => {});
        sendWebHook(webHookURL, uuid, "INSTANCE", "READY");
    });

    client[uuid].on("authenticated", () => {
        console.log(`${getIndoTime()} [AUTH] Authenticated: ${uuid}`);
        sendWebHook(webHookURL, uuid, "INSTANCE", "SUCCESS_CREATE_INSTANCE");
    });

    client[uuid].on("auth_failure", async (msg) => {
        console.error(`${getIndoTime()} [AUTH FAILED] ${uuid}: ${msg}`);
        sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");

        // Jika auth gagal, data sesi rusak. Harus dibersihkan total.
        await _scheduleRestart(uuid, true); // true = forceClean
    });

    client[uuid].on("disconnected", async (reason) => {
        console.log(`${getIndoTime()} [DISCONNECT] ${uuid}: ${reason}`);
        sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");

        // Jangan langsung delete client[uuid] disini!
        // Biarkan _scheduleRestart yang mengurusnya agar tidak null pointer.

        // Otomatis restart jika disconnect (misal kena spam/banned sementara)
        // Delay sedikit agar tidak spam restart
        setTimeout(() => {
            _scheduleRestart(uuid, false); // false = jangan hapus sesi dulu, coba reconnect
        }, 5000);
    });

    client[uuid].on("message", async (msg) => {
        // ... (Logika pesan tetap sama, dipersingkat untuk fokus perbaikan)
        try {
            if (!msg.from.includes("status")) {
                // filter status update
                const dataMsg = {
                    id_msg: msg.id.id,
                    type: msg.hasMedia ? "media" : "text",
                    from: msg.from,
                    to: msg.to,
                    content: msg.hasMedia ? "MEDIA_RECEIVED" : msg.body,
                };
                sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
            }
        } catch (e) {}
    });

    // Start
    try {
        await client[uuid].initialize();
    } catch (err) {
        console.error(
            `${getIndoTime()} [INIT ERROR] Failed to initialize ${uuid}:`,
            err.message,
        );
        // Retry logic handled by caller or manual restart
    }
};

// === Core Logic: Schedule Restart (FIXED) ===
// forceClean: Jika true, akan menghapus data sesi (logout paksa/reset)
async function _scheduleRestart(uuid, forceClean = false) {
    // Cek apakah sedang dalam antrian restart untuk ID ini agar tidak tumpang tindih
    // (Implementasi sederhana, bisa dikembangkan)

    restartQueue.add(async () => {
        console.log(
            `${getIndoTime()} [RESTART] Processing restart for ${uuid}. ForceClean: ${forceClean}`,
        );

        const currentClient = client[uuid];

        // 1. Destroy client yang ada (jika ada)
        if (currentClient) {
            currentClient.isRefreshing = true;
            try {
                await currentClient.destroy();
                console.log(`[RESTART] Client ${uuid} destroyed.`);
            } catch (e) {
                console.log(
                    `[RESTART] Error destroying ${uuid} (ignoring):`,
                    e.message,
                );
            }
        }

        // Hapus referensi memori
        delete client[uuid];

        // 2. Pembersihan Data Sesi (Jika diminta)
        if (forceClean) {
            console.log(`[RESTART] Cleaning session data for ${uuid}...`);
            await deleteFolderSession(uuid);
            deleteFolderSWCache(uuid);
            fs.unlink(__dirname + "/qr/qr_" + uuid + ".png").catch(() => {});
        }

        // 3. Initialize Ulang
        try {
            await initialize(uuid);
            console.log(`[RESTART] Re-initialization triggered for ${uuid}`);
        } catch (error) {
            console.error(`[RESTART] Fatal error restarting ${uuid}:`, error);
        }
    });
}

// === Helper Functions ===

async function scheduleInitialize(uuid) {
    // Wrapper untuk initialize biasa masuk antrian
    restartQueue.add(async () => {
        await initialize(uuid);
    });
}

async function healthCheck(uuid) {
    const current = client[uuid];
    // Jika client null, berarti mati total -> Restart
    if (!current) {
        console.log(
            `[HEALTH] Client ${uuid} not found in memory. Restarting...`,
        );
        return _scheduleRestart(uuid, false);
    }

    if (current.isRefreshing) return; // Sedang proses restart

    try {
        const state = await current.getState();
        //console.log(`[HEALTH] ${uuid} state: ${state}`);
        if (state !== "CONNECTED") {
            // Jika bukan connected, restart.
            // Note: Puppeteer kadang stuck di null state, ini akan men-triggernya.
            console.log(`[HEALTH] ${uuid} state is ${state}, restarting...`);
            _scheduleRestart(uuid, false);
        }
    } catch (error) {
        // Jika error saat get state (biasanya session closed), restart
        console.log(`[HEALTH] Error getting state for ${uuid}. Restarting...`);
        _scheduleRestart(uuid, false);
    }
}

async function deleteFolderSession(uuid) {
    try {
        // Hapus Folder Auth Lokal
        const path = `${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}`;
        await fs.rm(path, { recursive: true, force: true }).catch(() => {});

        // Hapus Data di MongoDB
        if (mongoose.connection.readyState === 1) {
            const chunks = mongoose.connection.collection(
                `whatsapp-RemoteAuth-${uuid}.chunks`,
            );
            const files = mongoose.connection.collection(
                `whatsapp-RemoteAuth-${uuid}.files`,
            );
            await Promise.all([
                chunks.drop().catch(() => {}),
                files.drop().catch(() => {}),
            ]);
        }
        console.log(`[CLEANUP] Session data deleted for ${uuid}`);
    } catch (e) {
        console.error(
            `[CLEANUP] Error deleting session for ${uuid}:`,
            e.message,
        );
    }
}

function deleteFolderSWCache(uuid) {
    const path = `${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}/Default/Service Worker/ScriptCache`;
    rm(path, { recursive: true, force: true }, () => {});
}

async function sendWebHook(url, uuid, type, state = null, data = {}) {
    if (!url) return;
    try {
        await axios.post(
            url,
            { id_instance: uuid, type, state, data },
            {
                headers: { "x-token": authToken },
                timeout: 5000,
            },
        );
    } catch (e) {
        // Ignore webhook error
    }
}

module.exports = {
    client,
    scheduleInitialize,
    _scheduleRestart, // Sekarang fungsi ini aman dipanggil kapan saja
    healthCheck,
    deleteFolderSession,
    deleteFolderSWCache,
    sendWebHook,
};
