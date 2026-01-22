const db = require("../config/configSqlite.db");
const {
    client,
    initialize,
    notifyDisconnect,
    deleteFolderSession,
    deleteFile,
    deleteFolderSWCache,
    sendWebHook,
    _scheduleRestart,
} = require("../WhatsAppWebInit-edit");

const { Buttons, List, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");

const crypto = require("crypto");

var emitter = require("events").EventEmitter;
var eventLocal = new emitter();

let dataClient = [];
const moment = require("moment-timezone");
function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

class LogicController {
    constructor() {
        this.dataClient = dataClient;
    }

    getAllSession = (req, res) => {
        const SELECT_ALL_SESSION = "SELECT * FROM sessions";
        db.all(SELECT_ALL_SESSION, (err, rows) => {
            if (err) {
                res.status(500).json({
                    message: "Internal server error",
                });
            } else {
                let data = [];
                rows.forEach((row, i) => {
                    data[i] = row.id_instance;
                });
                res.status(200).json({
                    message: "Success",
                    data: data,
                });
            }
        });
    };

    createSession(req, res) {
        const id = req.body.id_instance;

        db.serialize(async () => {
            db.run("INSERT INTO sessions VALUES (?)", [id], async (error) => {
                if (error) {
                    console.log(error);
                } else {
                    initialize(id);
                    console.log("[+] Init Instance : " + id);
                    res.status(201).json({
                        message: "Session created",
                        id_instance: id,
                    });
                }
            });
        });
    }

    // DELETE SESSION: Menghapus dari DB saat user menghapus instance lewat API
    async deleteSession(req, res) {
        const id_instance = req.params.id_instance;
        const DELETE_SESSION = "DELETE FROM sessions WHERE id_instance = ?";

        // Hapus dari SQLite
        db.run(DELETE_SESSION, [id_instance], async (error) => {
            if (error) {
                console.log(error);
                return res.status(500).json({ message: "DB Error" });
            }

            // Lakukan pembersihan total
            console.log("[-] Delete Instance Requested : " + id_instance);

            // Hancurkan client
            if (client[id_instance]) {
                await client[id_instance].destroy().catch(() => {});
                delete client[id_instance];
            }

            // Hapus file fisik dan Mongo
            await deleteFolderSession(id_instance);
            deleteFolderSWCache(id_instance);
            deleteFile(__dirname + "/qr/qr_" + id_instance + ".png");

            res.status(200).json({
                message: "Session deleted permanently",
                id_instance: id_instance,
            });
        });
    }

    sendMessage = async (req, res) => {
        const { id_instance, destination, message } = req.body;
        const currentClient = client[id_instance];

        if (
            !currentClient ||
            (await currentClient.getState()) !== "CONNECTED"
        ) {
            return res.status(400).json({
                code: 400,
                details: "Instance not connected or not found.",
                data: null,
            });
        }

        try {
            const chatId = `${destination}@c.us`;
            const respMsg = await currentClient.sendMessage(chatId, message);

            const response = {
                code: 200,
                details: "Ok",
                data: {
                    id_instance,
                    destination,
                    id_message: respMsg.id.id,
                },
            };
            res.status(200).json(response);
        } catch (error) {
            console.error(
                `[sendMessage] Error for ${id_instance}:`,
                error.message,
            );
            const response = {
                code: 500,
                details: "Failed to send message.",
                // Kirim pesan error yang lebih informatif untuk debugging
                data: { error: error.message },
            };
            res.status(500).json(response);
        }
    };

    sendMedia = async (req, res) => {
        const bodyData = req.body;

        try {
            const messageMedia = await MessageMedia.fromUrl(bodyData.file_url);

            let contentMSG = new MessageMedia(
                messageMedia.mimetype,
                messageMedia.data,
                bodyData.file_name,
            );

            const respMsg = await client[bodyData.id_instance].sendMessage(
                `${bodyData.destination}@c.us`,
                contentMSG,
                { caption: bodyData.caption },
            );

            const response = {
                code: 200,
                details: "Ok",
                data: {
                    id_instance: bodyData.id_instance,
                    destination: bodyData.destination,
                    destination_in_wa: `${bodyData.destination}@c.us`,
                    id_message: respMsg.id.id,
                },
            };
            res.status(200).json(response);
        } catch (error) {
            const response = {
                code: 500,
                details: "Instance Not Available",
                data: error,
            };
            res.status(500).json(response);
        }
    };

    // Hitung delay natural
    getHumanDelay = async (message, delay) => {
        const msgLength = message.length;

        // Kecepatan mengetik manusia 250–350 ms per karakter
        const typingPerChar = Math.floor(Math.random() * (350 - 250 + 1)) + 250;
        const typingTime = msgLength * typingPerChar;

        // minDelay & maxDelay natural
        let minDelay = Math.max(1500, Math.floor(typingTime * 0.7));
        let maxDelay = Math.floor(typingTime * 1.3);

        // Jika panjang pesan > delay → pakai aturan limit
        if (msgLength > delay) {
            maxDelay = (delay - 1) * 1000;
            minDelay = Math.min(minDelay, maxDelay - 500); // tetap lebih kecil
            if (minDelay < 1500) minDelay = 1500;
        } else {
            // tetap hormati batas delay kalau dikasih
            maxDelay = Math.min(maxDelay, (delay - 1) * 1000);
        }

        // Pastikan minDelay < maxDelay
        if (minDelay >= maxDelay) minDelay = maxDelay - 500;

        // Random di antara minDelay dan maxDelay
        const randomDelay =
            Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

        return { minDelay, maxDelay, randomDelay };
    };

    sendMessageWithTyping = async (req, res) => {
        const bodyData = req.body;

        try {
            const chatId = `${bodyData.destination}@c.us`;
            const instanceId = bodyData.id_instance;

            // Step 1: Pastikan instance aktif
            const currentClient = client[instanceId];
            if (!currentClient) {
                return res.status(404).json({
                    code: 404,
                    details: "Instance not found",
                    data: [],
                });
            }

            const kodeUnik = crypto
                .randomBytes(6)
                .toString("base64")
                .replace(/[^a-zA-Z0-9]/g, "")
                .slice(0, 21);

            // const finalMessage = `${bodyData.message}\n${kodeUnik}`;
            const finalMessage = bodyData.message;

            // Step 2: Ambil chat dan tampilkan status mengetik
            const chat = await currentClient.getChatById(chatId);
            await chat.sendStateTyping(); // Menunjukkan status mengetik

            const { minDelay, maxDelay, randomDelay } =
                await this.getHumanDelay(bodyData.message, bodyData.delay);

            console.log("Typing simulation: ", {
                minDelay,
                maxDelay,
                randomDelay,
            });
            await new Promise((resolve) => setTimeout(resolve, randomDelay));

            // Step 3: Kirim pesan
            const respMsg = await currentClient.sendMessage(
                chatId,
                finalMessage,
                { waitUntilMsgSent: true },
            );

            // Step 4: Hentikan status mengetik
            await chat.clearState();

            const response = {
                code: 200,
                details: "Message sent with typing simulation",
                data: {
                    id_instance: instanceId,
                    destination: bodyData.destination,
                    destination_in_wa: chatId,
                    id_message: respMsg.id.id,
                    delay: randomDelay,
                },
            };
            res.status(200).json(response);
        } catch (error) {
            console.error(
                `[CRITICAL ERROR] ${bodyData.id_instance} during transaction ${bodyData.id_transaction}:`,
                error.message,
            );

            // Identifikasi apakah error disebabkan oleh koneksi mati/banned
            const isDisconnected =
                error.message.includes("Session closed") ||
                error.message.includes("not opened") ||
                error.message.includes("Protocol error");

            if (isDisconnected) {
                // Beritahu Server Utama bahwa TRANSAKSI INI GAGAL karena akun bermasalah
                sendWebHook(
                    process.env.HOST_WEBHOOK,
                    bodyData.id_instance,
                    "TRANSACTION_FAILED",
                    "BANNED_OR_DISCONNECT",
                    {
                        id_transaction: bodyData.id_transaction,
                        error_detail: error.message,
                    },
                );

                // Trigger pembersihan instance karena sudah tidak berguna
                deleteFolderSession(bodyData.id_instance);
            }

            res.status(500).json({
                code: 500,
                details: "Failed to send message",
                id_transaction: id_transaction,
                error: error.message,
            });

            res.status(500).json({
                code: 500,
                details: "Failed to send message",
                data: error,
            });
        }
    };

    sendMediaWithTyping = async (req, res) => {
        const bodyData = req.body;

        try {
            const chatId = `${bodyData.destination}@c.us`;
            const instanceId = bodyData.id_instance;

            const currentClient = client[instanceId];
            if (!currentClient) {
                return res.status(404).json({
                    code: 404,
                    details: "Instance not found",
                    data: [],
                });
            }

            // Step 1: Generate kode unik
            const kodeUnik = crypto
                .randomBytes(6)
                .toString("base64")
                .replace(/[^a-zA-Z0-9]/g, "")
                .slice(0, 21);

            // const finalCaption = `${bodyData.message}\n${kodeUnik}`;
            const finalCaption = bodyData.message;

            // Step 2: Simulasi typing
            const chat = await currentClient.getChatById(chatId);
            await chat.sendStateTyping();

            const { minDelay, maxDelay, randomDelay } =
                await this.getHumanDelay(bodyData.message, bodyData.delay);

            console.log("Media Typing simulation: ", {
                minDelay,
                maxDelay,
                randomDelay,
            });

            await new Promise((resolve) => setTimeout(resolve, randomDelay));

            // Step 3: Ambil media dari URL (setelah delay)
            const fileName = `wasend id ${kodeUnik}`;
            const messageMedia = await MessageMedia.fromUrl(bodyData.file_url, {
                unsafeMime: true,
                timeout: 20000,
            });

            const contentMSG = new MessageMedia(
                messageMedia.mimetype,
                messageMedia.data,
                fileName,
            );

            // Step 4: Kirim media
            const respMsg = await currentClient.sendMessage(
                chatId,
                contentMSG,
                {
                    caption: finalCaption,
                    waitUntilMsgSent: true,
                },
            );

            // Step 5: stop typing state
            await chat.clearState();

            return res.status(200).json({
                code: 200,
                details: "Media sent with typing simulation",
                data: {
                    id_instance: instanceId,
                    destination: bodyData.destination,
                    destination_in_wa: chatId,
                    id_message: respMsg.id.id,
                    delay: randomDelay,
                },
            });
        } catch (error) {
            console.log(error);
            return res.status(500).json({
                code: 500,
                details: "Failed to send media",
                data: error,
            });
        }
    };

    getQr = async (req, res) => {
        const bodyData = req.query;
        try {
            let qrPathFile = path.join(
                __dirname,
                `../qr/qr_${bodyData.id_instance}.png`,
            );
            /* __dirname;
            if (fs.existsSync(qrPathFile)) {
                await res.sendFile(qrPathFile);
            } else {
                res.status(404).send({
                    code: 404,
                    details: "QR Not Found",
                    data: [],
                });
            } */
            fs.readFile(qrPathFile, (err, data) => {
                if (err) {
                    res.status(404).send({
                        code: 404,
                        details: "Image not found",
                        data: [],
                    });
                } else {
                    const base64Image = Buffer.from(data).toString("base64");
                    const mimeType = "image/png";
                    // const imageSrc = `data:${mimeType};base64,${base64Image}`;
                    const imageSrc = `<img src='data:${mimeType};base64,${base64Image}'/>`;
                    res.status(200).send(imageSrc);
                }
            });
        } catch (error) {
            const response = {
                code: 500,
                details: "Instance Not Available",
                data: error,
            };
            res.status(500).json(response);
        }
    };

    getScreenshot = async (req, res) => {
        const bodyData = req.query;

        try {
            console.log(
                `${getIndoTime()} [+] Screenshot : ${bodyData.id_instance}`,
            );

            try {
                let screenshot =
                    await client[bodyData.id_instance].pupPage.screenshot();
                const b64 = Buffer.from(screenshot).toString("base64");
                const mimeType = "image/png";
                await res.send(`<img src="data:${mimeType};base64,${b64}" />`);
            } catch (e) {
                res.status(400).send({
                    code: 400,
                    details: "Internal Server Error",
                    data: e,
                });
            }
        } catch (e) {
            res.status(500).send({
                code: 500,
                details: "Internal Server Error",
                data: e,
            });
        }
    };

    // REDEPLOY: Hapus sesi total dan minta scan QR baru (Reset)
    instanceRedeploy = async (req, res) => {
        const bodyData = req.body;
        const id_instance = bodyData.id_instance;

        console.log(
            `${getIndoTime()} [API] Redeploy/Reset Request: ${id_instance}`,
        );

        res.status(200).json({
            code: 200,
            details: "Redeploy request accepted. Session will be cleared.",
            data: { id_instance },
        });

        // forceClean = true (Hapus DB & File, minta QR baru)
        await _scheduleRestart(id_instance, true);
    };

    // REFRESH: Restart tapi coba pertahankan sesi (hanya refresh browser)
    instanceRefresh = async (req, res) => {
        const { id_instance } = req.body;

        console.log(`${getIndoTime()} [API] Refresh Request: ${id_instance}`);

        // Kirim response dulu agar tidak timeout
        res.status(200).json({
            code: 200,
            details: "Refresh request accepted. Processing in background.",
            data: { id_instance },
        });

        // Panggil fungsi restart aman.
        // forceClean = false (jangan logout, cuma restart browser)
        await _scheduleRestart(id_instance, false);
    };

    getStatus = async (req, res) => {
        const { id_instance } = req.body;
        const currentClient = client[id_instance];

        if (!currentClient) {
            return res.status(404).json({
                code: 404,
                details: "Instance not found",
                data: null,
            });
        }

        try {
            const state = await currentClient.getState();
            const info = currentClient.info || null;

            res.status(200).json({
                code: 200,
                details: "Ok",
                data: { state, info },
            });
            sendWebHook(
                process.env.HOST_WEBHOOK,
                id_instance,
                "INSTANCE",
                state,
            );
            console.log(
                `${getIndoTime()} [+] GET INSTANCE STATUS : ${id_instance}, STATE : ${state}`,
            );
        } catch (error) {
            console.error(
                `[getStatus] Error for ${id_instance}:`,
                error.message,
            );
            res.status(500).json({
                code: 500,
                details: "Failed to get instance state.",
                data: { error: error.message },
            });
            notifyDisconnect(id_instance); // Notifikasi jika ada error saat cek status
        }
    };

    // FORCE RESTART: Sama seperti Refresh, tapi eksplisit
    forceInstanceRestart = async (req, res) => {
        const { id_instance } = req.body;

        console.log(
            `${getIndoTime()} [API] Force Restart Request: ${id_instance}`,
        );

        res.status(200).json({
            code: 200,
            details: "Force restart executing...",
            data: { id_instance },
        });

        await _scheduleRestart(id_instance, false);
    };
}

module.exports = LogicController;
