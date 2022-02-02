const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.logTransaction = functions.region("asia-southeast1").https.onRequest(async (request, response) => {
	let result = request.body.response.body;
	functions.logger.log("function called");
	let resultInfo = result.resultInfo;
	let refNo = result.refNo;
	functions.logger.log(request.body.response);
	functions.logger.log("Logging Transaction");
	let status = "undefined";
	switch (resultInfo.resultCode) {
		case "502":
			status = "declined";
			break;
		case "503":
			status = "expired";
			break;
		case "504":
			status = "pending (error)";
			break;
		case "500":
			status = "requested (error)";
			break;
		case "501":
			status = "paid";
			let data = null;
			await admin
				.firestore()
				.collection("transactionLogs")
				.doc(refNo)
				.get()
				.then((doc) => {
					data = doc.data();
				});

			const uid = data.uid;
			const mode = data.description.mode;

			if (!uid) response.send("uid not recorded");
			if (!mode) response.send("mode not recorded");

			let walletAmount = 0;
			await admin
				.firestore()
				.collection("users")
				.doc(uid)
				.get()
				.then((res) => {
					if (!res.exists) response.send("user does not exist");
					walletAmount = res.data().walletAmount ? Number(res.data().walletAmount) : 0;
				});
			if (mode == "topup") {
				walletAmount += Number(result.trans_amount);
			} else if (mode == "purchasing ride") {
				walletAmount -= Number(result.trans_amount);
			} else {
				functions.logger.error("Unknown mode ", mode);
			}
			await admin.firestore().collection("users").doc(uid).update({ walletAmount });
			break;
		case "509":
		default:
			status = "unknown code";
			break;
	}
	let data = { ...result, respTime: request.body.response.header.respTime, pending: false, status };
	functions.logger.log(data);
	await admin
		.firestore()
		.collection("transactionLogs")
		.doc(refNo)
		.update(data)
		.then((results) => {
			functions.logger.log("Transaction logged");
		})
		.catch((error) => {
			functions.logger.error("Error in transactions");
			functions.logger.error(error);
		});
	response.send(resultInfo.resultMsg);
});
