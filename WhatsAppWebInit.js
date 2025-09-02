const fs = require("fs");
const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const qrPlugin = require("qrcode");
const axios = require("axios");
const { MongoStore } = require("wwebjs-mongo");
const connectMongoose = require("./config/configMongoose.db");

const eventEmitter = require("events").EventEmitter;
const eventLocal = new eventEmitter();

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;

const initialize = async (uuid, autoStart = false) => {
    const mongoose = await connectMongoose();
    const store = new MongoStore({ mongoose });

    client[uuid] = new Client({
        puppeteer: {
            headless: true,
            executablePath: "/usr/bin/chromium-browser",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ],
        },
        authStrategy: new RemoteAuth({
            clientId: uuid,
            store: store,
            backupSyncIntervalMs: 1000 * 60 * 60, // 1 jam
        }),
    });

    // =====================
    // Events
    // =====================
    client[uuid].on("qr", (qr) => {
        qrPlugin.toDataURL(qr, (err, src) => {
            if (err) return console.error("QR Error:", err);
            const base64Data = src.replace(/^data:image\/png;base64,/, "");
            fs.writeFileSync(
                `${__dirname}/qr/qr_${uuid}.png`,
                base64Data,
                "base64"
            );
            console.log(`[${uuid}] QR generated ✅`);
        });
    });

    client[uuid].on("authenticated", () => {
        console.log(`[${uuid}] Authenticated (saved to MongoDB)`);
        sendWebHook(webHookURL, uuid, "INSTANCE", "AUTHENTICATED");
        eventLocal.emit(uuid, "ACTIVE");
    });

    client[uuid].on("ready", () => {
        console.log(`[${uuid}] Client is ready ✅`);
        deleteFile(`${__dirname}/qr/qr_${uuid}.png`);
        sendWebHook(webHookURL, uuid, "INSTANCE", "READY");
    });

    client[uuid].on("auth_failure", async (msg) => {
        console.error(`[${uuid}] Auth failure ❌`, msg);
        sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");
        await client[uuid].destroy();
    });

    client[uuid].on("disconnected", (reason) => {
        console.log(`[${uuid}] Disconnected ❌ Reason:`, reason);
        sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECTED");
        client[uuid].destroy();
    });

    client[uuid].on("message", async (msg) => {
        const msgType = msg.hasMedia ? "media" : "text";
        console.log(`[${uuid}] New ${msgType} message from ${msg.from}`);

        let dataMsg = {
            id_msg: msg.id.id,
            type: msgType,
            from: msg.from,
            to: msg.to,
        };

        if (msg.hasMedia) {
            const media = await msg.downloadMedia();
            dataMsg.content = media;
        } else {
            dataMsg.content = msg.body;
        }

        sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
    });

    if (autoStart) {
        client[uuid].initialize();
    }
};

// =====================
// Helpers
// =====================
function deleteFile(path) {
    try {
        if (fs.existsSync(path)) fs.unlinkSync(path);
    } catch (err) {
        console.error("Error delete file:", err);
    }
}

async function sendWebHook(url, idInstance, type, state = null, data = {}) {
    try {
        await axios.post(
            url,
            {
                id_instance: idInstance,
                type,
                state,
                data,
            },
            {
                headers: { "x-purnand-token": authToken },
                timeout: 120000,
            }
        );
        console.log(`[${idInstance}] Webhook sent (${type}) ✅`);
    } catch (err) {
        console.error(
            `[${idInstance}] Failed send webhook (${type}):`,
            err.message
        );
    }
}

module.exports = {
    client,
    initialize,
    eventLocal,
    sendWebHook,
};
