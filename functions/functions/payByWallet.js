const functions = require("firebase-functions");
const admin = require("firebase-admin");
exports.payByWallet = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	functions.logger.log({ data });
	const transactionAmount = data.transactionAmount ? Number(data.transactionAmount) : null;
	const { description } = data;
	const uid = context.auth.uid;

	if (!transactionAmount) return { success: false, errorMsg: "transactionAmount invalid" };

	if (!description) return { success: false, errorMsg: "no description" };

	if (!uid) return { success: false, errorMsg: "Missing User ID" };

	const walletAmount = await admin
		.firestore()
		.collection("users")
		.doc(uid)
		.get()
		.then((doc) => {
			if (!doc.exists) return;
			return doc.data().walletAmount ?? 0;
		});

	if (walletAmount === null) return { success: false, errorMsg: "Missing User Document" };

	if (walletAmount < transactionAmount) return { success: false, errorMsg: "insufficient fund" };

	const newTransactionRef = admin.firestore().collection("transactionLogs").doc();
	let transactionID = newTransactionRef.id;

	const logData = {
		transactionID,
		transactionAmount,
		dateAdded: admin.firestore.FieldValue.serverTimestamp(),
		status: "paid",
		description,
		pending: false,
		uid: uid,
		userRef: admin.firestore().collection("users").doc(uid),
	};

	functions.logger.log({ logData });

	let transactionComplete = false;
	await Promise.all([
		admin
			.firestore()
			.collection("users")
			.doc(uid)
			.update({ walletAmount: walletAmount - transactionAmount }),
		admin.firestore().collection("transactionLogs").doc(transactionID).set(logData),
		admin.firestore().collection("users").doc(uid).collection("transactionLogs").doc(transactionID).set({ ref: newTransactionRef }),
	])
		.then((results) => {
			functions.logger.log(results);
			transactionComplete = true;
		})
		.catch((errors) => {
			functions.logger.error(errors);
		});

	if (transactionComplete) return { success: true, logData };
});
