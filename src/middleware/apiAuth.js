const jwt = require("jsonwebtoken");
const ApiUser = require("../models/ApiUser");

const apiAuth = async (req, res, next) => {
  try {
    const token = req.header("Authorization").replace("Bearer ", "");
    const data = jwt.verify(token, process.env.JWT_KEY);

    const user = await ApiUser.findOne({
      _id: data._id,
      "tokens.token": token
    });
    if (!user) {
      throw new Error();
    }
    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    res.status(401).send({ error: "Not authorized to access this resource" });
  }
};

module.exports = apiAuth;
