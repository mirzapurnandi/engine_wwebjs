//express router
const express = require("express");
const router = express.Router();

const LogicController = require("../controllers/LogicController");
const logicController = new LogicController();

const checkHeader = require("../middleware/header.middleware");

router.get("/", checkHeader, logicController.getAllSession);
router.post("/", checkHeader, logicController.createSession);
router.delete("/:id_instance", checkHeader, logicController.deleteSession);

router.get("/qr", checkHeader, logicController.getQr);
router.post("/send-message", checkHeader, logicController.sendMessage);
router.post("/send-media", checkHeader, logicController.sendMedia);
router.post(
    "/send-message-typing",
    checkHeader,
    logicController.sendMessageWithTyping
);

router.get("/screenshot", checkHeader, logicController.getScreenshot);
router.post(
    "/instance-redeploy",
    checkHeader,
    logicController.instanceRedeploy
);
router.post("/instance-refresh", checkHeader, logicController.instanceRefresh);
router.post("/status", checkHeader, logicController.getStatus);

module.exports = router;
