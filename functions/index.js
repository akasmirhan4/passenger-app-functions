const admin = require("firebase-admin");
const { cancelTransaction } = require("./functions/cancelTransaction");
const { cleanBusStops } = require("./functions/cleanBusStops");
const { cleanRoutes } = require("./functions/cleanRoutes");
const { getRouteBusStopsDetails } = require("./functions/getRouteBusStopsDetails");
const { getRouteInstructions } = require("./functions/getRouteInstructions");
const { getTransactions } = require("./functions/getTransactions");
const { isPhoneNumberRegistered } = require("./functions/isPhoneNumberRegistered");
const { logPendingTransaction } = require("./functions/logPendingTransaction");
const { logTransaction } = require("./functions/logTransaction");
const { payByWallet } = require("./functions/payByWallet");

const { isPhoneNumberRegisteredDriver } = require("./functions/drivers/isPhoneNumberRegisteredDriver");

if (!admin.apps.length) {
	admin.initializeApp({
		databaseURL: "https://basmana-app-live-default-rtdb.asia-southeast1.firebasedatabase.app",
	});
}

exports.isPhoneNumberRegistered = isPhoneNumberRegistered;
exports.logPendingTransaction = logPendingTransaction;
exports.logTransaction = logTransaction;
exports.cancelTransaction = cancelTransaction;
exports.getTransactions = getTransactions;
exports.cleanBusStops = cleanBusStops;
exports.cleanRoutes = cleanRoutes;
exports.getRouteInstructions = getRouteInstructions;
exports.getRouteBusStopsDetails = getRouteBusStopsDetails;
exports.payByWallet = payByWallet;
exports.isPhoneNumberRegisteredDriver = isPhoneNumberRegisteredDriver;
