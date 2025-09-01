// config/configMongoDB.js
const mongoose = require("mongoose");

const connectMongoose = async () => {
    const uri =
        process.env.MONGODB_URI || "mongodb://localhost:27017/db_engine";
    try {
        const conn = await mongoose.connect(uri);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectMongoose;
