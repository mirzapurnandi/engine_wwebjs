const fs = require("fs").promises;
const { rm } = require("fs"); // untuk callback-based
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
                "--single-process", // Mungkin membantu mengurangi memori, tapi uji dampaknya
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

            // Hancurkan client terlebih dahulu
            if (client[uuid]) {
                await client[uuid]
                    .destroy()
                    .catch((e) =>
                        console.error(
                            `Error destroying client ${uuid}:`,
                            e.message
                        )
                    );
                delete client[uuid]; // Hapus dari objek global
            }

            // Hapus cache service worker saja, jangan seluruh sesi kecuali auth gagal
            deleteFolderSWCache(uuid);

            // Pertimbangkan untuk tidak otomatis restart di sini, biarkan healthCheck yang menanganinya
            // agar tidak terjadi restart beruntun jika ada masalah jaringan.
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
    // Cek jika sudah ada di antrian atau sedang berjalan
    if (restartQueue.pending > 0 || restartQueue.size > 0) {
        const isQueued = [...restartQueue.iterator()].some(
            (item) => item.id === uuid
        );
        if (isQueued) {
            console.log(
                `[QUEUE] Restart for ${uuid} is already queued. Skipping.`
            );
            return;
        }
    }

    if (!client[uuid] || client[uuid].isRefreshing) return; // Pemeriksaan ganda
    client[uuid].isRefreshing = true;

    sendWebHook(webHookURL, uuid, "INSTANCE", "RESTARTING");

    restartQueue.add(
        async () => {
            console.log(`[QUEUE] Restarting instance ${uuid}...`);
            try {
                // Hancurkan client lama sebelum inisialisasi baru
                if (client[uuid]) {
                    await client[uuid]
                        .destroy()
                        .catch((e) =>
                            console.log(
                                `Error destroying client ${uuid}: ${e.message}`
                            )
                        );
                }
                console.log(`[QUEUE] Client destroyed: ${uuid}`);

                // Inisialisasi ulang
                await initialize(uuid, true);
                console.log(`[QUEUE] Client restarted: ${uuid}`);
            } catch (err) {
                console.log(`[QUEUE] Restart failed for ${uuid}:`, err.message);
            } finally {
                // Pastikan instance masih ada sebelum mengakses propertinya
                if (client[uuid]) {
                    client[uuid].isRefreshing = false;
                }
            }
        },
        { id: uuid }
    ); // Tambahkan id unik ke task queue
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
        // Gunakan versi promise agar tidak blocking
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

        // Gunakan Promise.all untuk menjalankan penghapusan di DB secara paralel
        await Promise.all([
            chunks.drop().catch(() => {}),
            files.drop().catch(() => {}),
        ]);

        console.log(`[+] Session data deleted for ${uuid}`);
    } catch (e) {
        console.log("[!] Error deleteFolderSession:", uuid, e.message);
    }
}

function deleteFolderSWCache(uuid) {
    // Gunakan callback-based rm yang non-blocking
    const path = `${__dirname}/.wwebjs_auth/RemoteAuth-${uuid}/Default/Service Worker/ScriptCache`;
    rm(path, { recursive: true, force: true }, (err) => {
        if (err && err.code !== "ENOENT") {
            // Jangan log error jika folder tidak ada
            console.error(
                `[!] Failed to delete SW Cache for ${uuid}:`,
                err.message
            );
        }
    });
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
