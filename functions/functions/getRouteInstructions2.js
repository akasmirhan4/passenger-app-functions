const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

// CONST
const BUS_RIDE_MULTIPLIER = 1;
const WALKING_MULTIPLIER = 100;
const WAITING_MULTIPLIER = 2;
const START_BUS_STOPS_OPTIONS = 25;
const END_BUS_STOPS_OPTIONS = 25;
const AVERAGE_BUS_STOP_INTERVAL = 60;
const ROUTE_SWITCH_COST = 0;

exports.getRouteInstructions2 = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	/* 
		A* PATH FINDING ALGORITHM

		GCost = Incurred Cost (Past)
		HCost = Potential Cost (Future)
		FCost = GCost + HCost

	*/

	const { origin, destination, timeStamp } = data || {};

	if (!origin || !destination) return { status: "MISSING ORIGIN OR DESTINATION" };
	if (!origin.location || !destination.location) return { status: "MISSING ORIGIN OR DESTINATION COORDINATES" };
	functions.logger.log({ origin });
	functions.logger.log({ destination });
	functions.logger.log({ timeStamp });

	// Get All Bus Stops
	let busStops = await admin
		.firestore()
		.collection("detailedBusStops")
		.get()
		.then((docs) => {
			let busStops = [];
			docs.forEach((doc) => {
				busStops.push(doc.data());
			});
			return busStops;
		});

	// put ref on each neighbours
	for (let index = 0; index < busStops.length; index++) {
		const busStop = busStops[index];
		for (let j = 0; j < busStop.neighbours.length; j++) {
			const neighbour = busStop.neighbours[j];
			neighbour.busStop = busStops.find((busStop) => busStop.ID == neighbour.busStop.ID);
		}
	}

	// Get All routeDetails
	const routeDetails = await admin
		.firestore()
		.collection("routes")
		.get()
		.then((docs) => {
			let data = [];
			docs.forEach((doc) => {
				data.push(doc.data());
			});
			return data;
		});

	// Get Nearest Bus Stops From Origin Coordinates
	const sortedOrigins = await nearestBusStops(origin.location, busStops);

	// Get Nearest Bus Stops From Destination Coordinates
	const sortedDestinations = await nearestBusStops(destination.location, busStops);

	let StartingTS = timeStamp ?? new Date().getTime();
	let closed = [
		{
			...origin,
			FCost: BUS_RIDE_MULTIPLIER * getDistance(origin.location.lat, origin.location.lng, destination.location.lat, destination.location.lng),
			GCost: 0,
			HCost: BUS_RIDE_MULTIPLIER * getDistance(origin.location.lat, origin.location.lng, destination.location.lat, destination.location.lng),
			mode: "start",
			timeStamp: StartingTS,
			duration: 0,
			distance: 0,
		},
	];
	let open = [];

	let batchDestinations = [];
	for (let i = 0; i < START_BUS_STOPS_OPTIONS; i++) {
		const sortedOrigin = sortedOrigins[i];
		batchDestinations.push(sortedOrigin.coordinates);
	}

	const originWalkingDetails = await getWalkingDetails(origin.location, batchDestinations);
	originWalkingDetails.forEach((walkingDetail, i) => {
		let GCost = WALKING_MULTIPLIER * walkingDetail.duration;
		const HCost =
			BUS_RIDE_MULTIPLIER * getDistance(sortedOrigins[i].coordinates.lat, sortedOrigins[i].coordinates.lng, destination.location.lat, destination.location.lng);
		const FCost = GCost + HCost;

		const updatedTS = StartingTS + walkingDetail.duration;
		open.push({
			...sortedOrigins[i],
			GCost,
			HCost,
			FCost,
			parent: closed[0],
			mode: "walking",
			timeStamp: updatedTS,
			duration: walkingDetail.duration,
			distance: walkingDetail.distance,
		});
	});

	// set destination limit
	batchDestinations = [];
	for (let i = 0; i < END_BUS_STOPS_OPTIONS; i++) {
		const sortedDestination = sortedDestinations[i];
		batchDestinations.push(sortedDestination.coordinates);
	}
	const destinationWalkingDetails = await getWalkingDetails(destination.location, batchDestinations);
	destinationWalkingDetails.forEach((walkingDetail, i) => {
		sortedDestinations[i].neighbours.push({
			mode: "walking",
			distance: { value: walkingDetail.distance },
			duration: { value: walkingDetail.duration },
			coordinates: destination.location,
			end: true,
		});
	});

	let current = null;
	let loopCount = 0;
	// Start
	while (loopCount < 1000) {
		loopCount++;
		//current = lowest f_cost node in open
		current = open.reduce((a, b) => (a.FCost < b.FCost ? a : b));

		//remove current from open
		open.splice(open.indexOf(current), 1);

		//add current to closed
		closed.push(current);

		// stop when current is destionation
		if (current.coordinates.lng == destination.location.lng && current.coordinates.lat == destination.location.lat) {
			functions.logger.log("Finished!");
			let nNodes = 1;
			let journeyBreakdown = [current];
			while (current.parent) {
				journeyBreakdown.unshift(current.parent);
				nNodes++;
				current = current.parent;
			}
			const { duration, distance } = await getWalkingDetails(journeyBreakdown[journeyBreakdown.length - 1].coordinates, destination.location);
			journeyBreakdown.push({
				...destination,
				parent: journeyBreakdown[journeyBreakdown.length - 1],
				mode: "walking",
				timeStamp: journeyBreakdown[journeyBreakdown.length - 1].timeStamp + duration,
				duration,
				distance,
			});
			let journeySummary;
			// if theres no bus involve, just walk
			if (!journeyBreakdown.some((journey) => journey.mode == "bus")) {
				const { duration, distance } = getWalkingDetails(origin.location, destination.location);
				journeySummary = {
					mode: "walking",
					distance,
					duration,
					timeStamp: journeyBreakdown[0].timeStamp,
					from: origin.location,
					to: destination.location,
				};
				return { status: "OK", result: journeySummary, length: 1 };
			} else {
				journeySummary = [
					{
						mode: journeyBreakdown[1].mode,
						distance: journeyBreakdown[1].distance / 1000,
						duration: journeyBreakdown[1].duration,
						timeStamp: journeyBreakdown[0].timeStamp,
						from: origin.location,
						to: journeyBreakdown[0].location,
						busStops: [journeyBreakdown[1].ID],
					},
					{
						mode: journeyBreakdown[2].mode,
						distance: [journeyBreakdown[2].distance / 1000],
						duration: [journeyBreakdown[2].duration],
						totalDistance: journeyBreakdown[2].distance / 1000,
						totalDuration: journeyBreakdown[2].duration + journeyBreakdown[2].waitingDuration,
						timeStamp: journeyBreakdown[1].timeStamp,
						busStops: [journeyBreakdown[1].ID, journeyBreakdown[2].ID],
						routeCode: journeyBreakdown[2].routeCode,
						waitingDuration: journeyBreakdown[2].waitingDuration,
					},
				];

				let j = 1;
				let currentRoute = journeyBreakdown[2].routeCode;

				for (let i = 3; i < journeyBreakdown.length; i++) {
					const journey = journeyBreakdown[i];
					//
					if (journey.mode == "bus") {
						if (currentRoute == journey.routeCode) {
							journeySummary[j].distance.push(journey.distance / 1000);
							journeySummary[j].totalDistance += journey.distance / 1000;
							journeySummary[j].duration.push(journey.duration);
							journeySummary[j].totalDuration += journey.duration;
							journeySummary[j].busStops.push(journey.ID);
						} else {
							currentRoute = journeyBreakdown[i].routeCode;
							j++;
							journeySummary.push({
								mode: journeyBreakdown[i].mode,
								distance: [journeyBreakdown[i].distance / 1000],
								duration: [journeyBreakdown[i].duration],
								totalDistance: journeyBreakdown[i].distance / 1000,
								totalDuration: journeyBreakdown[i].duration + journeyBreakdown[i].waitingDuration,
								timeStamp: journeyBreakdown[i - 1].timeStamp,
								busStops: [journeyBreakdown[i - 1].ID, journeyBreakdown[i].ID],
								routeCode: journeyBreakdown[i].routeCode,
								waitingDuration: journeyBreakdown[i].waitingDuration,
							});
						}
					} else {
						currentRoute = journeyBreakdown[i].routeCode;
						j++;
						journeySummary.push({
							mode: journey.mode,
							distance: journey.distance / 1000,
							duration: journey.duration,
							timeStamp: journey.timeStamp,
							from: journey.parent.coordinates,
							to: journey.location ?? journey.coordinates,
						});
					}
				}
				functions.logger.log({ status: "OK", result: journeySummary, length: nNodes });
				return { status: "OK", result: journeySummary, length: nNodes };
			}
		}

		// Loop through neighbours from current node
		for (let i = 0; i < current.neighbours.length; i++) {
			const neighbour = current.neighbours[i];
			// skip if neighbour in closed
			if (closed.some((node) => isNodeInNeighbour(node, neighbour))) continue;

			let GCost =
				neighbour.mode == "walking"
					? current.GCost + neighbour.duration.value * 1000 * WALKING_MULTIPLIER
					: current.GCost + neighbour.duration.value * 1000 * BUS_RIDE_MULTIPLIER;

			let updatedTS = current.timeStamp;
			let duration = neighbour.duration.value * 1000;
			updatedTS += duration;

			let waitingDuration;
			if (isRouteSwitched(current, neighbour)) {
				GCost += ROUTE_SWITCH_COST;
				// Add waiting penalty while waiting for bus
				if (neighbour.mode == "bus") {
					waitingDuration = await getBusArrivalDetails(neighbour.busStop.ID, neighbour.routeCode, updatedTS, routeDetails, busStops);

					// Skip if route is inactive
					if (!waitingDuration) continue;
					GCost += waitingDuration.duration * WAITING_MULTIPLIER;
					duration += waitingDuration.duration;
					updatedTS += waitingDuration.duration;
				}
			}

			const isInOpen = open.some((node) => isNodeInNeighbour(node, neighbour));
			// if new path to neighbour is not shorter or if neighbour is in open, skip
			if (GCost >= neighbour.GCost || isInOpen) continue;
			//
			let HCost;
			if (neighbour.coordinates) {
				HCost = getDistance(neighbour.coordinates.lat, neighbour.coordinates.lng, destination.location.lat, destination.location.lng);
				if (neighbour.mode == "walking") {
					HCost = HCost * WALKING_MULTIPLIER;
				} else {
					HCost = HCost * BUS_RIDE_MULTIPLIER;
				}
			} else {
				HCost =
					BUS_RIDE_MULTIPLIER *
					getDistance(neighbour.busStop.coordinates.lat, neighbour.busStop.coordinates.lng, destination.location.lat, destination.location.lng);
			}

			const FCost = HCost + GCost;
			const parent = current;

			if (!isInOpen) {
				if (!neighbour.end) {
					open.push({
						...neighbour.busStop,
						GCost,
						HCost,
						FCost,
						parent,
						mode: neighbour.mode,
						routeCode: neighbour.routeCode,
						timeStamp: updatedTS,
						duration,
						distance: neighbour.distance.value * 1000,
						waitingDuration: waitingDuration ? waitingDuration.duration : null,
					});
				} else {
					open.push({
						mode: neighbour.mode,
						coordinates: neighbour.coordinates,
						GCost,
						HCost,
						FCost,
						parent,
						timeStamp: updatedTS,
						duration: neighbour.duration.value,
						distance: neighbour.distance.value,
					});
				}
			} else {
				const index = open.findIndex((node) => node.id == neighbour.id);
				// ...neighbour.busStop, GCost, HCost, FCost, parent, mode: "bus", routeCode: neighbour.routeCode
				if (!neighbour.end) {
					open[index] = {
						...neighbour.busStop,
						GCost,
						HCost,
						FCost,
						parent,
						mode: neighbour.mode,
						routeCode: neighbour.routeCode,
						timeStamp: updatedTS,
						duration,
						distance: neighbour.distance.value * 1000,
						waitingDuration: waitingDuration ? waitingDuration.duration : null,
					};
				} else {
					open[index] = {
						mode: neighbour.mode,
						coordinates: neighbour.coordinates,
						GCost,
						HCost,
						FCost,
						parent,
						timeStamp: updatedTS,
						duration: neighbour.duration.value,
						distance: neighbour.distance.value,
					};
				}
			}
		}
	}

	return { status: "EXCEEDED LOOP COUNTS. TELL ADMIN SOMETHING IS WRONG" };
});
async function nearestBusStops(coordinate, busStops = []) {
	if (!busStops.length) {
		const docs = await admin.firestore().collection("busStops").get();
		docs.forEach((doc) => {
			busStops.push(doc.data());
		});
	}

	const bsDistance = busStops.map((busStop) => {
		const distance = getDistance(coordinate.lat, coordinate.lng, busStop.coordinates.lat, busStop.coordinates.lng);
		return { ...busStop, distance };
	});

	const result = bsDistance.sort((a, b) => (a.distance < b.distance ? -1 : 1));

	return result;
}

function getDistance(lat1, lon1, lat2, lon2) {
	var R = 6371; // Radius of the earth in km
	var dLat = deg2rad(lat2 - lat1); // deg2rad below
	var dLon = deg2rad(lon2 - lon1);
	var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
	var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	var d = R * c;
	return d * 1000000; //in mm
}

function deg2rad(deg) {
	return deg * (Math.PI / 180);
}

async function getWalkingDetails(originCoordinates, destinationCoordinates) {
	let destinations;

	let origins = `${originCoordinates.lat},${originCoordinates.lng}`;

	if (Array.isArray(destinationCoordinates)) {
		destinations = destinationCoordinates.map((coordinate) => `${coordinate.lat},${coordinate.lng}`).join("|");
	} else {
		destinations = `${destinationCoordinates.lat},${destinationCoordinates.lng}`;
	}
	const response = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json?", {
		params: {
			key: "AIzaSyAQ_zIEmNsRrvxOIRdzpvnTqlLn2Xs5sNc",
			origins,
			destinations,
			mode: "walking",
		},
	});
	if (response.data.status == "OK") {
		if (response.data.rows[0].elements.length > 1) {
			return response.data.rows[0].elements.map((element) => {
				return { duration: element.duration.value * 1000, distance: element.distance.value * 1000 };
			});
		} else {
			return { duration: response.data.rows[0].elements[0].duration.value * 1000, distance: response.data.rows[0].elements[0].distance.value * 1000 };
		}
	}
	return;
}

async function getBusArrivalDetails(busStopID, routeCode, timeStamp = new Date(), routeDetails = null, detailedBusStops = null) {
	//get route details
	if (!routeDetails) {
		routeDetails = await admin
			.firestore()
			.collection("routes")
			.get()
			.then((docs) => {
				let routeDetails = [];
				docs.forEach((doc) => {
					routeDetails.push(doc.data());
				});
			});
	}
	const selectedRoute = routeDetails.find((route) => route.route_code == routeCode);
	if (selectedRoute.active === false || !selectedRoute.schedule) return;
	// Get Index of busStopID in route exist in routeCode
	const busStopIndex = selectedRoute.bus_stops.findIndex((_busStopID) => _busStopID == busStopID);
	if (busStopIndex < 0) {
		console.error(`${busStopID} does not exist in route ${routeCode}`);
		return;
	}
	// simulate the route to find estimated timeArrival for each busStop
	const busArrivalDetails = await simulateRoute(routeCode, AVERAGE_BUS_STOP_INTERVAL, selectedRoute, detailedBusStops);
	const detail = busArrivalDetails.find((detail) => detail.ID == busStopID);
	const addedTimeArrived = detail.timeArrived;

	const timeArrivedArray = selectedRoute.schedule.map((timeString) => {
		const timeComp = timeString.split(":");
		return new Date(new Date(timeStamp).setHours(timeComp[0] - 8, timeComp[1], 0 + addedTimeArrived));
	});

	let nextTimeArrival = timeArrivedArray.find((time) => timeStamp < time);
	if (!nextTimeArrival) {
		nextTimeArrival = new Date(new Date(timeArrivedArray[0]).setDate(timeArrivedArray[0].getDate() + 1));
	}
	return { duration: nextTimeArrival - timeStamp, distance: detail.distanceTravelled * 1000 };
}

async function simulateRoute(routeCode, STOP_DURATION, routeDetails = null, detailedBusStops = null) {
	STOP_DURATION = STOP_DURATION ?? 30;
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
	for (let i = 0; i < routeDetails.bus_stops.length; i++) {
		const busStopID = routeDetails.bus_stops[i];
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
	}
	return busArrivalDetails;
}

function isNodeInNeighbour(node, neighbour) {
	if (!neighbour.busStop) return false;
	if (node.ID != neighbour.busStop.ID) return false;

	if (node.mode == "walking" && neighbour.mode == "walking") return true;
	if (node.mode == "bus" && neighbour.mode == "bus") {
		if (node.routeCode == neighbour.routeCode) return true;
	}

	return false;
}

function isRouteSwitched(current, neighbour) {
	if (current.mode == "walking") return true;
	if (current.mode == "bus" && neighbour.mode == "walking") return true;
	if (current.mode == "bus" && neighbour.mode == "bus") {
		if (current.routeCode == neighbour.routeCode) return false;
	}
	return true;
}
