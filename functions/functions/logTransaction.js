const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.logTransaction = functions.region("asia-southeast1").https.onRequest(async (request, response) => {
	let result = request.body.response.body;
	let batchProcess = [];
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
			let uid = "";
			let mode = "";
			await admin
				.database()
				.ref("/transactionLogs/" + refNo)
				.get()
				.then((result) => {
					if (!result.exists) response.send("refNo does not exist");
					uid = result.toJSON().uid;
				});
			await admin
				.database()
				.ref(`/transactionLogs/${refNo}/desc/descMsg`)
				.get()
				.then((result) => {
					if (!result.exists) response.send("descMsg does not exist");
					functions.logger.log(result.toJSON())
					mode = result.toJSON();
				});
			if (!uid) response.send("uid not recorded");

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
	batchProcess.push(
		admin
			.database()
			.ref("/transactionLogs/" + refNo)
			.update(data)
	);
	await Promise.all(batchProcess)
		.then((results) => {
			functions.logger.log("Transaction logged");
		})
		.catch((error) => {
			functions.logger.error("Error in transactions");
			functions.logger.error(error);
		});
	response.send(resultInfo.resultMsg);
});
