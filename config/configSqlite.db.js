const sqlite3 = require('sqlite3').verbose();
const database = 'db/database.db';
const db = new sqlite3.Database(database);

module.exports = db;