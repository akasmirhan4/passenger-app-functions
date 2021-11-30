const functions = require("firebase-functions");
const admin = require("firebase-admin");

// create routes collection
exports.cleanRoutes = functions.region("asia-southeast1").https.onCall(async (data, context) => {
	return new Promise(async (resolve, reject) => {
		let rawBusStops = [];
		let cleanBusStops = [];
		let providers = [];
		//collect data (rawBusStops, busStops, providers)
		await Promise.all([
			admin.firestore().collection("rawBusStops").orderBy("ID", "asc").get(),
			admin.firestore().collection("busStops").get(),
			admin.firestore().collection("providers").get(),
		])
			.then((results) => {
				results[0].forEach((doc) => {
					rawBusStops.push(doc.data());
				});
				functions.logger.log("raw bus stops collected");
				functions.logger.info(rawBusStops, { structuredData: true });
				results[1].forEach((doc) => {
					cleanBusStops.push(doc.data());
				});
				functions.logger.log("clean bus stops collected");
				functions.logger.info(cleanBusStops, { structuredData: true });
				results[2].forEach((doc) => {
					providers.push(doc.data());
				});
				functions.logger.log("providers collected");
				functions.logger.info(providers, { structuredData: true });
			})
			.catch(reject);

		let routes = [];
		let index = 1;
		let routeCodes = [];
		providers.forEach((provider) => {
			let providerCode = provider.code;
			functions.logger.info(`Current provider: ${providerCode}`);
			provider.routes.forEach((routeCode) => {
				functions.logger.info(`Current route: ${routeCode}`);
				if (!routeCodes.includes(routeCode)) {
					routeCodes.push(routeCode);
					let route = {
						id: index,
						route_code: routeCode,
						areas: [],
						bus_stops: [],
						providers: [providerCode],
					};
					let routeBusStops = [];
					let routeAreas = [];
					rawBusStops.forEach((rawBusStop) => {
						functions.logger.info(`Current (raw busStop, routeCode): (${rawBusStop.ID}, ${rawBusStop.Code}).`);
						if (rawBusStop.Code == routeCode) {
							if (routeAreas[routeAreas.length - 1] != rawBusStop.Area) {
								routeAreas.push(rawBusStop.Area);
							}
							cleanBusStops.forEach((cleanBusStop) => {
								functions.logger.info(`Current clean busStop: ${cleanBusStop.ID}.`);
								if (cleanBusStop.ID == rawBusStop.ID) {
									routeBusStops.push(rawBusStop.ID);
								} else if (cleanBusStop.altID.includes(rawBusStop.ID)) {
									routeBusStops.push(cleanBusStop.ID);
								}
							});
						}
					});
					route.areas = routeAreas;
					route.bus_stops = routeBusStops;
					routes.push(route);
					index++;
				} else {
					functions.logger.log(`provider ${providerCode} has a dup route ${routeCode}`);
					let routeIndex = routes.findIndex((route) => route.route_code == routeCode);
					routes[routeIndex].providers.push(providerCode);
				}
			});
		});

		//   Delete routes collection first to reset
		let deleteBatch = admin.firestore().batch();
		await admin
			.firestore()
			.collection("routes")
			.listDocuments()
			.then(async (val) => {
				val.map((val) => {
					deleteBatch.delete(val);
				});
				await deleteBatch.commit();
			})
			.catch(reject);
		functions.logger.log("routes collection deleted");

		//   Set routes collection
		functions.logger.info(routes, { structuredData: true });
		let setBatch = admin.firestore().batch();
		routes.forEach((route) => {
			functions.logger.info(`Current route: ${route.route_code}.`);
			admin.firestore().collection("routes").doc(route.route_code.toString()).set(route);
		});
		await setBatch.commit().then(() => {
			functions.logger.log(`database set`);
			resolve({ success: true });
		});
	});
});
