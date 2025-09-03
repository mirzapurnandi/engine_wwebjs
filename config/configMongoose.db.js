const mongoose = require("mongoose");

const connectMongoose = async () => {
    const uri =
        process.env.MONGODB_URI || "mongodb://localhost:27017/db_engine";
    try {
        await mongoose.connect(uri);
        console.log("MongoDB Connected ✅:", uri);
        return mongoose; // penting → return instance mongoose
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectMongoose;
