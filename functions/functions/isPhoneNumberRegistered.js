const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.isPhoneNumberRegistered = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	functions.logger.log("getUserByPhoneNumber called");
	return await new Promise(async (resolve, reject) => {
		await admin
			.auth()
			.getUserByPhoneNumber(data.phoneNo)
			.then((userRecord) => {
				functions.logger.log(userRecord);
				resolve({ userExist: true });
			})
			.catch((error) => {
				if (error.errorInfo.code == "auth/user-not-found") {
					functions.logger.log("user does not exist");
					resolve({ userExist: false });
				} else {
					functions.logger.error("unknown error", error.errorInfo);
					reject(error);
				}
			});
	});
});
