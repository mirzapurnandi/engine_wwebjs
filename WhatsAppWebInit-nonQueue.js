// WhatsAppWebInit.js — CLEAN NO-QUEUE VERSION
//--------------------------------------------------------

const fs = require("fs").promises;
const { rm } = require("fs");
require("dotenv").config({ quiet: true });

const { Client, MessageMedia, RemoteAuth } = require("whatsapp-web.js");
const qrPlugin = require("qrcode");
const moment = require("moment-timezone");
const axios = require("axios");

const { MongoStore } = require("wwebjs-mongo");
require("./config/configMongoose.db");
const mongoose = require("mongoose");

const emitter = require("events").EventEmitter;
const eventLocal = new emitter();

function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const QR_TIMEOUT_MS = 50 * 60 * 1000; // 50 menit

// --------------------------------------------------------------
//  ⛔ NO QUEUE — PURE DIRECT INIT
// --------------------------------------------------------------

async function initialize(uuid, isOpen = false) {
    await mongoose.connect(MONGODB_URI, { autoIndex: true });

    const store = new MongoStore({ mongoose });

    client[uuid] = new Client({
        puppeteer: {
            headless: true,
            executablePath:
                process.env.CHROME_EXECUTABLE_PATH ||
                "/usr/bin/google-chrome-stable",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-software-rasterizer",
                "--no-first-run",
                "--no-zygote",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-sync",
                "--metrics-recording-only",
                "--mute-audio",
            ],
        },
        authStrategy: new RemoteAuth({
            clientId: uuid,
            store,
            backupSyncIntervalMs: 1000 * 60 * 60,
        }),
    });

    client[uuid].needsQr = false;

    return new Promise((resolve, reject) => {
        client[uuid].on("qr", (qr) => {
            client[uuid].needsQr = true;
            client[uuid].qrRequestTimestamp = Date.now();

            qrPlugin.toDataURL(qr, (err, src) => {
                if (!err) {
                    fs.writeFile(
                        __dirname + "/qr/qr_" + uuid + ".png",
                        src.replace(/^data:image\/png;base64,/, ""),
                        "base64"
                    );
                }
            });

            console.log(getIndoTime(), `[QR] Generated for ${uuid}`);
            sendWebHook(webHookURL, uuid, "INSTANCE", "QR_REQUIRED");

            resolve(uuid);
        });

        client[uuid].on("authenticated", () => {
            console.log(getIndoTime(), "[AUTHENTICATED]", uuid);
            sendWebHook(
                webHookURL,
                uuid,
                "INSTANCE",
                "SUCCESS_CREATE_INSTANCE"
            );
        });

        client[uuid].on("auth_failure", async (msg) => {
            console.log(getIndoTime(), "[AUTH FAILURE]", uuid, msg);
            sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");

            if (client[uuid]) {
                await client[uuid].destroy().catch(() => {});
                delete client[uuid];
            }
            await deleteFolderSession(uuid);

            reject(new Error(`Auth failure on ${uuid}: ${msg}`));
        });

        client[uuid].on("ready", () => {
            console.log(getIndoTime(), "[READY]", uuid);
            client[uuid].needsQr = false;
            deleteFile(__dirname + "/qr/qr_" + uuid + ".png");
            sendWebHook(webHookURL, uuid, "INSTANCE", "READY");
            setOnline(uuid);
            resolve(uuid);
        });

        client[uuid].on("message_ack", (msg, ack) => {
            console.log(getIndoTime(), `[DLR] ${uuid} ACK=${ack}`);

            const data = {
                destination: msg.to,
                msg: "null",
                ack: ack,
                id: msg.id.id,
            };

            sendWebHook(webHookURL, uuid, "DLR", "", data);
        });

        client[uuid].on("message", async (msg) => {
            let type = msg.hasMedia ? "media" : "text";

            console.log(
                getIndoTime(),
                `[INBOX] ${uuid} type=${type} from=${msg.from}`
            );

            let dataMsg = {
                id_msg: msg.id.id,
                type,
                from: msg.from,
                to: msg.to,
                content: msg.hasMedia ? await msg.downloadMedia() : msg.body,
            };

            sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
        });

        client[uuid].on("disconnected", async (reason) => {
            console.log(getIndoTime(), "[DISCONNECTED]", uuid, reason);

            sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");

            if (client[uuid]) {
                await client[uuid].destroy().catch(() => {});
                delete client[uuid];
            }

            deleteFolderSWCache(uuid);
        });

        if (isOpen) {
            try {
                client[uuid].initialize();
            } catch (initError) {
                reject(initError);
            }
        }
    });
}

// --------------------------------------------------------------
// MANUAL RESTART — NO QUEUE
// --------------------------------------------------------------
async function restartInstance(uuid) {
    console.log(getIndoTime(), `[MANUAL RESTART] ${uuid}`);

    if (client[uuid]) {
        try {
            await client[uuid].destroy();
        } catch {}
        delete client[uuid];
    }

    await deleteFolderSession(uuid);
    deleteFolderSWCache(uuid);

    return initialize(uuid, true);
}

// --------------------------------------------------------------
// HEALTH CHECK (langsung tanpa queue restart)
// --------------------------------------------------------------
async function healthCheck(uuid) {
    try {
        if (!client[uuid]) return;

        if (client[uuid].needsQr && client[uuid].qrRequestTimestamp) {
            const waiting = Date.now() - client[uuid].qrRequestTimestamp;

            if (waiting > QR_TIMEOUT_MS) {
                console.log(`[HEALTH] QR too long → restart instance ${uuid}`);
                return restartInstance(uuid);
            }
            return;
        }

        const state = await client[uuid].getState().catch(() => null);
        if (!state || state !== "CONNECTED") {
            console.log(`[HEALTH] ${uuid} unhealthy → restart`);
            return restartInstance(uuid);
        }
    } catch (e) {
        console.log(`[HEALTH ERROR] ${uuid} → restart`);
        restartInstance(uuid);
    }
}

// --------------------------------------------------------------
// UTILITIES
// --------------------------------------------------------------

function setOnline(uuid) {
    client[uuid]?.sendPresenceAvailable().catch(() => notifyDisconnect(uuid));
}

function notifyDisconnect(uuid) {
    sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");
}

function deleteFile(path) {
    fs.unlink(path).catch(() => {});
}

async function deleteFolderSession(uuid) {
    try {
        await fs.rm(`${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}`, {
            recursive: true,
            force: true,
        });

        const chunks = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${uuid}.chunks`
        );
        const files = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${uuid}.files`
        );

        await Promise.all([
            chunks.drop().catch(() => {}),
            files.drop().catch(() => {}),
        ]);
    } catch {}
}

function deleteFolderSWCache(uuid) {
    const dir = `${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}/Default/Service Worker/ScriptCache`;

    rm(dir, { recursive: true, force: true }, () => {});
}

async function sendWebHook(url, uuid, type, state = null, data = {}) {
    try {
        await axios.post(
            url,
            { id_instance: uuid, type, state, data },
            { headers: { "x-purnand-token": authToken } }
        );
    } catch {}
}

// --------------------------------------------------------------
// EXPORTS
// --------------------------------------------------------------
module.exports = {
    client,
    initialize,
    restartInstance,
    healthCheck,
    deleteFolderSession,
    deleteFolderSWCache,
    deleteFile,
    notifyDisconnect,
    sendWebHook,
};
