const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.getRouteBusStopsDetails = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	return new Promise(async (resolve, reject) => {
		// Collect all necessary data
		const { routeCode } = data;
		if (!routeCode) resolve({ success: false, errorMsg: "Missing routeCode query" });

		let busStops = [];
		let routeDetails = null;
		await admin
			.firestore()
			.collection("routes")
			.doc(String(routeCode))
			.get()
			.then((result) => {
				functions.logger.log("Successfully connect to routes document: ", routeCode);
				if (!result.exists) {
					resolve({ success: false, errorMsg: "No result from routes collection" });
				} else {
					routeDetails = result.data();
					busStops = result.data().bus_stops;
				}
			})
			.catch((error) => {
				resolve({ success: false, errorMsg: error });
			});
		functions.logger.log(busStops);
		const batchPromises = busStops.map((busStop) => admin.firestore().collection("busStops").doc(String(busStop)).get());

		await Promise.all(batchPromises)
			.then((results) => {
				let busStopsDetails = [];
				results.forEach((result, index) => {
					if (!result.exists) {
						resolve({ success: false, errorMsg: `No result from busStops collection with busStop #${busStops[index]}` });
					} else {
						functions.logger.log("Successfully connect to all busStops document");
						busStopsDetails.push(result.data());
					}
				});
				resolve({ success: true, busStopsDetails, routeDetails });
			})
			.catch((error) => {
				resolve({ success: false, errorMsg: error });
			});
	});
});
