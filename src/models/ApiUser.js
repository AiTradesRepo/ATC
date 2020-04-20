const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const apiUserSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      minLength: 7
    },

    tokens: [
      {
        token: {
          type: String,
          required: true
        }
      }
    ]
  },
  {
    timestamps: {},
    toJSON: {
      getters: true
    },
    toObject: {
      getters: true
    }
  }
);

apiUserSchema.pre("save", async function(next) {
  const apiUser = this;
  if (apiUser.isModified("password")) {
    apiUser.password = await bcrypt.hash(apiUser.password, 8);
  }

  next();
});

apiUserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.tokens;

  return user;
};

apiUserSchema.methods.generateAuthToken = async function() {
  const apiUser = this;
  const token = jwt.sign({ _id: apiUser._id }, process.env.JWT_KEY);
  apiUser.tokens = apiUser.tokens.concat({ token });
  await apiUser.save();
  return token;
};

apiUserSchema.statics.findByCredentials = async (username, password) => {
  const apiUser = await ApiUser.findOne({ username });
  if (!apiUser) {
    throw new Error({ error: "Invalid login credentials" });
  }
  const isPasswordMatch = await bcrypt.compare(password, apiUser.password);
  if (!isPasswordMatch) {
    throw new Error({ error: "Invalid login credentials" });
  }
  return apiUser;
};

const ApiUser = mongoose.model("ApiUser", apiUserSchema);

module.exports = ApiUser;
