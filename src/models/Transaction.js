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

const Transaction = new Model("Transaction", transactionSchema);

module.exports = Transaction;
