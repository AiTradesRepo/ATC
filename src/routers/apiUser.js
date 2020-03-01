const express = require("express");

const ApiUser = require("../models/ApiUser");
const apiAuth = require("../middleware/apiAuth");

const router = express.Router();

router.post("/api-users/login", async (req, res) => {
  //Login a registered user
  try {
    const { username, password } = req.body;
    const user = await ApiUser.findByCredentials(username, password);
    if (!user) {
      return res
        .status(401)
        .send({ error: "Login failed! Check authentication credentials" });
    }
    const token = await user.generateAuthToken();
    res.send({ user, token });
  } catch (error) {
    res.status(400).send(error);
  }
});

router.get("/api-users/me", apiAuth, async (req, res) => {
  // View logged in user profile
  res.send(req.user);
});

router.post("/api-users/me/logout", apiAuth, async (req, res) => {
  // Log user out of the application
  try {
    req.user.tokens = req.user.tokens.filter(token => {
      return token.token != req.token;
    });
    await req.user.save();
    res.send();
  } catch (error) {
    res.status(500).send(error);
  }
});

router.post("/api-users/me/logoutall", apiAuth, async (req, res) => {
  // Log user out of all devices
  try {
    req.user.tokens.splice(0, req.user.tokens.length);
    await req.user.save();
    res.send();
  } catch (error) {
    res.status(500).send(error);
  }
});

module.exports = router;
