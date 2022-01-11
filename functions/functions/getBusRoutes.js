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

async function nearestBusStops(coordinate, busStops = []) {
	if (!busStops.length) {
		const docs = await admin.firestore().collection("busStops").get();
		docs.forEach((doc) => {
			busStops.push(doc.data());
		});
	}

	const bsDistance = busStops.map((busStop) => {
		const distance = getDistance(coordinate.lat, coordinate.lng, busStop.Latitude, busStop.Longitude);
		return { ...busStop, distance };
	});
	functions.logger.log({ bsDistance });

	const result = bsDistance.sort((a, b) => (a.distance < b.distance ? -1 : 1));
	functions.logger.log({ result });

	return result;
}

const getDirections = (origin, destination, mode = "DRIVING") => {
	const parameters = {
		key,
		origin,
		destination,
		mode,
		alternatives: true,
	};
	let urlParameters = Object.entries(parameters)
		.map((e) => e.join("="))
		.join("&");
	return new Promise((resolve, reject) => {
		let config = {
			method: "get",
			url: `https://maps.googleapis.com/maps/api/directions/json?${urlParameters}`,
			headers: {},
		};
		axios(config)
			.then((response) => {
				resolve(response.data);
			})
			.catch(reject);
	});
};

async function getWalkingTime(originCoordinates, destinationCoordinates) {
	const parameters = {
		key: "AIzaSyAQ_zIEmNsRrvxOIRdzpvnTqlLn2Xs5sNc",
		origin: `${originCoordinates.lat},${originCoordinates.lng}`,
		destination: `${destinationCoordinates.lat},${destinationCoordinates.lng}`,
		mode: "walking",
		alternatives: true,
	};
	const urlParameters = Object.entries(parameters)
		.map((e) => e.join("="))
		.join("&");

	let config = {
		method: "get",
		url: `https://maps.googleapis.com/maps/api/directions/json?${urlParameters}`,
		headers: {},
	};
	const { data } = await axios(config);
	
}
const travelTime = () => {};
const timeBusArrive = () => {};

exports.getRouteInstructions = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	const {
		origin: { location: originCoordinates },
		destination: { location: destinationCoordinates },
	} = data;
	if (!originCoordinates || !destinationCoordinates) return { success: false, errorMsg: "Invalid Coordinates" };

	// Get All Bus Stops
	const busStops = await admin
		.firestore()
		.collection("busStops")
		.get()
		.then((docs) => {
			let busStops = [];
			docs.forEach((doc) => {
				busStops.push(doc.data());
			});
			return busStops;
		});

	// Get Nearest Bus Stops From Origin Coordinates
	const sortedOrigin = nearestBusStops(originCoordinates, busStops);

	// Get Nearest Bus Stops From Destination Coordinates
	const sortedDestination = nearestBusStops(destinationCoordinates, busStops);

	/* 
	KRESU 
	1x - Travel Time
	2x - Walking Between Stops
	2x - Waiting at stop in between journey
	0.5x - Waiting Time at first stop
	
	TODO:
	Get Travel Time Between Connecting Bus Stops
	Get Walking Time Between Stops (Limit to 1km)
	Get Timetable of Buses
	Get Distance of BusStops From Each Others

	*/

	/* 
		PSEUDO A* ALGORITHM

		GCost = Incurred Cost (Past)
		HCost = Potential Cost (Future)
		FCost = GCost + HCost

	*/

	// Get Cost to get to the first bus stop
	const GCost = 2 * getWalkingTime(originCoordinates, originBusStop.coordinates);
	const HCost = travelTime(originCoordinates, destinationBusStop.coordinates);
	const FCost = GCost + HCost;

	let open = [{ ...origin, FCost, GCost, HCost }];

	// Get Cost for first neigbouring stops
	originBusStop.neighbours.forEach((neighbour) => {
		const HCost = travelTime(neighbour.coordinates, destinationBusStop.coordinates);
		let GCost = travelTime(neighbour.coordinates, originBusStop.coordinates);
		neighbour.routes.forEach((route) => {
			if (route == "walk") return;
			GCost += 0.5 * timeBusArrive(neighbour.id, neighbour.route);
			const FCost = HCost + GCost;
			const parent = { ...originBusStop, route: neighbour.route };
			open.push({ ...neighbour, GCost, HCost, FCost, parent });
		});
	});

	let closed = [];
	let current = null;

	// Start
	while (true) {
		//current = lowest f_cost node in open
		current = open.reduce((a, b) => (a.FCost < b.FCost ? a : b));

		//remove current from open
		open.splice(open.indexOf(current), 1);

		//add current to closed
		closed.push(current);

		// stop when current is destination
		if (current.id == destination.id) return;

		// Loop through neighbours from current node
		current.neighbours.forEach((neighbour) => {
			neighbour.routes.forEach((route) => {
				// skip if neighbour in closed
				if (closed.some((node) => node.id == neighbour.id && node.parent.route == neighbour.parent.route)) return;

				let GCost;
				let isInOpen = false;

				// if neighbour is in open
				if (open.some((node) => node.id == neighbour.id && node.parent.route == neighbour.parent.route)) {
					isInOpen = true;
					GCost = current.GCost + travelTime(current.coordinates, neighbour.coordinates);

					// Add Cost If switching route
					if (current.parent.route !== neighbour.route) {
						if (route == "walk") {
							GCost += 2 * getWalkingTime(current.coordinates, neighbour.coordinates);
						} else {
							GCost += timeBusArrive(neighbour.id, neighbour.routeCode);
						}
					}
					// if new path to neighbour is not shorter, skip
					if (GCost >= neighbour.GCost) {
						return;
					}
				}
				const HCost = travelTime(neighbour, destinationBusStop);
				const FCost = HCost + GCost;
				const parent = { ...current, route: neighbour.routeCode };

				if (!isInOpen) {
					open.push({ ...neighbour, GCost, HCost, FCost, parent });
				} else {
					const index = open.findIndex((node) => node.id == neighbour.id);
					open[index] = { ...neighbour, GCost, HCost, FCost, parent };
				}
			});
		});
	}
});
