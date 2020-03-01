const _ = require("lodash");
const moment = require("moment");

const DistributionHistory = require("./DistributionHistory");

const walletSnapshotSchema = Schema({
  publicKey: {
    type: String,
    required: true
  },
  asset: {
    code: {
      type: String,
      required: true
    },
    issuer: {
      type: String,
      required: true
    }
  },
  serverUrl: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  userId: {
    type: String
  },
  balance: {
    type: Number,
    required: true,
    default: 0
  },
  createdAt: {
    type: Date,
    required: true
  },
  updatedAt: {
    type: Date,
    required: true
  }
});

const WalletSnapshot = new Model("WalletSnapshot", walletSnapshotSchema);

module.exports = WalletSnapshot;
