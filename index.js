require("dotenv").config();
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

const db = require("./config/configSqlite.db");
const connectMongoose = require("./config/configMongoose.db");
connectMongoose();
const { initialize } = require("./WhatsAppWebInit");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

db.serialize(async () => {
    //routes
    const routes = require("./routes/index.route");
    app.use(routes);

    const CREATE_TABLE_SESSION =
        "CREATE TABLE IF NOT EXISTS sessions (id_instance TEXT)";
    const SELECT_ALL_SESSION = "SELECT * FROM sessions";
    db.run(CREATE_TABLE_SESSION, (error) => {
        if (error) {
            console.log(error);
        } else {
            console.log("Table sessions created");
        }
    });
    db.on("open", () => {
        console.log("Connected to the database");
    });

    //load all data from database
    db.all(SELECT_ALL_SESSION, async (error, rows) => {
        rows.forEach((row, i) => {
            //const session = new Client(row.id_instance);
            Promise.all([initialize(row.id_instance)]);
            console.log("[+] Init Instance From DB : " + row.id_instance);
        });
    });

    const server = process.env.SERVER || "http://localhost";
    app.listen(PORT, () => {
        console.log(`Server is running on ${server}:${PORT}`);
    }).on("error", (err) => {
        console.log(err);
    });
});
