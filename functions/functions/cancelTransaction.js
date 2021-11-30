const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.cancelTransaction = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	const uid = context.auth.uid;
	const refNo = data.refNo;
	functions.logger.log({ uid, refNo });

	return await new Promise(async (resolve, reject) => {
		// Check if refNo is requested from user
		await admin
			.firestore()
			.collection("users")
			.doc(uid)
			.collection("transactionLogs")
			.doc(refNo)
			.get()
			.then((doc) => {
				if (!doc.exists) resolve({ success: false, errorMsg: "unauthorised to cancel the transaction" });
			});
		let data = { status: "cancelled", cancelledTime: new Date().toISOString(), pending: false };

		await admin
			.database()
			.ref("/transactionLogs/" + refNo)
			.update(data);

		functions.logger.log("Transaction Cancelled");
		resolve({ success: true, refNo });
	});
});
