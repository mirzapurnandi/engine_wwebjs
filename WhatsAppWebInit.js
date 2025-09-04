const fs = require("fs");
require("dotenv").config({ quiet: true });
const {
    Client,
    Buttons,
    List,
    MessageMedia,
    LegacySessionAuth,
    LocalAuth,
    RemoteAuth,
} = require("whatsapp-web.js");
const qrPlugin = require("qrcode");
let dateTime = new Date();
let indoTime = dateTime.toLocaleString("id-ID", {
    weekday: "long", // hari
    year: "numeric",
    month: "long", // bulan lengkap
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false, // 24 jam
});
const axios = require("axios");
const { MongoStore } = require("wwebjs-mongo");
require("./config/configMongoose.db");
const mongoose = require("mongoose");

var emitter = require("events").EventEmitter;
var eventLocal = new emitter();

let client = {};
var webHookURL = process.env.HOST_WEBHOOK;
var authToken = process.env.AUTH_TOKEN;
var autoStartInstance = false;
MONGODB_URI = process.env.MONGODB_URI;

const initialize = async (uuid, isOpen = false) => {
    /* let authType = new LocalAuth({ clientId: uuid });
    const puppeteerOptions = {
        qrTimeoutMs: 60000, //Timeout for qr code selector in puppeteer
        authStrategy: authType,
        puppeteer: {
            headless: true, //for not show engine activity in window
            args: [
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--unhandled-rejections=strict",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
            ],
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36",
        },
    };
    client[uuid] = new Client(puppeteerOptions); */

    await mongoose.connect(MONGODB_URI);
    const store = new MongoStore({ mongoose: mongoose });
    client[uuid] = new Client({
        puppeteer: {
            headless: true,
            // executablePath: "/usr/bin/chromium-browser",
            executablePath: "/usr/bin/google-chrome",
            // args: ["--no-sandbox", "--disable-setuid-sandbox"],

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-features=VizDisplayCompositor",
                // "--single-process",
                "--no-zygote",
                "--renderer-process-limit=1",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-breakpad",
                "--disable-client-side-phishing-detection",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-domain-reliability",
                "--disable-extensions",
                "--disable-hang-monitor",
                "--disable-ipc-flooding-protection",
                "--disable-notifications",
                "--disable-offer-store-unmasked-wallet-cards",
                "--disable-popup-blocking",
                "--disable-prompt-on-repost",
                "--disable-renderer-backgrounding",
                "--disable-sync",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
                "--mute-audio",
                "--no-crash-upload",
                "--no-pings",
                "--password-store=basic",
                "--use-gl=swiftshader",
                "--use-mock-keychain",
                "--disable-software-rasterizer",
            ],
        },
        authStrategy: new RemoteAuth({
            clientId: uuid,
            store: store,
            backupSyncIntervalMs: 1000 * 60 * 60 * 1,
        }),
    });

    client[uuid].on("qr", (qr) => {
        // NOTE: This event will not be fired if a session is specified.
        qrPlugin.toDataURL(qr, (err, src) => {
            var base64Data = src.replace(/^data:image\/png;base64,/, "");
            fs.writeFile(
                __dirname + "/qr/qr_" + uuid + ".png",
                base64Data,
                "base64",
                function (err) {
                    console.log(indoTime + " [+] Generate New QR : " + uuid);
                }
            );
        });
    });

    client[uuid].on("authenticated", (session) => {
        sessionData = session;
        console.log(indoTime + ` [+] Saved Auth Session`);

        const state = "SUCCESS_CREATE_INSTANCE";
        sendWebHook(webHookURL, uuid, "INSTANCE", state);

        eventLocal.emit(uuid, "ACTIVE");
    });

    client[uuid].on("auth_failure", async (msg) => {
        // Fired if session restore was unsuccessful
        console.log(indoTime + " [+] auth_failure", msg);

        const state = "AUTH_FAILURE";
        sendWebHook(webHookURL, uuid, "INSTANCE", state);

        await client[uuid].destroy();
        deleteFolderSession(uuid);
        await client[uuid].initialize();
        console.error("AUTHENTICATION FAILURE", msg);
    });

    client[uuid].on("ready", async () => {
        console.log(indoTime + " [+] Client Is Active : ", uuid);

        deleteFile(__dirname + "/qr/qr_" + uuid + ".png"); //delete file

        const state = "READY";
        sendWebHook(webHookURL, uuid, "INSTANCE", state);
        setOnline(uuid);
    });

    client[uuid].on("message", async (msg) => {
        let msgType = "text";
        if (msg.hasMedia) {
            msgType = "media";
        }
        //console.log(dateTime + " [INBOX] Receive New Message Type : " + msgType);
        console.log(
            indoTime +
                " [INBOX] Receive New Message Type : " +
                msgType +
                "| from : " +
                (await msg.from) +
                " | to : " +
                (await msg.to)
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

    client[uuid].on("message_ack", (msg, ack) => {
        console.log(
            indoTime + " [+] DLR : " + uuid + ", ID : " + msg.id.id,
            ", ACK : " + ack
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

    client[uuid].on("change_state", (state) => {
        console.log("CHANGE STATE", state);
    });

    client[uuid].on("disconnected", (reason) => {
        console.log(
            indoTime + " [+] Client " + uuid + " is disconnect",
            reason
        );

        const state = "DISCONNECT";
        sendWebHook(webHookURL, uuid, "INSTANCE", state);

        client[uuid].destroy();
        deleteFolderSWCache(uuid);
        //deleteFile(__dirname + `/sessions/session_${uuid}.json`);
        //deleteFolderSession(uuid)
    });

    if (isOpen) {
        client[uuid].initialize();
    }
};

const deleteFolderSession = async (number) => {
    try {
        fs.rm(
            `${__dirname}/.wwebjs_auth/RemoteAuth-${number}`,
            { recursive: true },
            (err) => {
                if (err) {
                    console.error(err);
                } else {
                    console.log(
                        `[+] ${indoTime} Deleted Session Folder : ${number}`
                    );
                }
            }
        );

        const collectionChunks = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${number}.chunks`
        );
        await collectionChunks.drop();

        const collectionFiles = mongoose.connection.collection(
            `whatsapp-RemoteAuth-${number}.files`
        );
        await collectionFiles.drop();
    } catch (e) {
        console.log(indoTime + "[+] Error DeleteFolderSession");
    }
};

function setOnline(idInstance) {
    //set online
    client[`${idInstance}`].sendPresenceAvailable().catch((err) => {
        console.log(indoTime + "[+] Error Set Online : " + idInstance);
        //console.log(err);
        notifyDisconnect(idInstance); //send notify
    });
}

function notifyDisconnect(idInstance) {
    const state = "DISCONNECT";
    sendWebHook(webHookURL, idInstance, "INSTANCE", state);
}

function deleteFile(path) {
    fs.unlink(path, (err) => {
        if (err) {
            return true;
        }
    });
}

function deleteFolderSWCache(idInstance) {
    try {
        fs.rm(
            __dirname +
                "/.wwebjs_auth/RemoteAuth-" +
                idInstance +
                "/Default/Service Worker/ScriptCache",
            { recursive: true },
            (err) => {
                if (err) {
                    console.error(err);
                    console.log(
                        "[+] Failed Deleted Session SWCache Folder : " +
                            idInstance
                    );
                } else {
                    console.log(
                        "[+] Success Deleted Session SWCache Folder : " +
                            idInstance
                    );
                }
            }
        );
    } catch (e) {
        console.log(indoTime + "[+] Error deleteFolderSWCache");
        // console.log(e);
    }
}

async function sendWebHook(url, idInstance, type, state = null, data = {}) {
    await axios
        .post(
            url,
            {
                id_instance: idInstance,
                type: type,
                state: state,
                data: data,
                timeout: 120000, //120 second
            },
            {
                headers: {
                    "x-purnand-token": authToken,
                },
            }
        )
        .then((resp) => {
            console.log(indoTime + "[+] Send WebHook Success : " + type);
        })
        .catch((err) => {
            console.log(indoTime + "[+] Error SendWebHook : " + type);
        });
}

async function healthCheck(id) {
    try {
        const instance = client[id];
        if (!instance) {
            console.log(`[!] No client found for ${id}, initializing...`);
            // initialize(id);
            return;
        }

        let state;
        try {
            state = await instance.getState();
        } catch (e) {
            state = null;
        }

        if (!state || state === "DISCONNECTED") {
            console.log(
                `[!] ${id} not responding (state: ${state}), reinitializing...`
            );
            try {
                await instance.destroy().catch(() => {}); // ignore error jika browser sudah null
            } catch (e) {
                console.log(`[!] Error destroying client ${id}`, e);
            }
            initialize(id); // bikin ulang instance
        }
    } catch (e) {
        console.log(`[!] Error in healthCheck for ${id}`, e);

        try {
            if (client[id]) {
                await client[id].destroy().catch(() => {});
            }
        } catch (destroyErr) {
            console.log(`[!] Error destroying client ${id}`, destroyErr);
        }

        initInstance(id);
    }
}

/* async function healthCheck(id) {
    try {
        const state = await client[id].getState();
        if (!state || state === "DISCONNECTED") {
            console.log(`[!] ${id} not responding, reinitializing...`);
            client[id].destroy();
            client[id].initialize();
        }
    } catch (e) {
        console.log(`[!] Error checking state for ${id}`, e);
        client[id].destroy();
        client[id].initialize();
    }
} */

module.exports = {
    client,
    initialize,
    notifyDisconnect,
    deleteFolderSession,
    deleteFolderSWCache,
    deleteFile,
    sendWebHook,
    healthCheck,
};
