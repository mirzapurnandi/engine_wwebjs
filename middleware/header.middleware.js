function checkHeader(req, res, next) {
    const AUTH_TOKEN = process.env.AUTH_TOKEN || "PuRn4nD1990";
    if (req.headers["x-purnand-token"] !== AUTH_TOKEN) {
        return res.status(401).json({ error: "Auth Headers Unauthorized" });
    }
    next();
}

module.exports = checkHeader;