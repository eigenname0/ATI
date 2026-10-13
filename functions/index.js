const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();

function requireAdmin(request) {
	if (!request.auth || request.auth.token.admin !== true) {
		throw new HttpsError("permission-denied", "Administrator access is required.");
	}
}

exports.listCompanyApplications = onCall(async (request) => {
	requireAdmin(request);
	const snapshot = await db.collection("applications").where("status", "==", "pending").limit(100).get();
	return {
		applications: snapshot.docs.map((doc) => {
			const data = doc.data();
			return {
				uid: doc.id,
				companyName: String(data.companyName || "").slice(0, 160),
				email: String(data.email || "").slice(0, 254),
				createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : null
			};
		})
	};
});

exports.reviewCompanyApplication = onCall(async (request) => {
	requireAdmin(request);
	const uid = typeof request.data.uid === "string" ? request.data.uid : "";
	const decision = request.data.decision;
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !["approved", "rejected"].includes(decision)) {
		throw new HttpsError("invalid-argument", "A valid application and decision are required.");
	}

	const applicationRef = db.collection("applications").doc(uid);
	const profileRef = db.collection("users").doc(uid);
	const [application, profile] = await Promise.all([applicationRef.get(), profileRef.get()]);
	if (!application.exists || !profile.exists || application.get("status") !== "pending") {
		throw new HttpsError("failed-precondition", "This application is no longer pending.");
	}

	const batch = db.batch();
	batch.update(applicationRef, {
		status: decision,
		reviewedAt: FieldValue.serverTimestamp(),
		reviewedBy: request.auth.uid
	});
	batch.update(profileRef, { approvalStatus: decision, reviewedAt: FieldValue.serverTimestamp() });
	const email = String(application.get("email") || profile.get("email") || "");
	if (email) {
		batch.set(db.collection("mail").doc(), {
			to: email,
			message: {
				subject: decision === "approved" ? "ATI account approved" : "ATI account review update",
				text: decision === "approved"
					? "Your company account has been approved. You can now sign in to ATI."
					: "Your company account was not approved. Please contact the ATI website owner for more information."
			}
		});
	}
	await batch.commit();
	return { status: decision };
});
