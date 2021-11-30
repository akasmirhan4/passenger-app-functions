const functions = require("firebase-functions");
const admin = require("firebase-admin");
exports.payByWallet = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	functions.logger.log({ data });
	const ticketAmount = data.ticketAmount ? Number(data.ticketAmount) : null;
	const { desc } = data;
	const uid = context.auth.uid;

	if (!ticketAmount) return { success: false, errorMsg: "ticketAmount invalid" };

	if (!desc) return { success: false, errorMsg: "no desc" };

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

	if (walletAmount < ticketAmount) return { success: false, errorMsg: "insufficient fund" };

	let currentDate = new Date();
	let refNo = currentDate.getTime().toString() + "0";

	const logData = {
		refNo,
		trans_amount: ticketAmount,
		dateAdded: currentDate.toISOString(),
		status: "paid",
		desc,
		pending: false,
		uid: uid,
	};

	functions.logger.log({ logData });

	let transactionComplete = false;
	await Promise.all([
		admin
			.firestore()
			.collection("users")
			.doc(uid)
			.update({ walletAmount: walletAmount - ticketAmount }),
		admin
			.database()
			.ref("/transactionLogs/" + refNo)
			.update(logData),
		admin.firestore().collection("users").doc(uid).collection("transactionLogs").doc(refNo).set({ refNo }),
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
