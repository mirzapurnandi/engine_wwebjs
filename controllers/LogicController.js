const db = require("../config/configSqlite.db");
const {
    client,
    initialize,
    notifyDisconnect,
    deleteFolderSession,
    deleteFile,
    sendWebHook,
    _scheduleRestart,
} = require("../WhatsAppWebInit");

const { Buttons, List, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const path = require("path");

const crypto = require("crypto");

let dataClient = [];
const moment = require("moment-timezone");
function getIndoTime() {
    return moment().tz("Asia/Jakarta").format("dddd, D MMMM YYYY HH:mm:ss");
}

const quranData = [
    { nama: "Al-Fatihah", max_ayat: 7 },
    { nama: "Al-Baqarah", max_ayat: 286 },
    { nama: "Ali 'Imran", max_ayat: 200 },
    { nama: "An-Nisa'", max_ayat: 176 },
    { nama: "Al-Ma'idah", max_ayat: 120 },
    { nama: "Al-An'am", max_ayat: 165 },
    { nama: "Al-A'raf", max_ayat: 206 },
    { nama: "Al-Anfal", max_ayat: 75 },
    { nama: "At-Taubah", max_ayat: 129 },
    { nama: "Yunus", max_ayat: 109 },
    { nama: "Hud", max_ayat: 123 },
    { nama: "Yusuf", max_ayat: 111 },
    { nama: "Ar-Ra'd", max_ayat: 43 },
    { nama: "Ibrahim", max_ayat: 52 },
    { nama: "Al-Hijr", max_ayat: 99 },
    { nama: "An-Nahl", max_ayat: 128 },
    { nama: "Al-Isra'", max_ayat: 111 },
    { nama: "Al-Kahf", max_ayat: 110 },
    { nama: "Maryam", max_ayat: 98 },
    { nama: "Taha", max_ayat: 135 },
    { nama: "Al-Anbiya'", max_ayat: 112 },
    { nama: "Al-Hajj", max_ayat: 78 },
    { nama: "Al-Mu'minun", max_ayat: 118 },
    { nama: "An-Nur", max_ayat: 64 },
    { nama: "Al-Furqan", max_ayat: 77 },
    { nama: "Ash-Shu'ara'", max_ayat: 227 },
    { nama: "An-Naml", max_ayat: 93 },
    { nama: "Al-Qasas", max_ayat: 88 },
    { nama: "Al-'Ankabut", max_ayat: 69 },
    { nama: "Ar-Rum", max_ayat: 60 },
    { nama: "Luqman", max_ayat: 34 },
    { nama: "As-Sajdah", max_ayat: 30 },
    { nama: "Al-Ahzab", max_ayat: 73 },
    { nama: "Saba'", max_ayat: 54 },
    { nama: "Fatir", max_ayat: 45 },
    { nama: "Yasin", max_ayat: 83 },
    { nama: "As-Saffat", max_ayat: 182 },
    { nama: "Sad", max_ayat: 88 },
    { nama: "Az-Zumar", max_ayat: 75 },
    { nama: "Ghafir", max_ayat: 85 },
    { nama: "Fussilat", max_ayat: 54 },
    { nama: "Ash-Shura", max_ayat: 53 },
    { nama: "Az-Zukhruf", max_ayat: 89 },
    { nama: "Ad-Dukhan", max_ayat: 59 },
    { nama: "Al-Jathiyah", max_ayat: 37 },
    { nama: "Al-Ahqaf", max_ayat: 35 },
    { nama: "Muhammad", max_ayat: 38 },
    { nama: "Al-Fath", max_ayat: 29 },
    { nama: "Al-Hujurat", max_ayat: 18 },
    { nama: "Qaf", max_ayat: 45 },
    { nama: "Adh-Dhariyat", max_ayat: 60 },
    { nama: "At-Tur", max_ayat: 49 },
    { nama: "An-Najm", max_ayat: 62 },
    { nama: "Al-Qamar", max_ayat: 55 },
    { nama: "Ar-Rahman", max_ayat: 78 },
    { nama: "Al-Waqi'ah", max_ayat: 96 },
    { nama: "Al-Hadid", max_ayat: 29 },
    { nama: "Al-Mujadilah", max_ayat: 22 },
    { nama: "Al-Hashr", max_ayat: 24 },
    { nama: "Al-Mumtahanah", max_ayat: 13 },
    { nama: "As-Saff", max_ayat: 14 },
    { nama: "Al-Jumu'ah", max_ayat: 11 },
    { nama: "Al-Munafiqun", max_ayat: 11 },
    { nama: "At-Taghabun", max_ayat: 18 },
    { nama: "At-Talaq", max_ayat: 12 },
    { nama: "At-Tahrim", max_ayat: 12 },
    { nama: "Al-Mulk", max_ayat: 30 },
    { nama: "Al-Qalam", max_ayat: 52 },
    { nama: "Al-Haqqah", max_ayat: 52 },
    { nama: "Al-Ma'arij", max_ayat: 44 },
    { nama: "Nuh", max_ayat: 28 },
    { nama: "Al-Jinn", max_ayat: 28 },
    { nama: "Al-Muzzammil", max_ayat: 20 },
    { nama: "Al-Muddaththir", max_ayat: 56 },
    { nama: "Al-Qiyamah", max_ayat: 40 },
    { nama: "Al-Insan", max_ayat: 31 },
    { nama: "Al-Mursalat", max_ayat: 50 },
    { nama: "An-Naba'", max_ayat: 40 },
    { nama: "An-Nazi'at", max_ayat: 46 },
    { nama: "'Abasa", max_ayat: 42 },
    { nama: "At-Takwir", max_ayat: 29 },
    { nama: "Al-Infitar", max_ayat: 19 },
    { nama: "Al-Mutaffifin", max_ayat: 36 },
    { nama: "Al-Inshiqaq", max_ayat: 25 },
    { nama: "Al-Buruj", max_ayat: 22 },
    { nama: "At-Tariq", max_ayat: 17 },
    { nama: "Al-A'la", max_ayat: 19 },
    { nama: "Al-Ghashiyah", max_ayat: 26 },
    { nama: "Al-Fajr", max_ayat: 30 },
    { nama: "Al-Balad", max_ayat: 20 },
    { nama: "Ash-Shams", max_ayat: 15 },
    { nama: "Al-Lail", max_ayat: 21 },
    { nama: "Ad-Duha", max_ayat: 11 },
    { nama: "Ash-Sharh", max_ayat: 8 },
    { nama: "At-Tin", max_ayat: 8 },
    { nama: "Al-'Alaq", max_ayat: 19 },
    { nama: "Al-Qadr", max_ayat: 5 },
    { nama: "Al-Bayyinah", max_ayat: 8 },
    { nama: "Az-Zalzalah", max_ayat: 8 },
    { nama: "Al-'Adiyat", max_ayat: 11 },
    { nama: "Al-Qari'ah", max_ayat: 11 },
    { nama: "At-Takathur", max_ayat: 8 },
    { nama: "Al-'Asr", max_ayat: 3 },
    { nama: "Al-Humazah", max_ayat: 9 },
    { nama: "Al-Fil", max_ayat: 5 },
    { nama: "Quraysh", max_ayat: 4 },
    { nama: "Al-Ma'un", max_ayat: 7 },
    { nama: "Al-Kawthar", max_ayat: 3 },
    { nama: "Al-Kafirun", max_ayat: 6 },
    { nama: "An-Nasr", max_ayat: 3 },
    { nama: "Al-Masad", max_ayat: 5 },
    { nama: "Al-Ikhlas", max_ayat: 4 },
    { nama: "Al-Falaq", max_ayat: 5 },
    { nama: "An-Nas", max_ayat: 6 },
];

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

    async deleteSession(req, res) {
        const id_instance = req.params.id_instance;
        const DELETE_SESSION = "DELETE FROM sessions WHERE id_instance = ?";
        db.serialize(() => {
            db.run(DELETE_SESSION, [id_instance], (error) => {
                if (error) {
                    console.log(error);
                } else {
                    if (dataClient.includes(id_instance)) {
                        client[id_instance].destroy();
                        deleteFolderSession(id_instance);
                    }
                    console.log("[-] Delete Instance : " + id_instance);

                    res.status(200).json({
                        message: "Session deleted",
                        id_instance: id_instance,
                    });
                }
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
            const chatId = destination.includes("@")
                ? destination
                : `${destination}@c.us`;

            // --- PANGGIL FUNGSI CHECKING ---
            const check = await this.checkingDestination(
                currentClient,
                chatId,
                destination,
            );
            if (!check.status) {
                return res.status(check.code).json({
                    code: check.code,
                    details: check.details,
                    data: { destination: destination },
                });
            }

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
            console.log(error);

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
            const chatId = bodyData.destination.includes("@")
                ? bodyData.destination
                : `${bodyData.destination}@c.us`;

            let contentMSG = new MessageMedia(
                messageMedia.mimetype,
                messageMedia.data,
                bodyData.file_name,
            );

            const respMsg = await client[bodyData.id_instance].sendMessage(
                chatId,
                contentMSG,
                { caption: bodyData.caption },
            );

            const response = {
                code: 200,
                details: "Ok",
                data: {
                    id_instance: bodyData.id_instance,
                    destination: bodyData.destination,
                    destination_in_wa: chatId,
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
            minDelay = Math.min(minDelay, Math.floor(maxDelay * 0.7));
            if (minDelay < 1500) minDelay = 1500;
        } else {
            // tetap hormati batas delay kalau dikasih
            maxDelay = Math.min(maxDelay, (delay - 1) * 1000);
        }

        // Pastikan minDelay < maxDelay
        if (minDelay >= maxDelay) minDelay = Math.floor(maxDelay * 0.7);

        // Random di antara minDelay dan maxDelay
        const randomDelay =
            Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

        return { minDelay, maxDelay, randomDelay };
    };

    checkingDestination = async (currentClient, chatId, destination) => {
        if (chatId.endsWith("@lid")) {
            return {
                status: true,
                code: 200,
                details: "LID target detected, bypassing registration check.",
            };
        }

        // 1. Cek apakah nomor terdaftar di WhatsApp
        const isRegistered = await currentClient.isRegisteredUser(chatId);
        if (!isRegistered) {
            console.log(
                `[Validation] Danger: Number ${destination} is not registered.`,
            );
            return {
                status: false,
                code: 400,
                details: `Rejected: Number ${destination} is not registered on WhatsApp.`,
            };
        }

        // 2. Cek Foto Profil (Filter Akun Aktif)
        try {
            const profilePicUrl = await currentClient.getProfilePicUrl(chatId);
            if (!profilePicUrl) {
                console.log(
                    `[Validation] Warning: ${destination} has no profile picture.`,
                );
                // Jika ingin reject nomor tanpa foto, kembalikan status false di sini
            }
        } catch (e) {
            console.log(
                `[Validation] Profile pic fetch failed for ${destination}, continuing...`,
            );
        }

        return { status: true };
    };

    processSpintax = (text) => {
        if (!text) return "";
        // Mencari pola {kata1|kata2|kata3}
        const matches = text.match(/{[^{}]*}/g);
        if (!matches) return text;

        for (const match of matches) {
            // Menghapus kurung kurawal dan memisahkan kata berdasarkan pipa (|)
            const choices = match.slice(1, -1).split("|");
            // Pilih satu secara acak
            const randomChoice =
                choices[Math.floor(Math.random() * choices.length)];
            // Ganti bagian spintax dengan pilihan acak
            text = text.replace(match, randomChoice);
        }
        return text;
    };

    generateRandomQuranQuote = async () => {
        const templateAwalan =
            "{baca|lihat|simak|renungan|qs|surat|kutipan|catatan|referensi}";
        const awalanAcak = this.processSpintax(templateAwalan);

        const randomIndex = Math.floor(Math.random() * quranData.length);
        const selectedSurah = quranData[randomIndex];

        const nomorSurah = randomIndex + 1;

        const randomAyat =
            Math.floor(Math.random() * selectedSurah.max_ayat) + 1;

        const formatVariations = [
            `${awalanAcak}: (${nomorSurah}) ${selectedSurah.nama} ayat ${randomAyat}`, // Opsi 1
            `${awalanAcak}: ${selectedSurah.nama} (${nomorSurah}) ayat ${randomAyat}`, // Opsi 2
            `${awalanAcak}: ${selectedSurah.nama} ${nomorSurah}:${randomAyat}`, // Opsi 3
            `${awalanAcak}: QS. ${selectedSurah.nama} [${nomorSurah}:${randomAyat}]`, // Variasi tambahan
            `${awalanAcak} - ${selectedSurah.nama} ${nomorSurah}:${randomAyat}`, // Mengganti titik dua dengan strip
        ];

        const randomFormat =
            formatVariations[
                Math.floor(Math.random() * formatVariations.length)
            ];
        return randomFormat;
    };

    sendMessageWithTyping = async (req, res) => {
        const bodyData = req.body;
        const idTransaction = bodyData.id_transaction || null;

        try {
            // const chatId = `${bodyData.destination}@c.us`;
            const chatId = bodyData.destination.includes("@")
                ? bodyData.destination
                : `${bodyData.destination}@c.us`;
            const instanceId = bodyData.id_instance;

            // Step 1: Pastikan instance aktif
            const currentClient = client[instanceId];
            if (!currentClient) {
                return res.status(404).json({
                    code: 404,
                    details: "Instance not found",
                    data: { id_transaction: idTransaction },
                });
            }

            // --- PANGGIL FUNGSI CHECKING ---
            const check = await this.checkingDestination(
                currentClient,
                chatId,
                bodyData.destination,
            );
            if (!check.status) {
                return res.status(check.code).json({
                    code: check.code,
                    details: check.details,
                    data: {
                        destination: bodyData.destination,
                        id_transaction: idTransaction,
                    },
                });
            }

            if (bodyData.delay == "BYPASS") {
                return res.status(200).json({
                    code: 200,
                    details: "successfully checking data",
                    data: {
                        id_instance: instanceId,
                        destination: bodyData.destination,
                        destination_in_wa: chatId,
                        id_message: null,
                        id_transaction: idTransaction,
                        delay: null,
                    },
                });
            }

            const isWarmup =
                idTransaction && String(idTransaction).startsWith("WARMUP");
            // let spintaxFooter = "{code|uniq|rand|log}:";

            let finalMessage = bodyData.message;
            if (!isWarmup) {
                let spintaxFooter = bodyData.footer_msg || "";
                let spintaxHeader = !bodyData.header_msg
                    ? ""
                    : this.processSpintax(bodyData.header_msg) + "\n\n";

                if (spintaxFooter === "NONE" && spintaxHeader === "") {
                    finalMessage = bodyData.message;
                } else {
                    const footerUnik = await this.generateRandomQuranQuote();
                    const randomFooter = this.processSpintax(spintaxFooter);
                    finalMessage = `${spintaxHeader}${bodyData.message}\n\n${randomFooter}\n${footerUnik}`;
                }
            }
            // const kodeUnik = crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 9);

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

            // ========================================================
            // Fake Typing di Background (Tidak menahan response)
            // ========================================================
            (async () => {
                try {
                    // Mulai simulasi mengetik lagi
                    await chat.sendStateTyping();

                    // Random waktu antara 7000ms (7 detik) s/d 10000ms (10 detik)
                    const fakeTypingDelay =
                        Math.floor(Math.random() * (10000 - 7000 + 1)) + 7000;

                    // Jeda selama waktu random tersebut
                    await new Promise((resolve) =>
                        setTimeout(resolve, fakeTypingDelay),
                    );

                    // Hentikan status mengetik
                    await chat.clearState();
                } catch (fakeErr) {
                    // Tangkap error diam-diam (misal jika tiba-tiba instance putus saat fake typing berjalan)
                    console.error(
                        `[FAKE TYPING ERROR] on ${chatId}:`,
                        fakeErr.message,
                    );
                }
            })();
            // ========================================================

            const response = {
                code: 200,
                details: "Message sent with typing simulation",
                data: {
                    id_instance: instanceId,
                    destination: bodyData.destination,
                    destination_in_wa: chatId,
                    id_message: respMsg.id.id,
                    id_transaction: idTransaction,
                    delay: randomDelay,
                },
            };
            res.status(200).json(response);
        } catch (error) {
            console.error(
                `[CRITICAL ERROR] ${bodyData.id_instance} during transaction ${idTransaction}:`,
                error.message,
            );

            // Identifikasi apakah error disebabkan oleh koneksi mati/banned
            const isDisconnected =
                error.message.includes("Session closed") ||
                error.message.includes("not opened") ||
                error.message.includes("Protocol error") ||
                error.message.includes("properties of undefined") ||
                error.message.includes("Page crashed");

            if (isDisconnected) {
                // Beritahu Server Utama bahwa TRANSAKSI INI GAGAL karena akun bermasalah
                sendWebHook(
                    process.env.HOST_WEBHOOK,
                    bodyData.id_instance,
                    "TRANSACTION_FAILED",
                    "BANNED_OR_DISCONNECT",
                    {
                        id_transaction: idTransaction,
                        error_detail: error.message,
                    },
                );

                // Trigger pembersihan instance karena sudah tidak berguna
                deleteFolderSession(bodyData.id_instance);
            }

            res.status(500).json({
                code: 500,
                details: "Failed to send message",
                id_transaction: idTransaction,
                error: error.message,
            });
        }
    };

    /* sendMediaWithTyping = async (req, res) => {
        const bodyData = req.body;
        const idTransaction = bodyData.id_transaction || null;
        const chatId = bodyData.destination.includes("@")
            ? bodyData.destination
            : `${bodyData.destination}@c.us`;
        const instanceId = bodyData.id_instance;

        try {
            const currentClient = client[instanceId];
            if (!currentClient) {
                return res.status(404).json({
                    code: 404,
                    details: "Instance not found",
                    data: {
                        id_transaction: idTransaction,
                    },
                });
            }

            // --- PANGGIL FUNGSI CHECKING ---
            const check = await this.checkingDestination(
                currentClient,
                chatId,
                bodyData.destination,
            );
            if (!check.status) {
                return res.status(check.code).json({
                    code: check.code,
                    details: check.details,
                    data: {
                        destination: bodyData.destination,
                        id_transaction: idTransaction,
                    },
                });
            }

            if (bodyData.delay == "BYPASS") {
                return res.status(200).json({
                    code: 200,
                    details: "successfully checking data",
                    data: {
                        id_instance: instanceId,
                        destination: bodyData.destination,
                        destination_in_wa: chatId,
                        id_message: null,
                        id_transaction: idTransaction,
                        delay: null,
                    },
                });
            }

            const spintaxFooter =
                "{Balas|Respon|Tolong balas} pesan ini {agar|supaya} {saling berinteraksi|akun tetap aktif|terjalin komunikasi} dan {menjaga|memastikan} akun ini {tetap aktif|tidak terblokir|aman}. {code|uniq|rand|log}:";

            const randomFooter = this.processSpintax(spintaxFooter);

            const kodeUnik = crypto
                .randomBytes(16) // Naikkan sedikit bytes-nya agar slice 21 selalu terpenuhi
                .toString("base64")
                .replace(/[^a-zA-Z0-9]/g, "")
                .slice(0, 21);

            const finalCaption = `${bodyData.message}\n\n${randomFooter}${kodeUnik}`;

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
            const fileName = `wasend_id ${kodeUnik}`;
            let messageMedia;
            try {
                messageMedia = await MessageMedia.fromUrl(bodyData.file_url, {
                    unsafeMime: true,
                    reqOptions: { timeout: 20000 },
                });
            } catch (error) {
                throw new Error(
                    "Failed to download media: " + mediaErr.message,
                );
            }

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
                    id_transaction: idTransaction,
                    delay: randomDelay,
                },
            });
        } catch (error) {
            console.error(
                `[MEDIA ERROR] TransID ${idTransaction}:`,
                error.message,
            );

            // Identifikasi apakah error disebabkan oleh koneksi mati/banned
            const isDisconnected =
                error.message.includes("Session closed") ||
                error.message.includes("not opened") ||
                error.message.includes("Protocol error") ||
                error.message.includes("properties of undefined") ||
                error.message.includes("Page crashed");

            if (isDisconnected) {
                // Beritahu Server Utama bahwa TRANSAKSI INI GAGAL karena akun bermasalah
                sendWebHook(
                    process.env.HOST_WEBHOOK,
                    bodyData.id_instance,
                    "TRANSACTION_FAILED",
                    "BANNED_OR_DISCONNECT",
                    {
                        id_transaction: idTransaction,
                        error_detail: error.message,
                    },
                );

                // Trigger pembersihan instance karena sudah tidak berguna
                deleteFolderSession(bodyData.id_instance);
            }

            return res.status(500).json({
                code: 500,
                details: "Failed to send media",
                data: {
                    id_transaction: idTransaction,
                    error: error.message,
                },
            });
        }
    }; */

    sendMediaWithTyping = async (req, res) => {
        const bodyData = req.body;
        const idTransaction = bodyData.id_transaction || null;
        const chatId = bodyData.destination.includes("@")
            ? bodyData.destination
            : `${bodyData.destination}@c.us`;
        const instanceId = bodyData.id_instance;

        try {
            const currentClient = client[instanceId];
            if (!currentClient) {
                return res.status(404).json({
                    code: 404,
                    details: "Instance not found",
                    data: {
                        id_transaction: idTransaction,
                    },
                });
            }

            // --- PANGGIL FUNGSI CHECKING ---
            const check = await this.checkingDestination(
                currentClient,
                chatId,
                bodyData.destination,
            );
            if (!check.status) {
                return res.status(check.code).json({
                    code: check.code,
                    details: check.details,
                    data: {
                        destination: bodyData.destination,
                        id_transaction: idTransaction,
                    },
                });
            }

            if (bodyData.delay == "BYPASS") {
                return res.status(200).json({
                    code: 200,
                    details: "successfully checking data",
                    data: {
                        id_instance: instanceId,
                        destination: bodyData.destination,
                        destination_in_wa: chatId,
                        id_message: null,
                        id_transaction: idTransaction,
                        delay: null,
                    },
                });
            }

            // --- MANAJEMEN CAPTION & FOOTER ---
            const isWarmup =
                idTransaction && String(idTransaction).startsWith("WARMUP");
            //let spintaxFooter = "{code|uniq|rand|log}:";
            //let spintaxHeader = "";

            let finalMessage = bodyData.message;
            // Hanya tambahkan Footer unik jika ini BUKAN pesan Warmup
            if (!isWarmup) {
                let spintaxFooter = bodyData.footer_msg || "";

                let spintaxHeader = !bodyData.header_msg
                    ? ""
                    : this.processSpintax(bodyData.header_msg) + "\n\n";

                if (spintaxFooter === "NONE" && spintaxHeader === "") {
                    finalMessage = bodyData.message;
                } else {
                    const randomFooter = this.processSpintax(spintaxFooter);
                    const footerUnik = await this.generateRandomQuranQuote();
                    finalMessage = `${spintaxHeader}${bodyData.message}\n\n${randomFooter}\n${footerUnik}`;
                }
            }
            // const kodeUnik = crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 9);

            // --- SIMULASI TYPING ---
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

            // --- MANAJEMEN MEDIA (BASE64 vs URL) ---
            let contentMSG;
            try {
                if (bodyData.base64_data) {
                    // 1. CARA BARU: Menggunakan Base64 (Dari Warmup Server)
                    const mimetype = bodyData.mimetype || "image/jpeg";
                    const filename = bodyData.filename || "media_warmup.jpg";
                    contentMSG = new MessageMedia(
                        mimetype,
                        bodyData.base64_data,
                        filename,
                    );
                } else if (bodyData.file_url) {
                    // 2. CARA LAMA: Menggunakan URL (Dari Blast Server)
                    const kodeUnikFile = crypto.randomBytes(6).toString("hex");
                    const fileName = `wasend_id_${kodeUnikFile}`;

                    const messageMedia = await MessageMedia.fromUrl(
                        bodyData.file_url,
                        {
                            unsafeMime: true,
                            reqOptions: { timeout: 20000 },
                        },
                    );
                    contentMSG = new MessageMedia(
                        messageMedia.mimetype,
                        messageMedia.data,
                        fileName,
                    );
                } else {
                    throw new Error(
                        "Payload media kosong (base64_data atau file_url tidak ditemukan)",
                    );
                }
            } catch (mediaErr) {
                throw new Error("Failed to process media: " + mediaErr.message);
            }

            // --- KIRIM PESAN ---
            const respMsg = await currentClient.sendMessage(
                chatId,
                contentMSG,
                {
                    caption: finalMessage,
                    waitUntilMsgSent: true,
                },
            );

            // --- CLEAR TYPING ---
            await chat.clearState();

            // ========================================================
            // Fake Typing di Background (Tidak menahan response)
            // ========================================================
            (async () => {
                try {
                    // Mulai simulasi mengetik lagi
                    await chat.sendStateTyping();

                    // Random waktu antara 7000ms (7 detik) s/d 10000ms (10 detik)
                    const fakeTypingDelay =
                        Math.floor(Math.random() * (10000 - 7000 + 1)) + 7000;

                    // Jeda selama waktu random tersebut
                    await new Promise((resolve) =>
                        setTimeout(resolve, fakeTypingDelay),
                    );

                    // Hentikan status mengetik
                    await chat.clearState();
                } catch (fakeErr) {
                    // Tangkap error diam-diam (misal jika tiba-tiba instance putus saat fake typing berjalan)
                    console.error(
                        `[FAKE TYPING ERROR] on ${chatId}:`,
                        fakeErr.message,
                    );
                }
            })();
            // ========================================================

            return res.status(200).json({
                code: 200,
                details: "Media sent with typing simulation",
                data: {
                    id_instance: instanceId,
                    destination: bodyData.destination,
                    destination_in_wa: chatId,
                    id_message: respMsg.id.id,
                    id_transaction: idTransaction,
                    delay: randomDelay,
                },
            });
        } catch (error) {
            console.error(
                `[MEDIA ERROR] TransID ${idTransaction}:`,
                error.message,
            );

            // Identifikasi apakah error disebabkan oleh koneksi mati/banned
            const isDisconnected =
                error.message.includes("Session closed") ||
                error.message.includes("not opened") ||
                error.message.includes("Protocol error") ||
                error.message.includes("properties of undefined") ||
                error.message.includes("Page crashed");

            if (isDisconnected) {
                // Beritahu Server Utama bahwa TRANSAKSI INI GAGAL karena akun bermasalah
                sendWebHook(
                    process.env.HOST_WEBHOOK,
                    bodyData.id_instance,
                    "TRANSACTION_FAILED",
                    "BANNED_OR_DISCONNECT",
                    {
                        id_transaction: idTransaction,
                        error_detail: error.message,
                    },
                );

                // Trigger pembersihan instance karena sudah tidak berguna
                // Pastikan fungsi deleteFolderSession tersedia atau diimport
                if (typeof deleteFolderSession === "function") {
                    deleteFolderSession(bodyData.id_instance);
                }
            }

            return res.status(500).json({
                code: 500,
                details: "Failed to send media",
                data: {
                    id_transaction: idTransaction,
                    error: error.message,
                },
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

    instanceRedeploy = async (req, res) => {
        const bodyData = req.body;
        try {
            if (!client[bodyData.id_instance]) {
                res.status(400).send({
                    code: 400,
                    details: "Instance tidak ditemukan",
                    data: [],
                });
            } else {
                await client[bodyData.id_instance].destroy();
                const state = "DISCONNECT";
                sendWebHook(
                    process.env.HOST_WEBHOOK,
                    bodyData.id_instance,
                    "INSTANCE",
                    state,
                );

                deleteFolderSession(bodyData.id_instance);
                deleteFile(
                    __dirname + "/qr/qr_" + bodyData.id_instance + ".png",
                );

                res.status(200).send({
                    code: 200,
                    details: "Ok",
                    data: [],
                });
            }
        } catch (error) {
            console.log(error);

            res.status(500).send({
                code: 500,
                details: "Internal Server Error!",
                data: error,
            });
        }
    };

    instanceRefresh = async (req, res) => {
        const idInstance = req.body.id_instance;
        try {
            console.log(
                `${getIndoTime()} [+] Processing Refresh WA Page, Instance ID : ${idInstance}`,
            );

            const state = "DISCONNECT";
            sendWebHook(
                process.env.HOST_WEBHOOK,
                idInstance,
                "INSTANCE",
                state,
            );

            dataClient.push(idInstance);
            await _scheduleRestart(idInstance);

            res.status(200).send({
                code: 200,
                details: "Processing",
                data: [],
            });
        } catch (e) {
            res.status(500).send({
                code: 500,
                details: "Internal Server Error",
                data: e,
            });
        }
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

    forceInstanceRestart = async (req, res) => {
        const { id_instance } = req.body;

        if (!id_instance) {
            return res.status(400).json({
                code: 400,
                details: "Bad Request: id_instance is required.",
            });
        }

        console.log(
            `${getIndoTime()} [FORCE-RESET] Permintaan restart keras untuk: ${id_instance}`,
        );

        try {
            const currentClient = client[id_instance];

            // Step 1: Bersihkan instance lama jika ada di memori
            if (currentClient) {
                console.log(
                    `[FORCE-RESET] Mencoba mematikan proses browser ${id_instance}...`,
                );
                try {
                    // --- PERBAIKAN 1: Hentikan listener agar tidak ada proses tertinggal yang memicu crash ---
                    currentClient.removeAllListeners();

                    // Jangan tunggu selamanya, jika 10 detik tidak mati, anggap saja hang
                    await Promise.race([
                        currentClient.destroy(),
                        new Promise((_, reject) =>
                            setTimeout(
                                () => reject(new Error("Browser Hang/Timeout")),
                                10000,
                            ),
                        ),
                    ]);
                } catch (e) {
                    console.error(
                        `[FORCE-RESET] Gagal destroy halus untuk ${id_instance}: ${e.message}`,
                    );
                }

                // Hapus referensi agar Garbage Collector membersihkan RAM
                delete client[id_instance];
            }

            // Step 2: Hapus file QR lama agar tidak membingungkan
            const qrPath = path.join(__dirname, `../qr/qr_${id_instance}.png`);
            if (fs.existsSync(qrPath)) {
                fs.unlinkSync(qrPath);
            }

            // Step 3: Trigger inisialisasi ulang (Non-Blocking)
            // --- PERBAIKAN 3: Bungkus dengan jeda 3 detik untuk mencegah tabrakan port/cache ---
            setTimeout(() => {
                console.log(
                    `[FORCE-RESET] Memulai inisialisasi ulang untuk ${id_instance}...`,
                );
                initialize(id_instance, true).catch((err) => {
                    console.error(
                        `[FORCE-RESET] Gagal inisialisasi ulang async untuk ${id_instance}:`,
                        err.message,
                    );
                });
            }, 3000);

            sendWebHook(
                process.env.HOST_WEBHOOK,
                id_instance,
                "INSTANCE",
                "RESTARTING",
            );

            res.status(200).json({
                code: 200,
                details:
                    "Accepted: Instance sedang di-restart keras di background.",
                data: {
                    id_instance,
                    status: "RESTARTING_CLEAN",
                },
            });
        } catch (error) {
            console.error(`[FORCE-RESET] Error kritis:`, error);
            res.status(500).json({
                code: 500,
                details: "Gagal melakukan force restart.",
                error: error.message,
            });
        }
    };
}

module.exports = LogicController;
