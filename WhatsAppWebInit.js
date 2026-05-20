const path = require("path");
const fs = require("fs").promises;
require("dotenv").config({ quiet: true });

// KEMBALI MENGGUNAKAN BAWAAN WWEBJS SEPENUHNYA
const { Client, LocalAuth } = require("whatsapp-web.js");

const qrPlugin = require("qrcode");
const moment = require("moment-timezone");
const axios = require("axios");
const PQueue = require("p-queue").default;

const emitter = require("events").EventEmitter;
const eventLocal = new emitter();

function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

// === Queue restart / init serial ===
const restartQueue = new PQueue({
    concurrency: parseInt(process.env.RESTART_CONCURRENCY || "1", 10),
    interval: parseInt(process.env.RESTART_INTERVAL || "30000", 10),
    intervalCap: 1,
});

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;
const QR_TIMEOUT_MS = 50 * 60 * 1000;

// === Initialize / create instance ===
const initialize = async (uuid, isOpen = false) => {
    const sessionPath = path.join(
        __dirname,
        ".wwebjs_auth_local",
        `session-${uuid}`,
    );
    const lockPath = path.join(sessionPath, "SingletonLock");

    try {
        await fs.unlink(lockPath).catch(() => {});
        console.log(`[CLEANUP] Lock file cleared for ${uuid}`);
    } catch (e) {}

    // KITA KEMBALI MENGGUNAKAN LOCAL AUTH (STABIL UNTUK WA)
    const authLocal = new LocalAuth({
        clientId: uuid,
        dataPath: "./.wwebjs_auth_local",
    });

    // IMPLEMENTASI NATIVE STEALTH DI DALAM CLIENT
    client[uuid] = new Client({
        authStrategy: authLocal,
        puppeteer: {
            // JANGAN gunakan "new", gunakan true agar Chrome tidak menidurkan Service Worker WA
            headless: false,
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
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-timer-throttling",
                "--disable-software-rasterizer",
                "--disable-extensions",
                "--disable-client-side-phishing-detection",
                "--mute-audio",
                "--disable-default-apps",
                "--no-default-browser-check",
                "--disable-site-isolation-trials",
                "--disable-popup-blocking",
                "--disable-blink-features=AutomationControlled", // INI PENGGANTI PLUGIN STEALTH UTAMA
                "--lang=id-ID,id",
            ],
            env: {
                ...process.env,
                TZ: "Asia/Jakarta",
            },
        },
        // GANTI USER AGENT AGAR TIDAK TERBACA SEBAGAI HEADLESS CHROME/BOT
        userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
                        "base64",
                        () => {
                            console.log(
                                getIndoTime(),
                                "[+] QR Generated:",
                                uuid,
                            );
                        },
                    );
                }
            });
            sendWebHook(webHookURL, uuid, "INSTANCE", "QR_REQUIRED");
            resolve(uuid);
        });

        client[uuid].on("authenticated", () => {
            console.log(getIndoTime(), "[+] Authenticated:", uuid);
            sendWebHook(
                webHookURL,
                uuid,
                "INSTANCE",
                "SUCCESS_CREATE_INSTANCE",
            );
        });

        client[uuid].on("auth_failure", async (msg) => {
            console.log(getIndoTime(), "[!] Auth Failure:", uuid, msg);
            sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");

            if (client[uuid]) {
                await client[uuid].destroy().catch(() => {});
                delete client[uuid];
            }
            await deleteFolderSession(uuid);
            reject(new Error(`Auth failure on ${uuid}: ${msg}`));
        });

        client[uuid].on("message_ack", (msg, ack) => {
            console.log(
                `${getIndoTime()} [+] DLR : ${uuid}, ID : ${msg.id.id}, ACK : ${ack}`,
            );
            let data = {
                destination: msg.to,
                msg: "null",
                ack: ack,
                id: msg.id.id,
            };
            sendWebHook(webHookURL, uuid, "DLR", "", data);
        });

        client[uuid].on("ready", () => {
            client[uuid].needsQr = false;
            if (client[uuid].qrRequestTimestamp) {
                delete client[uuid].qrRequestTimestamp;
            }
            console.log(getIndoTime(), "[+] Ready:", uuid);
            deleteFile(__dirname + "/qr/qr_" + uuid + ".png");
            client[uuid].removeAllListeners("qr");
            sendWebHook(webHookURL, uuid, "INSTANCE", "READY");
            setOnline(uuid);
            resolve(uuid);
        });

        client[uuid].on("message", async (msg) => {
            let msgType = msg.hasMedia ? "media" : "text";

            let realPhone = "";
            try {
                const contact = await msg.getContact();
                realPhone = contact.number || (await msg.from).split("@")[0];
            } catch (err) {
                realPhone = (await msg.from).split("@")[0];
            }

            console.log(
                `${getIndoTime()} [INBOX] Receive New Message Type : ${msgType} | from : ${await msg.from} | to : ${await msg.to}`,
            );

            if (msg.hasMedia) {
                const media = await msg.downloadMedia();
                let captionText = await msg.body;
                let dataMsg = {
                    id_msg: await msg.id.id,
                    type: "media",
                    from: await msg.from,
                    real_phone: realPhone,
                    to: await msg.to,
                    caption: captionText,
                    content: media,
                };
                sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
            } else {
                let message = await msg.body;
                let dataMsg = {
                    id_msg: await msg.id.id,
                    type: "text",
                    from: await msg.from,
                    real_phone: realPhone,
                    to: await msg.to,
                    content: message,
                };
                if (message !== "") {
                    sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
                }
            }
        });

        client[uuid].on("disconnected", async (reason) => {
            console.log(getIndoTime(), "[!] Disconnected:", uuid, reason);
            sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT", {
                reason: reason,
            });

            if (client[uuid]) {
                await client[uuid].destroy().catch(() => {});
                delete client[uuid];
            }
        });

        if (isOpen) {
            try {
                client[uuid].initialize();
            } catch (initError) {
                console.error(
                    `[!] Direct initialize call failed for ${uuid}:`,
                    initError,
                );
                reject(initError);
            }
        }
    });
};

async function scheduleInitialize(uuid) {
    restartQueue.add(async () => {
        console.log(`[QUEUE] Booting instance ${uuid}...`);
        try {
            await initialize(uuid, true);
            await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (err) {
            console.error(
                `[QUEUE] FATAL ERROR during initialize for ${uuid}:`,
                err.message,
            );
        }
    });
}

async function _scheduleRestart(uuid) {
    const currentClient = client[uuid];
    if (currentClient) {
        currentClient.isRefreshing = true;
        sendWebHook(webHookURL, uuid, "INSTANCE", "RESTARTING");
    }

    restartQueue.add(async () => {
        console.log(`[QUEUE] Starting restart process for instance ${uuid}...`);
        try {
            if (currentClient && typeof currentClient.destroy === "function") {
                await currentClient.destroy().catch(() => {});
            }
            delete client[uuid];
            await initialize(uuid, true);
        } catch (err) {
            console.error(
                `[QUEUE] FATAL restart failed for ${uuid}:`,
                err.message,
            );
        } finally {
            if (client[uuid]) {
                client[uuid].isRefreshing = false;
            }
        }
    });
}

async function healthCheck(uuid) {
    try {
        if (!client[uuid]) {
            return _scheduleRestart(uuid);
        }
        if (client[uuid].isRefreshing) return;

        if (client[uuid].needsQr && client[uuid].qrRequestTimestamp) {
            const timeSinceQr = Date.now() - client[uuid].qrRequestTimestamp;
            if (timeSinceQr > QR_TIMEOUT_MS) {
                await _scheduleRestart(uuid);
            }
            return;
        }

        const state = await client[uuid].getState().catch(() => null);
        if (!state || state !== "CONNECTED") {
            await _scheduleRestart(uuid);
        }
    } catch (e) {
        await _scheduleRestart(uuid);
    }
}

function setOnline(uuid) {
    client[uuid]?.sendPresenceAvailable().catch(() => notifyDisconnect(uuid));
}

function notifyDisconnect(uuid) {
    sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT");
}

async function deleteFile(filePath) {
    try {
        if (!filePath) return;
        await fs.unlink(filePath);
    } catch (error) {}
}

async function deleteFolderSession(uuid) {
    try {
        await fs.rm(`${__dirname}/.wwebjs_auth_local/session-${uuid}`, {
            recursive: true,
            force: true,
        });
        console.log(`[+] Session data deleted for ${uuid}`);
    } catch (e) {}
}

async function sendWebHook(url, uuid, type, state = null, data = {}) {
    try {
        await axios.post(
            url,
            { id_instance: uuid, type, state, data, timeout: 120000 },
            { headers: { "x-purnand-token": authToken } },
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
    deleteFile,
    notifyDisconnect,
    sendWebHook,
};
