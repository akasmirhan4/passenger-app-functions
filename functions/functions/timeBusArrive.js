const functions = require("firebase-functions");
const admin = require("firebase-admin");

exports.timeBusArrive = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	let { busStopID, routeCode, timeStamp, routeDetails = null } = data || {};
	timeStamp = new Date(timeStamp);
	functions.logger.log({ busStopID, routeCode, timeStamp, routeDetails });
	//get route details
	if (!routeDetails) {
		routeDetails = (await admin.firestore().collection("routes").doc(routeCode).get()).data();
	}
	// Get Index of busStopID in route exist in routeCode
	const busStopIndex = routeDetails.bus_stops.findIndex((_busStopID) => _busStopID == busStopID);
	if (busStopIndex < 0) {
		console.error(`${busStopID} does not exist in route ${routeCode}`);
		return { status: "NO_BUS_IN_ROUTE" };
	}
	// simulate the route to find estimated timeArrival for each busStop
	const busArrivalDetails = await simulateRoute(routeCode, null, routeDetails);
	const detail = busArrivalDetails.find((detail) => detail.ID == busStopID);
	const addedTimeArrived = detail.timeArrived;

	if (!routeDetails.schedule) return { status: "NO_SCHEDULE" };
	const timeArrivedArray = routeDetails.schedule.map((timeString) => {
		const timeComp = timeString.split(":");
		return new Date(new Date().setHours(timeComp[0], 0, timeComp[1] + addedTimeArrived));
	});

	functions.logger.log(timeArrivedArray);
	functions.logger.log(timeStamp);
	const i = timeArrivedArray.findIndex((time) => timeStamp < time) - 1;
	functions.logger.log(i);
	functions.logger.log(timeArrivedArray[i]);
	if (timeArrivedArray[i]) {
		return { value: timeArrivedArray[i] - timeStamp, dateTime: timeArrivedArray[i], status: "SUCCESS" };
	} else {
		return { status: "NO_RESULTS" };
	}
});

async function simulateRoute(routeCode = "01A", STOP_DURATION = STOP_DURATION ?? 30, routeDetails = null, detailedBusStops = null) {
	if (!detailedBusStops) {
		detailedBusStops = await admin
			.firestore()
			.collection("detailedBusStops")
			.get()
			.then((docs) => {
				let busStops = [];
				docs.forEach((doc) => {
					const data = doc.data();

					// Some busstop dont have coordinate
					busStops.push(data);
				});
				return busStops;
			});
	}

	if (!routeDetails) {
		routeDetails = (await admin.firestore().collection("routes").doc(routeCode).get()).data();
	}

	let totalDistance = 0;
	let totalDuration = 0;

	let busArrivalDetails = [];
	routeDetails.bus_stops.forEach((busStopID, index) => {
		const busStop = detailedBusStops.find((_busStop) => _busStop.ID == busStopID);
		if (!busStop) {
			console.warn(`busStop ID ${busStopID} does not exist in detailedBusStops`);
			return;
		} else {
			busArrivalDetails.push({ ID: busStopID, distanceTravelled: totalDistance, timeArrived: totalDuration });
			const neighbour = busStop.neighbours.find((neighbour) => neighbour.routeCode == routeCode);
			if (!neighbour) {
				console.warn(`busStop ID ${busStopID} does not have any neighbour with routeCode ${routeCode}`);
				return;
			} else {
				totalDistance += neighbour.distance.value;
				totalDuration += neighbour.duration.value + STOP_DURATION;
			}
		}
	});
	return busArrivalDetails;
}
