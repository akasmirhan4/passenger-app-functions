const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.cancelTransaction = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	const uid = context.auth.uid;
	const { transactionID } = data;
	functions.logger.log({ uid, transactionID });

	return await new Promise(async (resolve, reject) => {
		let data = { status: "cancelled", cancelledTime: admin.firestore.FieldValue.serverTimestamp(), pending: false };

		await admin
			.firestore()
			.collection("transactionLogs")
			.doc(transactionID)
			.update(data)
			.catch((e) => {
				functions.logger.error(e);
				reject(e);
			});
		functions.logger.log("Transaction Cancelled");
		resolve({ success: true, transactionID });
	});
});
