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

exports.getRouteInstructions = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	let WALKING_DISTANCE = 1; //km

	return new Promise(async (resolve, reject) => {
		// Collect all necessary data
		const { fromCoord, toCoord } = data;
		if (!fromCoord || !toCoord) resolve({ success: false, errorMsg: "Missing coordinates query" });

		let busStops = [];
		let routes = [];

		await Promise.all([admin.firestore().collection("busStops").orderBy("ID", "asc").get(), admin.firestore().collection("routes").get()])
			.then((results) => {
				results[0].forEach((doc) => {
					busStops.push(doc.data());
				});

				results[1].forEach((doc) => {
					routes.push(doc.data());
				});
			})
			.catch(reject);

		functions.logger.log("fromCoord");
		functions.logger.log(fromCoord);
		functions.logger.log("toCoord");
		functions.logger.log(toCoord);

		// Algorithm Starts
		let potentialRoutes = [];

		// Get Nearest busStops
		let busStopsNearFrom = [];
		let busStopsNearTo = [];
		for (let i = 0; i < busStops.length; i++) {
			//fromCoord
			let distanceBetweenFrom = getDistance(fromCoord.latitude, fromCoord.longitude, busStops[i].Latitude, busStops[i].Longitude);
			if (distanceBetweenFrom < WALKING_DISTANCE) busStopsNearFrom.push({ busStop: busStops[i], distance: distanceBetweenFrom });
			//toCoord
			let distanceBetweenTo = getDistance(toCoord.latitude, toCoord.longitude, busStops[i].Latitude, busStops[i].Longitude);
			if (distanceBetweenTo < WALKING_DISTANCE) busStopsNearTo.push({ busStop: busStops[i], distance: distanceBetweenTo });
		}

		// Reject if no nearby busStops
		if (!busStopsNearFrom.length) resolve({ success: false, errorMsg: "No bus stop nearby @from location" });
		if (!busStopsNearTo.length) resolve({ success: false, errorMsg: "No bus stop nearby @to location" });

		//Fun Part Starts
		busStopsNearFrom.forEach((fromBusStop) => {
			//START LOOP routeCode from fromBusStops (fromRouteCode)
			fromBusStop.busStop.Code.forEach((fromRouteCode) => {
				//Get details of fromRoutes (currentFromRoute)
				let currentFromRoute = routes.find((route) => route.route_code == fromRouteCode);
				if (currentFromRoute) {
					//Slice the busStop journey after fromBusStop
					let slicedFromBusStops = currentFromRoute.bus_stops.slice(currentFromRoute.bus_stops.indexOf(fromBusStop.busStop.ID) + 1);
					//To validate there is a stop in the route in case database is not formatted correctly
					if (slicedFromBusStops.length != currentFromRoute.bus_stops.length) {
						//START LOOP busStopsNearTo
						busStopsNearTo.forEach((toBusStop) => {
							//START LOOP routeCode from toBusStop (toRouteCode)
							toBusStop.busStop.Code.forEach((toRouteCode) => {
								//Get details of toRoutes (currentToRoute)
								let currentToRoute = routes.find((route) => route.route_code == toRouteCode);
								if (currentToRoute) {
									let slicedToBusStops = currentToRoute.bus_stops.slice(0, currentToRoute.bus_stops.indexOf(toBusStop.busStop.ID) + 1);
									//If the toBusStop is in the slicedBusStop, the journey is simply 1 bus ride
									let nBusStops = slicedFromBusStops.indexOf(toBusStop.busStop.ID) + 1;
									if (nBusStops > 0) {
										potentialRoutes.push({
											distanceFromBusStop: fromBusStop.distance,
											distanceToBusStop: toBusStop.distance,
											walkingDistance: fromBusStop.distance + toBusStop.distance,
											nBusStops,
											instructions: [
												{
													fromBusStop: fromBusStop.busStop.ID,
													route: [fromRouteCode],
													busStops: slicedFromBusStops.slice(0, nBusStops),
													toBusStop: toBusStop.busStop.ID,
													nBusStops,
												},
											],
										});
									}
									//If both fromRoutes and toRoutes have a similar bus stops, the journey is by taking 2 bus rides
									let interSectBusStop = slicedFromBusStops.find((busStop) => slicedToBusStops.includes(busStop));
									if (interSectBusStop) {
										//Get number of stops to travel
										let nBusStops1 = slicedFromBusStops.indexOf(interSectBusStop) + 1;
										let nBusStops2 = slicedToBusStops.length - slicedToBusStops.indexOf(interSectBusStop) - 1;
										let totalBusStops = nBusStops1 + nBusStops2;
										potentialRoutes.push({
											distanceFromBusStop: fromBusStop.distance,
											distanceToBusStop: toBusStop.distance,
											walkingDistance: fromBusStop.distance + toBusStop.distance,
											nBusStops: totalBusStops,
											instructions: [
												{
													fromBusStop: fromBusStop.busStop.ID,
													route: [currentFromRoute.route_code],
													busStops: slicedFromBusStops.slice(0, slicedFromBusStops.indexOf(interSectBusStop) + 1),
													toBusStop: interSectBusStop,
													nBusStops: nBusStops1,
												},
												{
													fromBusStop: interSectBusStop,
													route: [currentToRoute.route_code],
													busStops: slicedToBusStops.slice(slicedToBusStops.indexOf(interSectBusStop) + 1, slicedToBusStops.length),
													toBusStop: toBusStop.busStop.ID,
													nBusStops: nBusStops2,
												},
											],
										});
									}
								} else {
									functions.logger.warn(`Cannot get route details for #${toRouteCode}`);
								}
							});
						});
					}
				} else {
					functions.logger.warn(`Cannot get route details for #${fromRouteCode}`);
				}
			});
		});

		// Find optimal routes
		if (potentialRoutes.length) {
			let recommendedRoutes = {
				leastBusStopsRoutes: [],
				leastWalkingDistanceRoutes: [],
			};
			//potentialRoutes (sort by walkingDistance)
			potentialRoutes.sort((a, b) => (a.walkingDistance > b.walkingDistance ? 1 : b.walkingDistance > a.walkingDistance ? -1 : 0));
			let leastWalkingDistanceRoutes = [potentialRoutes[0]];
			let leastDistance = potentialRoutes[0].walkingDistance;
			functions.logger.log(leastDistance);
			for (let i = 1; i < potentialRoutes.length; i++) {
				if (potentialRoutes[i].walkingDistance >= leastDistance) {
					break;
				} else {
					functions.logger.log(potentialRoutes[i].walkingDistance > leastDistance);
					functions.logger.log(potentialRoutes[i].walkingDistance);
					leastWalkingDistanceRoutes.push(potentialRoutes[i]);
				}
			}
			//potentialRoutes (sort by nBusStops)
			potentialRoutes.sort((a, b) => (a.nBusStops > b.nBusStops ? 1 : b.nBusStops > a.nBusStops ? -1 : 0));
			let leastBusStopsRoutes = [potentialRoutes[0]];
			let leastBusStops = potentialRoutes[0].nBusStops;
			for (let i = 1; i < potentialRoutes.length; i++) {
				if (potentialRoutes[i].nBusStops >= leastBusStops) {
					break;
				} else {
					leastBusStopsRoutes.push(potentialRoutes[i]);
				}
			}
			//leastWalkingDistanceRoutes (sort by nBusStops)
			leastWalkingDistanceRoutes.sort((a, b) => (a.nBusStops > b.nBusStops ? 1 : b.nBusStops > a.nBusStops ? -1 : 0));
			recommendedRoutes.leastWalkingDistanceRoutes.push(leastWalkingDistanceRoutes[0]);
			leastBusStops = leastWalkingDistanceRoutes[0].nBusStops;
			for (let i = 1; i < leastWalkingDistanceRoutes.length; i++) {
				if (leastWalkingDistanceRoutes[i].nBusStops > leastBusStops) {
					break;
				} else {
					recommendedRoutes.leastWalkingDistanceRoutes.push(leastWalkingDistanceRoutes[i]);
				}
			}
			//leastBusStopsRoutes (sort by walkingDistance)
			leastBusStopsRoutes.sort((a, b) => (a.walkingDistance > b.walkingDistance ? 1 : b.walkingDistance > a.walkingDistance ? -1 : 0));
			recommendedRoutes.leastBusStopsRoutes.push(leastBusStopsRoutes[0]);
			leastDistance = leastBusStopsRoutes[0].walkingDistance;
			for (let i = 1; i < leastBusStopsRoutes.length; i++) {
				if (leastBusStopsRoutes[i].walkingDistance > leastDistance) {
					break;
				} else {
					recommendedRoutes.leastBusStopsRoutes.push(leastBusStopsRoutes[i]);
				}
			}

			resolve({success: true, recommendedRoutes});
		} else {
			resolve({ success: false, errorMsg: "Could not find routes with this algorithm" });
		}
	});
});
