const functions = require("firebase-functions");
const admin = require("firebase-admin");

function getDistance(lat1, lon1, lat2, lon2) {
	var R = 6371; // Radius of the earth in km
	var dLat = deg2rad(lat2 - lat1); // deg2rad below
	var dLon = deg2rad(lon2 - lon1);
	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	var d = R * c; // Distance in km
	return d;
}

function deg2rad(deg) {
	return deg * (Math.PI / 180);
}

exports.cleanBusStops = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	const THRESHOLD_DISTANCE = 0.01; //km
	let newData = [];

	return new Promise(async (resolve, reject) => {
		//   Delete collection first to reset
		let deleteBatch = admin.firestore().batch();
		await admin
			.firestore()
			.collection("busStops")
			.listDocuments()
			.then(async (val) => {
				val.map((val) => {
					deleteBatch.delete(val);
				});
				await deleteBatch.commit();
			})
			.catch(reject);

		await admin
			.firestore()
			.collection("rawBusStops")
			.orderBy("ID", "asc")
			.get()
			.then(async (docs) => {
				// Collect all busStops
				let busStops = [];
				docs.forEach((doc) => {
					busStops.push(doc.data());
				});
				// Loop through each stop
				for (let i = 0; i < busStops.length; i++) {
					let isNewBusStop = true;
					// Check if distance between a pair of busStops are close
					for (let j = 0; j < newData.length; j++) {
						let distanceBetween = getDistance(busStops[i]?.Latitude, busStops[i]?.Longitude, newData[j]?.Latitude, newData[j]?.Longitude);
						if (distanceBetween <= THRESHOLD_DISTANCE) {
							// functions.logger.log(
							//   `${busStops[i].ID} | ${newData[j].ID} : ${distanceBetween}`
							// );
							isNewBusStop = false;
							let newCode = newData[j].Code;
							// If bus route never recorded, append it
							if (!newCode.includes(String(busStops[i].Code))) {
								newCode.push(busStops[i].Code.toString());
								newData[j].Code = newCode;
							}
							newData[j].altID.push(busStops[i]?.ID);
							busStops.splice(i, 1);
							i--;
						}
					}
					//If bus stop never recorded, append it
					if (isNewBusStop) {
						let data = {
							...busStops[i],
							Code: [busStops[i].Code.toString()],
							altID: [],
						};
						newData.push(data);
						busStops.splice(i, 1);
						i--;
					}
				}
				functions.logger.log("Creating busStops collection");
				functions.logger.info(newData, { structuredData: true });
				//Create new collection to add the clean version
				let batchPromises = [];
				newData.forEach((doc, index) => {
					batchPromises.push(admin.firestore().collection("busStops").doc(doc?.ID.toString()).set(doc));
				});
				await Promise.all(batchPromises);
				resolve({ success: true });
			})
			.catch(reject);
	});
});
