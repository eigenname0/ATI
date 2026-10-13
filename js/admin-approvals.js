const approvalFunctions = firebase.app().functions();
const approvalList = document.getElementById("applicationList");
const approvalNotice = document.getElementById("approvalNotice");

function setApprovalNotice(message, isError) {
	approvalNotice.textContent = message;
	approvalNotice.classList.toggle("error", Boolean(isError));
}

function makeApplicationCard(application) {
	const card = document.createElement("article");
	card.className = "approvalCard";
	const company = document.createElement("h2");
	company.textContent = application.companyName || "Company name not provided";
	const email = document.createElement("p");
	email.className = "approvalEmail";
	email.textContent = application.email || "No contact email";
	const date = document.createElement("p");
	date.className = "approvalDate";
	date.textContent = application.createdAt ? `Submitted ${new Date(application.createdAt).toLocaleString()}` : "Recently submitted";
	const actions = document.createElement("div");
	actions.className = "approvalActions";
	const approve = document.createElement("button");
	approve.type = "button";
	approve.textContent = "Approve company";
	const reject = document.createElement("button");
	reject.type = "button";
	reject.className = "reject";
	reject.textContent = "Decline";
	const review = async (decision) => {
		approve.disabled = reject.disabled = true;
		try {
			await approvalFunctions.httpsCallable("reviewCompanyApplication")({ uid: application.uid, decision });
			await loadApplications();
		} catch (error) {
			console.error("Application review failed:", error);
			setApprovalNotice(error.message || "Could not update the application. Try again.", true);
			approve.disabled = reject.disabled = false;
		}
	};
	approve.addEventListener("click", () => review("approved"));
	reject.addEventListener("click", () => review("rejected"));
	actions.append(approve, reject);
	card.append(company, email, date, actions);
	return card;
}

async function loadApplications() {
	setApprovalNotice("Loading pending companies…", false);
	approvalList.replaceChildren();
	try {
		const result = await approvalFunctions.httpsCallable("listCompanyApplications")();
		const applications = result.data.applications || [];
		if (!applications.length) {
			setApprovalNotice("There are no pending company applications.", false);
			return;
		}
		setApprovalNotice(`${applications.length} pending company application${applications.length === 1 ? "" : "s"}.`, false);
		applications.forEach(application => approvalList.appendChild(makeApplicationCard(application)));
	} catch (error) {
		console.error("Could not load applications:", error);
		setApprovalNotice(error.message || "Could not load applications.", true);
	}
}

auth.onAuthStateChanged(async (user) => {
	if (!user) {
		window.location.href = "auth.html";
		return;
	}
	const token = await user.getIdTokenResult();
	if (token.claims.admin !== true) {
		setApprovalNotice("This page is only available to the ATI website administrator.", true);
		return;
	}
	try {
		const profile = await db.collection("users").doc(user.uid).get();
		if (profile.exists) applyAccountTheme(profile.data().themeColors);
	} catch (error) {
		console.error("Could not load administrator theme:", error);
	}
	loadApplications();
});
