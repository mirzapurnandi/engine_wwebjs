const fs = require("fs");
require("dotenv").config({ quiet: true });
const { Client, MessageMedia, RemoteAuth } = require("whatsapp-web.js");
const qrPlugin = require("qrcode");
const moment = require("moment-timezone");
const axios = require("axios");
const { MongoStore } = require("wwebjs-mongo");
require("./config/configMongoose.db");
const mongoose = require("mongoose");
const PQueue = require("p-queue").default;

const emitter = require("events").EventEmitter;
const eventLocal = new emitter();

function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

// === Queue restart / init serial ===
const restartQueue = new PQueue({
    concurrency: parseInt(process.env.RESTART_CONCURRENCY || "1", 10),
    interval: parseInt(process.env.RESTART_INTERVAL || "10000", 10),
    intervalCap: 1,
});

restartQueue.on("active", () => {
    console.log(
        `${getIndoTime()} [QUEUE] Task started. Pending: ${
            restartQueue.pending
        } | Running: ${restartQueue.size}`
    );
});
restartQueue.on("completed", () => {
    console.log(
        `${getIndoTime()} [QUEUE] Task completed. Pending: ${
            restartQueue.pending
        } | Running: ${restartQueue.size}`
    );
});
restartQueue.on("error", (error) => {
    console.log(`${getIndoTime()} [QUEUE] Task error: ${error.message}`);
});

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// === Initialize / create instance ===
const initialize = async (uuid, isOpen = false) => {
    await mongoose.connect(MONGODB_URI, { autoIndex: true });
    const store = new MongoStore({ mongoose });
    client[uuid] = new Client({
        puppeteer: {
            headless: true,
            executablePath: "/usr/bin/google-chrome-stable",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-software-rasterizer",
                "--no-first-run",
                "--no-zygote",
            ],
        },
        authStrategy: new RemoteAuth({
            clientId: uuid,
            store,
            backupSyncIntervalMs: 1000 * 60 * 60,
        }),
    });

    client[uuid].needsQr = false; // default

    return new Promise((resolve, reject) => {
        client[uuid].on("qr", (qr) => {
            client[uuid].needsQr = true;
            qrPlugin.toDataURL(qr, (err, src) => {
                if (!err) {
                    fs.writeFile(
                        __dirname + "/qr/qr_" + uuid + ".png",
                        src.replace(/^data:image\/png;base64,/, ""),
                        "base64",
                        () => {
                            console.log(
                                getIndoTime(),
                                "[+] QR Generated:",
                                uuid
                            );
                        }
                    );
                }
            });
            sendWebHook(webHookURL, uuid, "INSTANCE", "QR_REQUIRED");
            resolve(uuid);
        });

        client[uuid].on("authenticated", (session) => {
            console.log(getIndoTime(), "[+] Authenticated:", uuid);
            sendWebHook(
                webHookURL,
                uuid,
                "INSTANCE",
                "SUCCESS_CREATE_INSTANCE"
            );
            // eventLocal.emit(uuid, "ACTIVE");
        });

        client[uuid].on("auth_failure", async (msg) => {
            console.log(getIndoTime(), "[!] Auth Failure:", uuid, msg);
            sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");
            await client[uuid].destroy().catch(() => {});
            await deleteFolderSession(uuid);
            reject(new Error(`Auth failure on ${uuid}: ${msg}`));
        });

        client[uuid].on("message_ack", (msg, ack) => {
            console.log(
                `${getIndoTime()} [+] DLR : ${uuid}, ID : ${
                    msg.id.id
                }, ACK : ${ack}`
            );

            data = {
                destination: msg.to,
                msg: "null",
                ack: ack,
                id: msg.id.id,
            };
            const state = "";
            sendWebHook(webHookURL, uuid, "DLR", state, data);

            /*
                == ACK VALUES ==
                ACK_ERROR: -1
                ACK_PENDING: 0              //waiting network
                ACK_SERVER: 1               //ceklis 1
                ACK_DEVICE: 2               //ceklist 2 
                ACK_READ: 3                 //ceklist 2 and read
                ACK_PLAYED: 4
            */
        });

        client[uuid].on("ready", () => {
            client[uuid].needsQr = false;
            console.log(getIndoTime(), "[+] Ready:", uuid);
            deleteFile(__dirname + "/qr/qr_" + uuid + ".png");
            client[uuid].removeAllListeners("qr");
            sendWebHook(webHookURL, uuid, "INSTANCE", "READY");
            setOnline(uuid);
            resolve(uuid);
        });

        client[uuid].on("message", async (msg) => {
            let msgType = "text";
            if (msg.hasMedia) {
                msgType = "media";
            }
            //console.log(dateTime + " [INBOX] Receive New Message Type : " + msgType);
            console.log(
                `${getIndoTime()} [INBOX] Receive New Message Type : ${msgType} | from : ${await msg.from} | to : ${await msg.to}`
            );

            if (msg.hasMedia) {
                if (process.env.type == "INTERACTIVE") {
                    const media = await msg.downloadMedia();
                    //send webhook
                    let dataMsg = {
                        id_msg: await msg.id.id,
                        type: "media",
                        from: await msg.from,
                        content: media,
                    };
                    sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
                }
            } else {
                //console.log(msg);
                //push message
                let message = await msg.body;
                //send webhook
                let dataMsg = {
                    id_msg: await msg.id.id,
                    type: "text",
                    from: await msg.from,
                    to: await msg.to,
                    content: message,
                };
                if (message !== "") {
                    sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
                }
            }
        });

        client[uuid].on("change_state", (state) => {
            console.log(`[#] ${uuid} CHANGE STATE`, state);
        });

        client[uuid].on("disconnected", async (reason) => {
            console.log(getIndoTime(), "[!] Disconnected:", uuid, reason);
            sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");
            await client[uuid].destroy().catch(() => {});
            deleteFolderSWCache(uuid);
        });

        if (isOpen) client[uuid].initialize();
    });
};

// === Schedule Init / Restart via queue ===
async function scheduleInitialize(uuid) {
    restartQueue.add(async () => {
        console.log(`[QUEUE] Booting instance ${uuid}...`);
        try {
            await initialize(uuid, true);
            console.log(`[QUEUE] Instance ${uuid} initialized.`);
        } catch (err) {
            console.log(`[QUEUE] Failed init ${uuid}:`, err.message);
        }
    });
}

async function _scheduleRestart(uuid) {
    if (!client[uuid]) return;
    client[uuid].isRefreshing = true;
    sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");

    restartQueue.add(async () => {
        console.log(`[QUEUE] Restarting instance ${uuid}...`);
        try {
            await client[uuid].destroy().catch(() => {});
            console.log(`[QUEUE] Client destroyed: ${uuid}`);
            await initialize(uuid, true);
            console.log(`[QUEUE] Client restarted: ${uuid}`);
        } catch (err) {
            console.log(`[QUEUE] Restart failed ${uuid}:`, err.message);
        } finally {
            if (client[uuid]) client[uuid].isRefreshing = false;
        }
    });
}

// === Health check ===
async function healthCheck(uuid) {
    try {
        if (!client[uuid]) return;
        if (client[uuid]?.isRefreshing) return;
        if (client[uuid].needsQr) {
            console.log(`[HEALTH] ${uuid} is waiting for QR scan, skip check.`);
            return;
        }

        const state = await client[uuid].getState().catch(() => null);
        if (!state || state !== "CONNECTED") {
            console.log(
                `[HEALTH] ${uuid} not connected, scheduling restart...`
            );
            await _scheduleRestart(uuid);
        } else {
            console.log(`[HEALTH] ${uuid} is healthy`);
        }
    } catch (e) {
        console.log(`[HEALTH] Error checking ${uuid}:`, e.message);
        await _scheduleRestart(uuid);
    }
}

// === Utils ===
function setOnline(uuid) {
    client[uuid]?.sendPresenceAvailable().catch(() => notifyDisconnect(uuid));
}

function notifyDisconnect(uuid) {
    sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");
}

function deleteFile(path) {
    fs.unlink(path, () => {});
}

async function deleteFolderSession(uuid) {
    try {
        fs.rmSync(`${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}`, {
            recursive: true,
            force: true,
        });
        const chunks = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${uuid}.chunks`
        );
        const files = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${uuid}.files`
        );
        await chunks.drop().catch(() => {});
        await files.drop().catch(() => {});
    } catch (e) {
        console.log("[!] Error deleteFolderSession:", uuid, e.message);
    }
}

function deleteFolderSWCache(uuid) {
    try {
        fs.rm(
            `${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}/Default/Service Worker/ScriptCache`,
            { recursive: true },
            () => {}
        );
    } catch {}
}

async function sendWebHook(url, uuid, type, state = null, data = {}) {
    try {
        await axios.post(
            url,
            { id_instance: uuid, type, state, data, timeout: 120000 },
            { headers: { "x-purnand-token": authToken } }
        );
    } catch {}
}

module.exports = {
    client,
    initialize,
    scheduleInitialize,
    _scheduleRestart,
    healthCheck,
    deleteFolderSession,
    deleteFolderSWCache,
    deleteFile,
    notifyDisconnect,
    sendWebHook,
};
