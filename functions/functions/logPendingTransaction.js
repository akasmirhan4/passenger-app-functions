const functions = require("firebase-functions");
const admin = require("firebase-admin");
exports.logPendingTransaction = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	return new Promise(async (resolve, reject) => {
		await admin
			.database()
			.ref("/transactionLogs/" + data.refNo)
			.update(data)
			.then((result) => {
				functions.logger.log("Transaction logged");
				resolve({ ...data, logged: true });
			})
			.catch((error) => {
				functions.logger.warn("Error logging transaction");
				functions.logger.error(error);
				reject(error);
			});
	});
});
