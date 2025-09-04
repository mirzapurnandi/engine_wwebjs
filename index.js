require("dotenv").config();
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const db = require("./config/configSqlite.db");
const connectMongoose = require("./config/configMongoose.db");
connectMongoose();

const { client, initialize, healthCheck } = require("./WhatsAppWebInit");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
const routes = require("./routes/index.route");
app.use(routes);

// Buat table sessions jika belum ada
const CREATE_TABLE_SESSION = `
    CREATE TABLE IF NOT EXISTS sessions (
        id_instance TEXT PRIMARY KEY
    )
`;
db.run(CREATE_TABLE_SESSION, (error) => {
    if (error) {
        console.error("Error creating sessions table:", error);
    } else {
        console.log("Table sessions ready");
    }
});

// Load semua instance dari DB
const SELECT_ALL_SESSION = "SELECT * FROM sessions";
db.all(SELECT_ALL_SESSION, async (error, rows) => {
    if (error) {
        console.error("Error loading sessions:", error);
        return;
    }
    for (const row of rows) {
        await initialize(row.id_instance);
        console.log("[+] Init Instance From DB :", row.id_instance);
    }
});

// Health check loop (global, sekali saja)
setInterval(() => {
    Object.keys(client).forEach((id) => {
        healthCheck(id);
    });
}, 50 * 1000);

// Start server
const server = process.env.SERVER || "http://localhost";
app.listen(PORT, () => {
    console.log(`Server is running on ${server}:${PORT}`);
}).on("error", (err) => {
    console.error("Server error:", err);
});
