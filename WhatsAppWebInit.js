const path = require("path");
const fs = require("fs").promises;
require("dotenv").config({ quiet: true });

// Import whatsapp-web.js (Tanpa LocalAuth karena sesi akan di-handle langsung oleh Puppeteer)
const { Client } = require("whatsapp-web.js");

// === IMPORT PUPPETEER SILUMAN ===
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

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

restartQueue.on("active", () => {
    console.log(
        `${getIndoTime()} [QUEUE] Task started. Pending: ${
            restartQueue.pending
        } | Running: ${restartQueue.size}`,
    );
});
restartQueue.on("completed", () => {
    console.log(
        `${getIndoTime()} [QUEUE] Task completed. Pending: ${
            restartQueue.pending
        } | Running: ${restartQueue.size}`,
    );
});
restartQueue.on("error", (error) => {
    console.log(`${getIndoTime()} [QUEUE] Task error: ${error.message}`);
});

let client = {};
const webHookURL = process.env.HOST_WEBHOOK;
const authToken = process.env.AUTH_TOKEN;

const QR_TIMEOUT_MS = 50 * 60 * 1000; // 50 menit

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

    let browser;
    try {
        // 1. BUKA BROWSER MANUAL MENGGUNAKAN PUPPETEER EXTRA (STEALTH)
        browser = await puppeteer.launch({
            headless: "new",
            executablePath:
                process.env.CHROME_EXECUTABLE_PATH ||
                "/usr/bin/google-chrome-stable",
            userDataDir: sessionPath, // <-- Ini menggantikan fungsi LocalAuth dengan sempurna
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
                "--disable-blink-features=AutomationControlled", // <-- BENDERA ANTI-BOT PALING PENTING
            ],
        });
    } catch (err) {
        console.error(
            `[!] Gagal meluncurkan Stealth Browser untuk ${uuid}:`,
            err.message,
        );
        throw err;
    }

    // 2. SAMBUNGKAN WHATSAPP-WEB.JS KE BROWSER SILUMAN TERSEBUT
    client[uuid] = new Client({
        puppeteer: {
            browserWSEndpoint: browser.wsEndpoint(),
        },
    });

    // Simpan referensi browser ke dalam object client agar nanti mudah di-close (Mencegah RAM Bocor)
    client[uuid].stealthBrowser = browser;
    client[uuid].needsQr = false; // default

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

            // Hancurkan client & MATIKAN BROWSER SILUMAN
            if (client[uuid]) {
                if (client[uuid].stealthBrowser) {
                    await client[uuid].stealthBrowser.close().catch(() => {});
                }
                await client[uuid].destroy().catch(() => {});
                delete client[uuid];
            }

            await deleteFolderSession(uuid);
            reject(new Error(`Auth failure on ${uuid}: ${msg}`));
        });

        client[uuid].on("message_ack", (msg, ack) => {
            console.log(
                `${getIndoTime()} [+] DLR : ${uuid}, ID : ${
                    msg.id.id
                }, ACK : ${ack}`,
            );

            let data = {
                destination: msg.to,
                msg: "null",
                ack: ack,
                id: msg.id.id,
            };
            const state = "";
            sendWebHook(webHookURL, uuid, "DLR", state, data);
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
            let msgType = "text";
            if (msg.hasMedia) {
                msgType = "media";
            }

            let realPhone = "";
            try {
                const contact = await msg.getContact();
                // contact.number biasanya berisi nomor murni (misal: 6281234567890) tanpa @c.us / @lid
                realPhone = contact.number || (await msg.from).split("@")[0];
            } catch (err) {
                // Fallback jika gagal mengambil kontak
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

        client[uuid].on("change_state", (state) => {
            console.log(`[#] ${uuid} CHANGE STATE`, state);
        });

        client[uuid].on("disconnected", async (reason) => {
            console.log(getIndoTime(), "[!] Disconnected:", uuid, reason);
            sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT", {
                reason: reason,
            });

            // Hancurkan client & MATIKAN BROWSER SILUMAN
            if (client[uuid]) {
                if (client[uuid].stealthBrowser) {
                    await client[uuid].stealthBrowser.close().catch(() => {});
                }
                await client[uuid]
                    .destroy()
                    .catch((e) =>
                        console.error(
                            `Error destroying client ${uuid}:`,
                            e.message,
                        ),
                    );
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

// === Schedule Init / Restart via queue ===
async function scheduleInitialize(uuid) {
    restartQueue.add(async () => {
        console.log(`[QUEUE] Booting instance ${uuid}...`);
        try {
            await initialize(uuid, true);
            console.log(
                `[QUEUE] Instance ${uuid} initialization process started.`,
            );
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
    } else {
        console.log(
            `[QUEUE] Instance ${uuid} not found/dead. Forcing re-initialization...`,
        );
    }

    restartQueue.add(async () => {
        console.log(`[QUEUE] Starting restart process for instance ${uuid}...`);
        try {
            if (currentClient && typeof currentClient.destroy === "function") {
                // MATIKAN BROWSER SILUMAN TERLEBIH DAHULU SAAT RESTART
                if (currentClient.stealthBrowser) {
                    await currentClient.stealthBrowser.close().catch(() => {});
                }
                await currentClient.destroy().catch((e) => {
                    console.error(
                        `[QUEUE] Error during destroy for ${uuid}:`,
                        e.message,
                    );
                });
                console.log(`[QUEUE] Client destroyed: ${uuid}`);
            }

            delete client[uuid];

            await initialize(uuid, true);
            console.log(`[QUEUE] Client re-initialization queued: ${uuid}`);
        } catch (err) {
            console.error(
                `[QUEUE] FATAL restart failed for ${uuid}:`,
                err.message,
            );
        } finally {
            console.log(
                `[QUEUE] Finished restart attempt for ${uuid}. Resetting refresh flag.`,
            );
            if (client[uuid]) {
                client[uuid].isRefreshing = false;
            }
        }
    });
}

// === Health check ===
async function healthCheck(uuid) {
    try {
        if (!client[uuid]) {
            console.log(
                `[HEALTH] Instance ${uuid} is missing/dead. Scheduling restart...`,
            );
            return _scheduleRestart(uuid);
        }
        if (client[uuid].isRefreshing) return;

        if (client[uuid].needsQr && client[uuid].qrRequestTimestamp) {
            const timeSinceQr = Date.now() - client[uuid].qrRequestTimestamp;

            if (timeSinceQr > QR_TIMEOUT_MS) {
                console.log(
                    `[HEALTH] ${uuid} has been waiting for QR scan for too long (${Math.round(
                        timeSinceQr / 1000,
                    )}s). Forcing restart...`,
                );
                await _scheduleRestart(uuid);
            } else {
                console.log(
                    `[HEALTH] ${uuid} is waiting for QR scan, skip check.`,
                );
            }
            return;
        }

        const state = await client[uuid].getState().catch(() => null);
        if (!state || state !== "CONNECTED") {
            console.log(
                `[HEALTH] ${uuid} is not connected (State: ${state}). Scheduling restart...`,
            );
            await _scheduleRestart(uuid);
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

async function deleteFile(filePath) {
    try {
        if (!filePath) return;
        await fs.unlink(filePath);
    } catch (error) {
        if (error.code === "ENOENT") return;
        console.error(`[!] Gagal menghapus file ${filePath}:`, error.message);
    }
}

async function deleteFolderSession(uuid) {
    try {
        await fs.rm(`${__dirname}/.wwebjs_auth_local/session-${uuid}`, {
            recursive: true,
            force: true,
        });
        console.log(`[+] Session data deleted for ${uuid}`);
    } catch (e) {
        console.log("[!] Error deleteFolderSession:", uuid, e.message);
    }
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
