const path = require("path");
const fs = require("fs").promises;
require("dotenv").config({ quiet: true });
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
        // Hapus file lock jika ada agar Puppeteer tidak menganggap browser sedang jalan
        await fs.unlink(lockPath).catch(() => {});
        console.log(`[CLEANUP] Lock file cleared for ${uuid}`);
    } catch (e) {
        // Abaikan jika folder belum ada
    }

    const authLocal = new LocalAuth({
        clientId: uuid,
        dataPath: "./.wwebjs_auth_local", // Folder sesi
    });

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
                /* "--proxy-server='direct://'",
                "--proxy-bypass-list=*",
                "--disable-default-apps",
                "--window-size=1280,800", */ // Memaksa ukuran window agar render konsisten
            ],
        },
        authStrategy: authLocal,
    });

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

        client[uuid].on("authenticated", (session) => {
            console.log(getIndoTime(), "[+] Authenticated:", uuid);
            sendWebHook(
                webHookURL,
                uuid,
                "INSTANCE",
                "SUCCESS_CREATE_INSTANCE",
            );
            // eventLocal.emit(uuid, "ACTIVE");
        });

        client[uuid].on("auth_failure", async (msg) => {
            console.log(getIndoTime(), "[!] Auth Failure:", uuid, msg);
            sendWebHook(webHookURL, uuid, "INSTANCE", "AUTH_FAILURE");

            // Hancurkan client yang gagal
            if (client[uuid]) {
                await client[uuid].destroy().catch(() => {});
                delete client[uuid]; // Hapus dari memori
            }

            await deleteFolderSession(uuid);
            // Reject promise untuk memberi tahu pemanggil bahwa inisialisasi gagal
            reject(new Error(`Auth failure on ${uuid}: ${msg}`));
        });

        client[uuid].on("message_ack", (msg, ack) => {
            console.log(
                `${getIndoTime()} [+] DLR : ${uuid}, ID : ${
                    msg.id.id
                }, ACK : ${ack}`,
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

            console.log(
                `${getIndoTime()} [INBOX] Receive New Message Type : ${msgType} | from : ${await msg.from} | to : ${await msg.to}`,
            );

            if (msg.hasMedia) {
                //if (process.env.type == "INTERACTIVE") {
                const media = await msg.downloadMedia();

                // --- PERUBAHAN DI SINI ---
                // Tangkap msg.body sebagai caption
                let captionText = await msg.body;

                let dataMsg = {
                    id_msg: await msg.id.id,
                    type: "media",
                    from: await msg.from,
                    to: await msg.to, // Tambahkan 'to' agar sejajar dengan format text
                    caption: captionText, // Kirim caption ke webhook
                    content: media,
                };

                // Hilangkan validasi message !== "" karena media bisa dikirim tanpa caption
                sendWebHook(webHookURL, uuid, "INBOX_MESSAGE", "", dataMsg);
                //}
            } else {
                let message = await msg.body;
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
            sendWebHook(webHookURL, uuid, "INSTANCE", "DISCONNECT", {
                reason: reason,
            });

            // Hancurkan client terlebih dahulu
            if (client[uuid]) {
                await client[uuid]
                    .destroy()
                    .catch((e) =>
                        console.error(
                            `Error destroying client ${uuid}:`,
                            e.message,
                        ),
                    );
                delete client[uuid]; // Hapus dari objek global
            }
        });

        if (isOpen) {
            // Tambahkan try...catch di sini sebagai lapisan pertahanan kedua
            try {
                client[uuid].initialize();
            } catch (initError) {
                console.error(
                    `[!] Direct initialize call failed for ${uuid}:`,
                    initError,
                );
                reject(initError); // Pastikan promise di-reject jika ada error di sini
            }
        }
    });
};

// === Schedule Init / Restart via queue ===
async function scheduleInitialize(uuid) {
    restartQueue.add(async () => {
        console.log(`[QUEUE] Booting instance ${uuid}...`);
        try {
            await initialize(uuid, true); // `true` untuk langsung initialize
            console.log(
                `[QUEUE] Instance ${uuid} initialization process started.`,
            );
            await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (err) {
            // Log error dengan detail, tapi jangan biarkan aplikasi crash.
            console.error(
                `[QUEUE] FATAL ERROR during initialize for ${uuid}:`,
                err.message,
            );
            // Anda bisa menambahkan notifikasi webhook di sini jika perlu
            // sendWebHook(webHookURL, uuid, "INSTANCE", "INIT_FAILED");
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
            // Cek apakah client ada sebelum didestroy
            if (currentClient && typeof currentClient.destroy === "function") {
                await currentClient.destroy().catch((e) => {
                    console.error(
                        `[QUEUE] Error during destroy for ${uuid}:`,
                        e.message,
                    );
                });
                console.log(`[QUEUE] Client destroyed: ${uuid}`);
            }

            // Hapus referensi lama dari memory biar bersih
            delete client[uuid];

            // INI KUNCINYA: Tetap jalankan initialize walau client sebelumnya null
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
            return; // Hentikan pengecekan lebih lanjut untuk kasus ini
        }

        const state = await client[uuid].getState().catch(() => null);
        if (!state || state !== "CONNECTED") {
            console.log(
                `[HEALTH] ${uuid} is not connected (State: ${state}). Scheduling restart...`,
            );
            await _scheduleRestart(uuid);
        } else {
            //console.log(`[HEALTH] ${uuid} is healthy`);
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
        // Gunakan versi promise agar tidak blocking
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
