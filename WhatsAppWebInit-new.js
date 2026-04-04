// WhatsAppWebInit.js — FINAL PRODUCTION VERSION

const { Client, LocalAuth, RemoteAuth } = require("whatsapp-web.js");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config();

const authToken = process.env.PURNAND_TOKEN || "";
const WEBHOOK_URL = "https://server.wasend.id/api/dlr/listen-dlr";

// =========================
// STORAGE PATH
// =========================
const SESSION_DIR = "/var/www/engine_wwebjs/.wwebjs_auth";
const CACHE_DIR = "/var/www/engine_wwebjs/.wwebjs_cache";

// =========================
// GLOBAL CLIENT POOL
// =========================
const client = {};
const MAX_INSTANCE = 15;

// =========================
// UTIL: DELETE FOLDER
// =========================
function deleteFolderSession(id) {
    try {
        const dir = `${SESSION_DIR}/RemoteAuth-${id}`;
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
}

function deleteFolderSWCache(id) {
    try {
        const dir = `${CACHE_DIR}/${id}`;
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
}

// =========================
// UTIL: WEBHOOK (versi kamu)
// =========================
async function sendWebHook(url, uuid, type, state = null, data = {}) {
    try {
        await axios.post(
            url,
            { id_instance: uuid, type, state, data, timeout: 120000 },
            { headers: { "x-purnand-token": authToken } }
        );
    } catch {}
}

// =========================
// CREATE / INIT CLIENT
// =========================
async function initializeClient(id_instance) {
    if (!id_instance) return;

    // Batasi max instance
    const active = Object.keys(client).length;
    if (active >= MAX_INSTANCE && !client[id_instance]) {
        console.log(
            `[LIMIT] Instance limit reached: ${active}/${MAX_INSTANCE}`
        );
        return;
    }

    console.log(`\n[INIT] Starting instance ${id_instance} ...`);

    // Bersihkan cache lama sebelum start
    deleteFolderSWCache(id_instance);

    const authStrategy = new RemoteAuth({
        clientId: id_instance,
        dataPath: SESSION_DIR,
        backupSyncIntervalMs: 40000,
    });

    const c = new Client({
        restartOnAuthFail: true,
        puppeteer: {
            headless: false, // MODE B (manual visible chromium)
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-software-rasterizer",
            ],
        },
        authStrategy,
        webVersionCache: {
            type: "remote",
            remotePath:
                "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
        },
    });

    // SIMPAN KE POOL
    client[id_instance] = c;

    // ======================
    // EVENT HANDLERS
    // ======================

    c.on("qr", (qr) => {
        console.log(`[QR] Instance ${id_instance} generated QR`);
        sendWebHook(WEBHOOK_URL, id_instance, "qr", "show_qr", { qr });
    });

    c.on("ready", () => {
        console.log(`[READY] Instance ${id_instance}`);
        sendWebHook(WEBHOOK_URL, id_instance, "ready", "connected");
    });

    c.on("authenticated", () => {
        console.log(`[AUTH] Instance ${id_instance}`);
        sendWebHook(WEBHOOK_URL, id_instance, "authenticated", "success");
    });

    c.on("message", (msg) => {
        sendWebHook(WEBHOOK_URL, id_instance, "message", "received", {
            from: msg.from,
            body: msg.body,
        });
    });

    c.on("disconnected", (reason) => {
        console.log(`[DISC] ${id_instance}: ${reason}`);
        sendWebHook(WEBHOOK_URL, id_instance, "disconnected", reason);

        // Bersihkan folder auth + cache jika disconnect
        deleteFolderSession(id_instance);
        deleteFolderSWCache(id_instance);

        // Restart otomatis
        setTimeout(() => initializeClient(id_instance), 3000);
    });

    c.on("auth_failure", () => {
        console.log(`[AUTH_FAIL] ${id_instance}`);
        deleteFolderSession(id_instance);
        deleteFolderSWCache(id_instance);

        sendWebHook(WEBHOOK_URL, id_instance, "auth_fail", "failed");

        // Restart
        setTimeout(() => initializeClient(id_instance), 2000);
    });

    c.on("error", (err) => {
        console.error(`[ERR] Instance ${id_instance}:`, err.message);

        sendWebHook(WEBHOOK_URL, id_instance, "error", null, {
            error: err.message,
        });
    });

    // Jalankan
    try {
        await c.initialize();
    } catch (e) {
        console.error(`[FATAL INIT ERROR] ${id_instance}:`, e.message);

        deleteFolderSession(id_instance);
        deleteFolderSWCache(id_instance);

        // Restart jika gagal
        setTimeout(() => initializeClient(id_instance), 4000);
    }
}

// =========================
// MANUAL RESTART INSTANCE
// =========================
async function restartInstance(id) {
    console.log(`\n[MANUAL RESTART] ${id}`);

    try {
        if (client[id]) {
            await client[id].destroy();
            delete client[id];
        }
    } catch {}

    deleteFolderSession(id);
    deleteFolderSWCache(id);

    return initializeClient(id);
}

// =========================
// HEALTH CHECK (90s)
// =========================
async function healthCheck(id) {
    const c = client[id];
    if (!c) return;

    try {
        const state = await c.getState().catch(() => null);
        if (!state) {
            console.log(`[HEALTH] Instance ${id} unhealthy → Restart`);
            await restartInstance(id);
        }
    } catch (e) {
        console.log(`[HEALTH] ERROR ${id} → Restart`);
        await restartInstance(id);
    }
}

// =========================
// SCHEDULER START
// =========================
function scheduleInitialize(id) {
    setTimeout(() => initializeClient(id), 500);
}

module.exports = {
    client,
    initializeClient,
    restartInstance,
    scheduleInitialize,
    healthCheck,
};
