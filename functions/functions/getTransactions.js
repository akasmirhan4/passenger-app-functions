const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.getTransactions = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	const uid = context.auth.uid;
	functions.logger.log("user uid: ", uid);
	return await new Promise(async (resolve, reject) => {
		// Get all refNos from users collection
		await admin
			.firestore()
			.collection("users")
			.doc(uid)
			.collection("transactionLogs")
			.get()
			.then((docs) => {
				if (docs.empty) {
					resolve([]);
				} else {
					let transactionIds = [];
					docs.forEach((doc) => {
						transactionIds.push(doc.id);
					});
					functions.logger.log(transactionIds);
					return transactionIds;
				}
			})
			// Use refNos to batch get from database
			.then(async (transactionIds) => {
				let batchPromises = [];
				transactionIds.forEach((id) => {
					batchPromises.push(
						admin
							.database()
							.ref("/transactionLogs/" + id)
							.get()
							.then((data) => data.toJSON())
					);
				});
				resolve(await Promise.all(batchPromises));
			})
			.catch(reject);
	});
});
