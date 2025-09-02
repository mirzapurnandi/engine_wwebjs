require("dotenv").config();
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const db = require("./config/configSqlite.db");
const connectMongoose = require("./config/configMongoose.db");
const { initialize } = require("./WhatsAppWebInit");

// Connect MongoDB
connectMongoose();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

db.serialize(async () => {
    //routes
    const routes = require("./routes/index.route");
    app.use(routes);

    // Buat table untuk daftar instance
    const CREATE_TABLE_SESSION =
        "CREATE TABLE IF NOT EXISTS sessions (id_instance TEXT)";
    db.run(CREATE_TABLE_SESSION, (error) => {
        if (error) {
            console.log(error);
        } else {
            console.log("Table sessions ready ✅");
        }
    });

    //load all data dari sqlite dan auto init
    db.all("SELECT * FROM sessions", async (error, rows) => {
        if (error) {
            console.error("Error load sessions:", error);
            return;
        }
        for (const row of rows) {
            await initialize(row.id_instance, true); // auto start
            console.log("[+] Init Instance From DB:", row.id_instance);
        }
    });

    const server = process.env.SERVER || "http://localhost";
    app.listen(PORT, () => {
        console.log(`🚀 Server is running on ${server}:${PORT}`);
    }).on("error", (err) => {
        console.log(err);
    });
});
