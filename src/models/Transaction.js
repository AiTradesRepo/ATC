const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const transactionSchema = new Schema(
  {
    userId: {
      type: String
    },
    type: {
      type: String,
      required: true
    },
    order: {
      type: "ObjectId",
      ref: "Order"
    },
    extra: {
      type: "Mixed"
    }
  },
  {
    timestamps: {}
  }
);

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
