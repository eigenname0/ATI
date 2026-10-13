function setAccountMessage(id, message, isError) {
	const el = document.getElementById(id);
	el.textContent = message || "";
	el.classList.toggle("error", !!isError);
}

async function initAccountPage(profile, user) {
	document.getElementById("accountUsername").value = profile.username || "";
	document.getElementById("accountPhone").value = profile.phone || "";
	document.getElementById("accountAddress").value = profile.address || "";
	const initialsSource = (profile.companyName || profile.username || "ATI").trim();
	document.getElementById("accountCompanyName").textContent = profile.companyName || profile.username || "Company";
	document.getElementById("accountIdentityDetails").textContent = [profile.username, profile.email].filter(Boolean).join(" · ");
	document.getElementById("accountAvatarFallback").textContent = initialsSource
		.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "A";
	showAccountLogo(profile.logoData);
	const theme = normalizeAccountTheme(profile.themeColors);
	document.getElementById("themeColorsEnabled").checked = theme.enabled;
	document.getElementById("themeIconColor").value = theme.icons;
	document.getElementById("themeButtonColor").value = theme.buttons;
	document.getElementById("themeLineColor").value = theme.line;
	updateThemeColorControlState();
	if (!user || typeof user.getIdTokenResult !== "function") return;
	try {
		const token = await user.getIdTokenResult();
		document.getElementById("appearanceCard").hidden = token.claims.admin !== true;
	} catch (error) {
		console.error("Could not verify appearance settings access:", error);
	}
}

function updateThemeColorControlState() {
	const enabled = document.getElementById("themeColorsEnabled").checked;
	["themeIconColor", "themeButtonColor", "themeLineColor"].forEach(id => {
		document.getElementById(id).disabled = !enabled;
	});
}

document.getElementById("themeColorsEnabled").addEventListener("change", updateThemeColorControlState);

async function saveAccountTheme(event) {
	event.preventDefault();
	const user = auth.currentUser;
	if (!user) {
		setAccountMessage("themeMessage", "Sign in as the host to change workspace colors.", true);
		return;
	}

	try {
		const token = await user.getIdTokenResult();
		if (token.claims.admin !== true) {
			setAccountMessage("themeMessage", "Only the host can change workspace colors.", true);
			return;
		}
		const themeColors = normalizeAccountTheme({
			enabled: document.getElementById("themeColorsEnabled").checked,
			icons: document.getElementById("themeIconColor").value,
			buttons: document.getElementById("themeButtonColor").value,
			line: document.getElementById("themeLineColor").value
		});
		const profileRef = db.collection("users").doc(user.uid);
		await profileRef.set({ themeColors }, { merge: true });
		_currentProfile.themeColors = themeColors;
		applyAccountTheme(themeColors);
		setAccountMessage("themeMessage", themeColors.enabled ? "Workspace colors saved." : "Default colors restored.", false);
	} catch (error) {
		console.error("Could not save workspace colors:", error);
		setAccountMessage("themeMessage", friendlyFirebaseError(error), true);
	}
}

function showAccountLogo(source) {
	const preview = document.getElementById("accountLogoPreview");
	const fallback = document.getElementById("accountAvatarFallback");
	preview.src = source || "";
	preview.style.display = source ? "block" : "none";
	fallback.style.display = source ? "none" : "block";
}

function previewAccountLogo(input) {
	const file = input.files[0];
	if (!file) return;
	if (!file.type.startsWith("image/")) {
		input.value = "";
		setAccountMessage("profileMessage", "Please choose an image file.", true);
		return;
	}
	showAccountLogo(URL.createObjectURL(file));
	setAccountMessage("profileMessage", "Save your information to apply the new logo.", false);
}

async function saveAccountProfile(event) {
	event.preventDefault();
	const user = auth.currentUser;
	const oldName = (_currentProfile.username || "").trim();
	const newName = document.getElementById("accountUsername").value.trim();
	const newPhone = document.getElementById("accountPhone").value.trim();
	const newAddress = document.getElementById("accountAddress").value.trim();
	const logoInput = document.getElementById("accountLogo");
	const logoFile = logoInput.files[0];
	const oldKey = usernameKey(oldName);
	const newKey = usernameKey(newName);
	const profileRef = db.collection("users").doc(user.uid);
	const submit = event.currentTarget.querySelector('button[type="submit"]');
	if (logoFile && logoFile.size > 300 * 1024) {
		setAccountMessage("profileMessage", "Please use an image under 300KB.", true);
		return;
	}
	setAccountMessage("profileMessage", "Saving your information…", false);
	submit.disabled = true;
	try {
		const profileUpdates = { username: newName, phone: newPhone, address: newAddress };
		if (logoFile) profileUpdates.logoData = await fileToDataURL(logoFile);
		await db.runTransaction(async (transaction) => {
			const newUsernameRef = db.collection("usernames").doc(newKey);
			const newUsernameDoc = newKey === oldKey ? null : await transaction.get(newUsernameRef);
			if (newUsernameDoc && newUsernameDoc.exists && newUsernameDoc.data().uid !== user.uid) {
				throw new Error("That username is already taken.");
			}
			if (newKey !== oldKey) {
				transaction.set(newUsernameRef, { uid: user.uid, email: user.email });
				if (oldKey) transaction.delete(db.collection("usernames").doc(oldKey));
			}
			transaction.set(profileRef, profileUpdates, { merge: true });
		});
		_currentProfile.username = newName;
		_currentProfile.phone = newPhone;
		_currentProfile.address = newAddress;
		if (Object.prototype.hasOwnProperty.call(profileUpdates, "logoData")) {
			_currentProfile.logoData = profileUpdates.logoData;
			logoInput.value = "";
			showAccountLogo(_currentProfile.logoData);
		}
		document.getElementById("taskbarUsername").textContent = newName;
		document.getElementById("accountIdentityDetails").textContent = [newName, _currentProfile.email].filter(Boolean).join(" · ");
		setAccountMessage("profileMessage", "Account information saved.", false);
	} catch (error) {
		console.error("Could not save account profile:", error);
		setAccountMessage("profileMessage", error.message || friendlyFirebaseError(error), true);
	} finally {
		submit.disabled = false;
	}
}

async function changeAccountPassword(event) {
	event.preventDefault();
	const user = auth.currentUser;
	const current = document.getElementById("currentPassword").value;
	const next = document.getElementById("newPassword").value;
	const confirm = document.getElementById("confirmNewPassword").value;
	const submit = document.getElementById("passwordSaveButton");
	if (next !== confirm) {
		setAccountMessage("passwordMessage", "The new passwords do not match.", true);
		return;
	}
	setAccountMessage("passwordMessage", "Updating your password…", false);
	submit.disabled = true;
	try {
		const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
		await user.reauthenticateWithCredential(credential);
		await user.updatePassword(next);
		document.getElementById("passwordForm").reset();
		setAccountMessage("passwordMessage", "Password changed successfully.", false);
	} catch (error) {
		console.error("Could not update password:", error);
		setAccountMessage("passwordMessage", friendlyFirebaseError(error), true);
	} finally {
		submit.disabled = false;
	}
}
