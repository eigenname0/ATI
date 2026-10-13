const LOCAL_PROFILE_KEY = "atiLocalProfile";
const LOCAL_INVOICES_KEY = "atiLocalInvoices";

function getLocalInvoices() {
	try {
		const raw = localStorage.getItem(LOCAL_INVOICES_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch (error) {
		console.warn("Could not read local invoices:", error);
		return [];
	}
}

function setLocalInvoices(invoices) {
	localStorage.setItem(LOCAL_INVOICES_KEY, JSON.stringify(invoices));
}

function getLocalSavedInvoiceById(invoiceId) {
	return getLocalInvoices().find(invoice => invoice.id === invoiceId) || null;
}

function getLocalInvoicesForUser(user, profile) {
	return getLocalInvoices().filter(invoice =>
		invoice.ownerId === user.uid
		|| invoice.ownerUsername === profile.username
		|| (!invoice.ownerId && !invoice.ownerUsername)
	);
}

async function syncLocalInvoicesToFirestore(user, profile) {
	if (!user || !isFirebaseConfigured() || !navigator.onLine) return 0;
	const localInvoices = getLocalInvoicesForUser(user, profile);
	let syncedCount = 0;

	for (const localInvoice of localInvoices) {
		const invoiceId = `offline-${localInvoice.id}`;
		const userRef = db.collection("users").doc(user.uid);
		const invoiceRef = userRef.collection("invoices").doc(invoiceId);
		const invoiceData = { ...localInvoice };
		delete invoiceData.id;
		delete invoiceData.ownerId;
		delete invoiceData.ownerUsername;
		await db.runTransaction(async transaction => {
			const [existingInvoice, profileSnapshot] = await Promise.all([
				transaction.get(invoiceRef),
				transaction.get(userRef)
			]);
			if (existingInvoice.exists) return;

			const cloudProfile = profileSnapshot.data() || {};
			const storedSequences = cloudProfile.nextInvoiceNumber && typeof cloudProfile.nextInvoiceNumber === "object"
				? cloudProfile.nextInvoiceNumber
				: (cloudProfile.nextInvoiceNumbers || createInitialInvoiceSequences());
			const invoiceType = localInvoice.type === "purchase" ? "purchase_tax" : (localInvoice.type || "sales");
			const invoiceSequence = Math.max(1, parseInt(localInvoice.invoiceNo, 10) || 1);
			const nextSequences = {
				...createInitialInvoiceSequences(),
				...storedSequences,
				[invoiceType]: Math.max(
					parseInt(storedSequences[invoiceType], 10) || 1,
					invoiceSequence + 1
				)
			};
			transaction.set(invoiceRef, {
				...invoiceData,
				invoiceNo: invoiceSequence,
				createdAt: firebase.firestore.FieldValue.serverTimestamp()
			});
			transaction.set(userRef, { nextInvoiceNumber: nextSequences }, { merge: true });
		});

		setLocalInvoices(getLocalInvoices().filter(invoice => invoice.id !== localInvoice.id));
		syncedCount++;
	}

	return syncedCount;
}

function isFirebaseConfigured() {
	return !!(
		window.firebase &&
		firebase.apps &&
		firebase.apps.length > 0 &&
		firebaseConfig &&
		firebaseConfig.apiKey &&
		!firebaseConfig.apiKey.includes("YOUR_API_KEY") &&
		firebaseConfig.projectId &&
		!firebaseConfig.projectId.includes("YOUR_PROJECT_ID")
	);
}

function getLocalProfile(username) {
	try {
		const saved = localStorage.getItem(LOCAL_PROFILE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			if (!username || parsed.username?.toLowerCase() === username.toLowerCase()) {
				if (!parsed.integrations) {
					parsed.integrations = createInitialIntegrationSettings();
					saveLocalProfile(parsed);
				}
				return parsed;
			}
		}
	} catch (_) {
		// ignore malformed saved profile and fall back to a demo profile
	}

	const fallbackUsername = (username || "demo").trim() || "demo";
	const profile = {
		uid: "local-demo-user",
		username: fallbackUsername,
		companyName: "Local Demo Company",
		trn: "000000000000000",
		address: "Local demo environment",
		phone: "0000000000",
		email: `${fallbackUsername.toLowerCase()}@local.test`,
		requiresEmailVerification: false,
		approvalStatus: "approved",
		logoData: null,
		stampData: null,
		nextInvoiceNumber: createInitialInvoiceSequences(),
		integrations: createInitialIntegrationSettings()
	};

	localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
	return profile;
}

function createInitialInvoiceSequences() {
	return {
		sales: 1,
		purchase_tax: 1,
		purchase_non_vat: 1,
		commercial: 1,
		consignment: 1,
		proforma: 1,
		credit: 1
	};
}

function createInitialIntegrationSettings() {
	return {
		zoho: { enabled: false, organizationId: "", status: "not_configured" },
		asp: { enabled: false, provider: "", status: "not_configured" }
	};
}

function saveLocalProfile(profile) {
	if (!profile) return;
	localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
}

const DEFAULT_ACCOUNT_THEME = Object.freeze({
	icons: "#d0a933",
	buttons: "#d0a933",
	line: "#d0a933"
});

function normalizeAccountTheme(theme) {
	const value = theme && typeof theme === "object" ? theme : {};
	const validColor = color => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);
	return {
		enabled: value.enabled === true,
		icons: validColor(value.icons) ? value.icons : DEFAULT_ACCOUNT_THEME.icons,
		buttons: validColor(value.buttons) ? value.buttons : DEFAULT_ACCOUNT_THEME.buttons,
		line: validColor(value.line) ? value.line : DEFAULT_ACCOUNT_THEME.line
	};
}

function applyAccountTheme(theme) {
	const normalized = normalizeAccountTheme(theme);
	const colors = normalized.enabled ? normalized : DEFAULT_ACCOUNT_THEME;
	const root = document.documentElement;
	root.style.setProperty("--ati-icon-color", colors.icons);
	root.style.setProperty("--ati-button-color", colors.buttons);
	root.style.setProperty("--ati-line-color", colors.line);
}

function hasLoggedInBefore() {
	return localStorage.getItem("atiHasLoggedInBefore") === "1";
}

function markLoggedInBefore() {
	localStorage.setItem("atiHasLoggedInBefore", "1");
}

let _currentProfile = null; 

function currentUser() {
	return _currentProfile ? _currentProfile.username : null;
}

function currentUserBranding() {
	if (!_currentProfile) return null;
	return {
		logo: _currentProfile.logoData || null,
		stamp: _currentProfile.stampData || null,
		trn: _currentProfile.trn || null,
		address: _currentProfile.address || null,
		phone: _currentProfile.phone || null,
		email: _currentProfile.email || null
	};
}

function usernameKey(username) {
	return username.trim().toLowerCase();
}

function fileToDataURL(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error("Could not read file"));
		reader.readAsDataURL(file);
	});
}

function requireAuth(onReady) {
	if (!isFirebaseConfigured() || !navigator.onLine) {
		const profile = getLocalProfile();
		_currentProfile = profile;
		applyAccountTheme(profile.themeColors);
		if (typeof onReady === "function") onReady(_currentProfile, { uid: profile.uid, email: profile.email });
		return;
	}

	auth.onAuthStateChanged(async (user) => {
		if (!user) {
			window.location.href = "auth.html";
			return;
		}
		try {
			const doc = await db.collection("users").doc(user.uid).get();
			if (!doc.exists) {
				await auth.signOut();
				window.location.href = "auth.html?status=profile";
				return;
			}
			_currentProfile = doc.data();
			if (!_currentProfile.integrations) {
				_currentProfile.integrations = createInitialIntegrationSettings();
				await db.collection("users").doc(user.uid).set({ integrations: _currentProfile.integrations }, { merge: true });
			}
			applyAccountTheme(_currentProfile.themeColors);
		} catch (err) {
			console.error("Could not load profile:", err);
			const fallback = getLocalProfile();
			_currentProfile = fallback;
			applyAccountTheme(fallback.themeColors);
			if (typeof onReady === "function") onReady(_currentProfile, { uid: fallback.uid, email: fallback.email });
			return;
		}
		if (_currentProfile.requiresEmailVerification && !user.emailVerified) {
			await auth.signOut();
			window.location.href = "auth.html?status=verify";
			return;
		}
		if (_currentProfile.approvalStatus === "pending" || _currentProfile.approvalStatus === "rejected") {
			await auth.signOut();
			window.location.href = "auth.html?status=" + _currentProfile.approvalStatus;
			return;
		}
		const adminLink = document.querySelector(".adminOnly");
		if (adminLink) user.getIdTokenResult().then(result => { if (result.claims.admin === true) adminLink.style.display = "inline-flex"; });
		if (typeof onReady === "function") onReady(_currentProfile, user);
	});
}

function logout() {
	if (!isFirebaseConfigured() || !navigator.onLine) {
		localStorage.removeItem(LOCAL_PROFILE_KEY);
		window.location.href = "auth.html";
		return;
	}
	auth.signOut().then(() => {
		window.location.href = "auth.html";
	});
}

function friendlyFirebaseError(err) {
	const message = err && (err.message || "");
	const code = err && err.code;

	if (code === "unavailable" || /client is offline|offline/i.test(message)) {
		return "Please check your internet connection and try again.";
	}

	const map = {
		"auth/wrong-password": "Incorrect password.",
		"auth/invalid-credential": "Incorrect password.",
		"auth/invalid-login-credentials": "Incorrect password.",
		"auth/user-not-found": "No account found with that username.",
		"auth/email-already-in-use": "That email is already registered.",
		"auth/weak-password": "Password must be at least 6 characters.",
		"auth/invalid-email": "That email address looks invalid.",
		"auth/network-request-failed": "Network error - please check your connection.",
		"auth/too-many-requests": "Too many attempts. Please wait a moment and try again."
	};
	return (code && map[code]) || (message && !/Failed to get document because the client is offline\./i.test(message) ? message : "Something went wrong. Please try again.");
}

function showAuthMsg(id, text, isError) {
	const msg = document.getElementById(id);
	if (!msg) return;
	msg.textContent = text;
	msg.className = "authMsg " + (isError ? "error shake" : "success");

	if (isError) {
		msg.addEventListener("animationend", () => msg.classList.remove("shake"), { once: true });
	}
}

function clearAuthMsgs() {
	document.querySelectorAll(".authMsg").forEach(m => {
		m.textContent = "";
		m.className = "authMsg";
	});
}

function setLoading(btn, isLoading) {
	if (!btn) return;
	btn.disabled = isLoading;
	btn.classList.toggle("isLoading", isLoading);
}

const EYE_ICON = '<svg class="pwIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg class="pwIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 7 11 7a19.9 19.9 0 0 1-3.17 4.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function togglePassword(inputId, btn) {
	const input = document.getElementById(inputId);
	const showing = input.type === "text";
	input.type = showing ? "password" : "text";
	btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
	btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
}

function previewImage(input, previewId) {
	const preview = document.getElementById(previewId);
	if (input.files && input.files[0]) {
		const reader = new FileReader();
		reader.onload = e => {
			preview.src = e.target.result;
			preview.hidden = false;
		};
		reader.onerror = () => {
			console.error("Could not preview selected image:", reader.error);
			preview.hidden = true;
		};
		reader.readAsDataURL(input.files[0]);
	} else {
		preview.hidden = true;
		preview.removeAttribute("src");
	}
}

function setAuthMode(mode, options) {
	const wrapper = document.querySelector(".authWrapper");
	if (!wrapper) return;

	const opts = options || {};
	const isRegister = mode === "register";

	wrapper.dataset.mode = mode;
	document.title = isRegister ? "ATI - Register" : "ATI - Login";

	const loginTitle = document.getElementById("loginTitle");
	const loginSubtitle = document.getElementById("loginSubtitle");
	if (loginTitle && loginSubtitle) {
		if (hasLoggedInBefore()) {
			loginTitle.textContent = "Welcome back";
			loginSubtitle.textContent = "Log in to continue to your invoices";
		} else {
			loginTitle.textContent = "Welcome";
			loginSubtitle.textContent = "Log in, or create an account to get started";
		}
	}

	const loginSlide = document.getElementById("loginSlide");
	const registerSlide = document.getElementById("registerSlide");
	loginSlide.inert = isRegister;
	registerSlide.inert = !isRegister;
	loginSlide.setAttribute("aria-hidden", String(isRegister));
	registerSlide.setAttribute("aria-hidden", String(!isRegister));

	clearAuthMsgs();

	if (!opts.silent) {
		setTimeout(() => {
			const target = document.getElementById(isRegister ? "regUsername" : "loginUsername");
			if (target) target.focus({ preventScroll: true });
		}, 520);
	}
}

function goToMode(mode) {
	if (window.location.hash !== "#" + mode) {
		window.location.hash = mode;
	} else {
		setAuthMode(mode);
	}
}

function modeFromHash() {
	return window.location.hash === "#register" ? "register" : "login";
}

function initAuthPage() {
	setAuthMode(modeFromHash(), { silent: true });
	const status = new URLSearchParams(window.location.search).get("status");
	const messages = {
		verify: "Please verify your email address using the link we sent, then sign in again.",
		pending: "Your email is verified. Your company is waiting for approval; you can sign in after the review is complete.",
		rejected: "This company account has not been approved. Please contact the website owner.",
		profile: "We couldn't find the account profile. Please contact the website owner.",
		connection: "We couldn't verify your account status. Check your connection and sign in again."
	};
	if (messages[status]) showAuthMsg("loginMsg", messages[status], status === "rejected");

	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			document.querySelector(".authWrapper").classList.add("ready");
		});
	});

	window.addEventListener("hashchange", () => setAuthMode(modeFromHash()));
}

async function handleRegister(event) {
	event.preventDefault();
	const submitBtn = event.target.querySelector("button[type=submit]");

	const username = regUsername.value.trim();
	const companyName = regCompanyName.value.trim();
	const password = regPassword.value;
	const confirmPassword = regConfirm.value;
	const trn = regTRN.value.trim();
	const address = regAddress.value.trim();
	const phone = regPhone.value.trim();
	const email = regEmail.value.trim().toLowerCase();
	const logoFile = regLogo.files[0];
	const stampFile = regStamp.files[0];
	const MAX_SIZE = 300 * 1024;

	if (!logoFile || !stampFile) {
		showAuthMsg("regMsg", "Please upload both your logo and your stamp.", true);
		return;
	}
	if (logoFile.size > MAX_SIZE || stampFile.size > MAX_SIZE) {
		showAuthMsg("regMsg", "Please use images under 300KB each (resize or compress them if needed).", true);
		return;
	}

	if (!isFirebaseConfigured() || !navigator.onLine) {
		if (!username || !companyName || !password) {
			showAuthMsg("regMsg", "Please fill in all fields.", true);
			return;
		}
		if (password !== confirmPassword) {
			showAuthMsg("regMsg", "Passwords do not match.", true);
			return;
		}
		if (password.length < 6) {
			showAuthMsg("regMsg", "Password must be at least 6 characters.", true);
			return;
		}
		let logoData;
		let stampData;
		try {
			[logoData, stampData] = await Promise.all([
				fileToDataURL(logoFile),
				fileToDataURL(stampFile)
			]);
		} catch (error) {
			console.error("Could not read registration images:", error);
			showAuthMsg("regMsg", "Could not read one of the images. Please select the logo and stamp again.", true);
			return;
		}
		const profile = {
			uid: "local-demo-user",
			username: username,
			companyName: companyName,
			trn: trn || "000000000000000",
			address: address || "Local demo environment",
			phone: phone || "0000000000",
			email: email || `${username.toLowerCase()}@local.test`,
			requiresEmailVerification: false,
			approvalStatus: "approved",
			logoData: logoData,
			stampData: stampData,
			nextInvoiceNumber: createInitialInvoiceSequences(),
			integrations: createInitialIntegrationSettings()
		};
		saveLocalProfile(profile);
		showAuthMsg("regMsg", "Local mode is active. Your account was saved on this device.", false);
		setTimeout(() => {
			event.target.reset();
			document.getElementById("logoPreview").hidden = true;
			document.getElementById("stampPreview").hidden = true;
			setLoading(submitBtn, false);
			goToMode("login");
		}, 1200);
		return;
	}

	if (!username || !companyName || !password) {
		showAuthMsg("regMsg", "Please fill in all fields.", true);
		return;
	}
	if (password !== confirmPassword) {
		showAuthMsg("regMsg", "Passwords do not match.", true);
		return;
	}
	if (password.length < 6) {
		showAuthMsg("regMsg", "Password must be at least 6 characters.", true);
		return;
	}
	if (!/^\d{15}$/.test(trn)) {
		showAuthMsg("regMsg", "TRN must be exactly 15 digits.", true);
		return;
	}
	if (!address || !phone || !email) {
		showAuthMsg("regMsg", "Please fill in your company address, phone, and email.", true);
		return;
	}
	setLoading(submitBtn, true);

	const key = usernameKey(username);
	let createdUid = null;

	try {
		const taken = await db.collection("usernames").doc(key).get();
		if (taken.exists) {
			showAuthMsg("regMsg", "That username is already taken.", true);
			setLoading(submitBtn, false);
			return;
		}

		const [logoData, stampData] = await Promise.all([
			fileToDataURL(logoFile),
			fileToDataURL(stampFile)
		]);
		const cred = await auth.createUserWithEmailAndPassword(email, password);
		createdUid = cred.user.uid;

		await db.collection("users").doc(createdUid).set({
			uid: createdUid,
			username: username,
			companyName: companyName,
			trn: trn,
			address: address,
			phone: phone,
			email: email,
			requiresEmailVerification: true,
			approvalStatus: "pending",
			logoData: logoData,
			stampData: stampData,
			nextInvoiceNumber: createInitialInvoiceSequences(),
			integrations: createInitialIntegrationSettings(),
			createdAt: firebase.firestore.FieldValue.serverTimestamp()
		});
		await db.collection("applications").doc(createdUid).set({
			companyName: companyName,
			email: email,
			status: "pending",
			createdAt: firebase.firestore.FieldValue.serverTimestamp()
		});

		await db.collection("usernames").doc(key).set({
			uid: createdUid,
			email: email
		});
		await cred.user.sendEmailVerification();

		await auth.signOut();

		showAuthMsg("regMsg", "Registration received. Verify your email, then wait for the company approval email before signing in.", false);
		setTimeout(() => {
			event.target.reset();
			document.getElementById("logoPreview").hidden = true;
			document.getElementById("stampPreview").hidden = true;
			setLoading(submitBtn, false);
			goToMode("login");
		}, 2200);
	} catch (err) {
		console.error(err);
		showAuthMsg("regMsg", friendlyFirebaseError(err), true);
		setLoading(submitBtn, false);
		if (createdUid && auth.currentUser && auth.currentUser.uid === createdUid) {
			await db.collection("applications").doc(createdUid).delete().catch(() => {});
			await db.collection("users").doc(createdUid).delete().catch(() => {});
			const usernameDoc = await db.collection("usernames").doc(key).get().catch(() => null);
			if (usernameDoc && usernameDoc.exists && usernameDoc.data().uid === createdUid) {
				await db.collection("usernames").doc(key).delete().catch(() => {});
			}
			await auth.currentUser.delete().catch(() => {});
		}
	}
}

async function handleLogin(event) {
	event.preventDefault();
	const submitBtn = event.target.querySelector("button[type=submit]");

	const username = loginUsername.value.trim();
	const password = loginPassword.value;

	if (!isFirebaseConfigured() || !navigator.onLine) {
		if (!username || !password) {
			showAuthMsg("loginMsg", "Enter your username and password.", true);
			return;
		}
		const localProfile = getLocalProfile(username);
		if (username.toLowerCase() === localProfile.username.toLowerCase() || username.toLowerCase() === "demo") {
			markLoggedInBefore();
			_currentProfile = localProfile;
			saveLocalProfile(localProfile);
			showAuthMsg("loginMsg", "Local mode active. Loading your invoices...", false);
			document.querySelector(".authWrapper").classList.add("isLeaving");
			setTimeout(() => { window.location.href = "home.html"; }, 260);
			return;
		}
		showAuthMsg("loginMsg", "Please check your internet connection and try again.", true);
		return;
	}

	setLoading(submitBtn, true);

	try {
		const key = usernameKey(username);
		const lookup = await db.collection("usernames").doc(key).get();
		if (!lookup.exists) {
			showAuthMsg("loginMsg", "No account found with that username.", true);
			setLoading(submitBtn, false);
			return;
		}

		const email = lookup.data().email;
		await auth.signInWithEmailAndPassword(email, password);
		const user = auth.currentUser;
		await user.reload();
		if (!user.emailVerified) {
			await user.sendEmailVerification();
			await auth.signOut();
			showAuthMsg("loginMsg", "Verify your email using the link we sent. A fresh link has been sent.", false);
			setLoading(submitBtn, false);
			return;
		}
		const profileDoc = await db.collection("users").doc(user.uid).get();
		const profile = profileDoc.exists ? profileDoc.data() : {};
		if (profile.approvalStatus === "pending" || profile.approvalStatus === "rejected") {
			await auth.signOut();
			const message = profile.approvalStatus === "pending"
				? "Your company is still waiting for approval. We will email you when the review is complete."
				: "This company account has not been approved. Please contact the website owner.";
			showAuthMsg("loginMsg", message, profile.approvalStatus === "rejected");
			setLoading(submitBtn, false);
			return;
		}

		markLoggedInBefore();
		showAuthMsg("loginMsg", "Welcome back! Loading your invoices...", false);
		document.querySelector(".authWrapper").classList.add("isLeaving");
		setTimeout(() => { window.location.href = "home.html"; }, 260);
	} catch (err) {
		console.error(err);
		showAuthMsg("loginMsg", friendlyFirebaseError(err), true);
		setLoading(submitBtn, false);
	}
}
