const { MongoClient } = require("mongodb");

class MongoDBConnection {
    constructor() {
        this.url =
            process.env.MONGODB_URI || "mongodb://localhost:27017/db_engine";
        this.dbName = "engine";
        this.client = new MongoClient(this.url);

        this.db = null; // Properti untuk menyimpan referensi database
    }

    async connect() {
        // Cek apakah topologi klien sudah terhubung
        if (!this.client.topology || !this.client.topology.isConnected()) {
            try {
                await this.client.connect();
                this.db = this.client.db(this.dbName);
                console.log(`MongoDB connected to database: ${this.dbName}`);
            } catch (error) {
                console.error("MongoDB connection error:", error);
                throw error;
            }
        }
        return this.db;
    }

    getCollection(collectionName) {
        if (!this.db) {
            throw new Error(
                "Database connection is not initialized. Call connect() first."
            );
        }
        return this.db.collection(collectionName);
    }

    async close() {
        try {
            await this.client.close();
            console.log("MongoDB connection closed.");
        } catch (error) {
            console.error("Error closing MongoDB connection:", error);
        }
    }
}

module.exports = new MongoDBConnection();
